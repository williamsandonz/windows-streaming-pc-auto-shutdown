import { uptime } from 'node:os';
import type { ActivityCheck, ActivityResult } from './activity';
import { loadConfig } from './config';
import { describeError, localTimestamp, log, logError, logShutdownEvent, paint, type Tone } from './log';
import { createPlexCheck } from './plex';
import { createRdtCheck } from './rdt';
import { createShutdown, formatSeconds } from './shutdown';
import { createSunshineCheck, streamPorts } from './sunshine';

type CheckResult = PromiseSettledResult<ActivityResult>;

/** One condition's verdict on a tick, as listed in the DRY_RUN log. */
interface Condition {
  name: string;
  state: 'true' | 'false' | 'unavailable' | 'off';
  detail: string;
}

/** A condition that is true stands out, one that is false or off fades back, and one that cannot be read is a failure. */
const STATE_TONES: Record<Condition['state'], Tone> = {
  true: 'success',
  false: 'muted',
  unavailable: 'failure',
  off: 'muted',
};

interface UptimeStatus {
  /** Milliseconds since the PC was switched on, or null when the system could not say. */
  uptimeMs: number | null;
  /** True once the PC has been on for the minimum. Never true when the uptime is unknown. */
  ok: boolean;
  condition: Condition;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  return hours > 0 ? `${hours}h ${totalMinutes % 60}m` : `${totalMinutes}m`;
}

/** Reads how long the PC has been on, failing safe to null so an unreadable clock can never allow a shutdown. */
function readUptimeMs(): number | null {
  try {
    const seconds = uptime();
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
  } catch {
    return null;
  }
}

function describeUptime(uptimeMs: number | null): string {
  if (uptimeMs === null) return 'uptime unknown';
  return `on for ${formatDuration(uptimeMs)}, since ${localTimestamp(new Date(Date.now() - uptimeMs))}`;
}

function describeCheck(name: string, result: CheckResult): Condition {
  return result.status === 'fulfilled'
    ? { name: `${name} active`, state: result.value.active ? 'true' : 'false', detail: result.value.detail }
    : { name: `${name} active`, state: 'unavailable', detail: describeError(result.reason) };
}

function main(): void {
  const config = loadConfig();
  const shutdown = createShutdown(config.dryRun, config.shutdownDelaySeconds);
  // The minimum uptime is the idle timeout itself: one setting, one length of time for both.
  const minUptimeMs = config.idleTimeoutMinutes * 60_000;

  // A switched-off check is simply not built, so it can neither hold the PC up nor report as unavailable.
  const checks: ActivityCheck[] = [];
  const switchedOff: { name: string; setting: string }[] = [];
  if (config.rdt) checks.push(createRdtCheck(config.rdt, config.requestTimeoutMs));
  else switchedOff.push({ name: 'rdt', setting: 'RDT_CHECK' });
  if (config.plex) checks.push(createPlexCheck(config.plex, config.requestTimeoutMs));
  else switchedOff.push({ name: 'plex', setting: 'PLEX_CHECK' });
  if (config.sunshine) checks.push(createSunshineCheck(config.sunshine, config.requestTimeoutMs));
  else switchedOff.push({ name: 'sunshine', setting: 'SUNSHINE_CHECK' });

  let idleCount = 0;

  /**
   * Says whether the PC has been on long enough to be shut down. It overrides every other condition,
   * and it changes nothing, so it is safe to call every tick.
   */
  function checkUptime(): UptimeStatus {
    const name = `PC on for at least ${config.idleTimeoutMinutes} min`;
    const uptimeMs = readUptimeMs();
    if (uptimeMs === null) {
      return {
        uptimeMs,
        ok: false,
        condition: { name, state: 'unavailable', detail: 'could not read how long the PC has been on' },
      };
    }

    const ok = uptimeMs >= minUptimeMs;
    return { uptimeMs, ok, condition: { name, state: ok ? 'true' : 'false', detail: describeUptime(uptimeMs) } };
  }

  function summarizeResults(results: CheckResult[]): string {
    return (
      results
        .map((result, i) => {
          const { name } = checks[i];
          return result.status === 'fulfilled'
            ? `${name}=${result.value.active ? 'active' : 'idle'} (${result.value.detail})`
            : `${name}=unavailable (${describeError(result.reason)})`;
        })
        .join(', ') || 'no checks enabled'
    );
  }

  /** Updates the idle tally from a round of check results. Returns true once the idle timeout is reached. */
  function updateIdleCount(results: CheckResult[]): boolean {
    const summary = summarizeResults(results);

    if (results.some((r) => r.status === 'fulfilled' && r.value.active)) {
      idleCount = 0;
      log(`Activity detected, idle counter reset. ${summary}`, 'success');
      return false;
    }

    // Fail safe: an unreachable service could be hiding activity, so it never counts towards idle time.
    if (results.some((r) => r.status === 'rejected')) {
      idleCount = 0;
      logError(`Could not confirm idle, idle counter reset. ${summary}`);
      return false;
    }

    idleCount += 1;
    log(`Idle ${idleCount}/${config.idleThreshold}. ${summary}`, 'progress');
    return idleCount >= config.idleThreshold;
  }

  /** DRY_RUN only: lists every condition with its true or false, then whether a shutdown would follow. */
  function logDryRunTick(
    uptimeStatus: UptimeStatus,
    results: CheckResult[],
    idleReached: boolean,
    shutdownDue: boolean,
  ): void {
    const checkConditions = checks.map((check, i) => describeCheck(check.name, results[i]));
    const conditions: Condition[] = [
      uptimeStatus.condition,
      ...checkConditions,
      ...switchedOff.map(({ name, setting }): Condition => ({
        name: `${name} active`,
        state: 'off',
        detail: `switched off, ${setting}=false`,
      })),
      {
        name: 'idle timeout reached',
        state: idleReached ? 'true' : 'false',
        detail: `${idleCount}/${config.idleThreshold} consecutive idle checks`,
      },
    ];
    for (const { name, state, detail } of conditions) {
      log(`${paint('dryRun', '[dry-run]')} ${name}: ${paint(STATE_TONES[state], state)} ${paint('muted', `(${detail})`)}`);
    }

    const checksWhere = (state: Condition['state']): string[] =>
      checks.filter((_, i) => checkConditions[i].state === state).map((check) => check.name);
    const active = checksWhere('true');
    const unavailable = checksWhere('unavailable');

    let verdict: string;
    let tone: Tone;
    if (!uptimeStatus.ok) {
      // Listed first because it overrides everything below.
      if (uptimeStatus.uptimeMs === null) {
        verdict = 'no shutdown (could not read how long the PC has been on)';
        tone = 'failure';
      } else {
        verdict =
          `no shutdown (PC has been on for only ${formatDuration(uptimeStatus.uptimeMs)}, ` +
          `shutdown is blocked until ${config.idleTimeoutMinutes} min)`;
        tone = 'warning';
      }
    } else if (shutdownDue) {
      verdict = 'shutdown would be issued (idle timeout reached)';
      tone = 'warning';
    } else if (active.length > 0) {
      verdict = `no shutdown (activity from ${active.join(', ')})`;
      tone = 'success';
    } else if (unavailable.length > 0) {
      verdict = `no shutdown (could not confirm idle, ${unavailable.join(', ')} unavailable)`;
      tone = 'failure';
    } else {
      verdict = `no shutdown (idle timeout not reached yet, ${idleCount}/${config.idleThreshold})`;
      tone = 'progress';
    }
    log(`${paint('dryRun', '[dry-run]')} result: ${paint(tone, verdict)}`);
  }

  /**
   * Starts the shutdown and records it in shutdown.log: the decision with the evidence behind it, a
   * countdown warning written just before the command runs, then what happened to the command, so the
   * morning after shows both what was seen and what was done.
   */
  async function shutdownForIdle(results: CheckResult[], uptimeStatus: UptimeStatus): Promise<void> {
    const outcome = config.dryRun ? 'WOULD TRIGGER (DRY_RUN, nothing is executed)' : 'TRIGGERED';
    logShutdownEvent(
      `SHUTDOWN ${outcome}: idle timeout reached | ` +
        `idle ${idleCount}/${config.idleThreshold} checks (${config.idleTimeoutMinutes} min) | ` +
        `${summarizeResults(results)} | PC ${describeUptime(uptimeStatus.uptimeMs)}`,
      'warning',
    );

    // Written before the command, so the log always says a shutdown was coming, even if the PC goes off first.
    const delay = formatSeconds(config.shutdownDelaySeconds);
    logShutdownEvent(
      config.dryRun
        ? `SHUTDOWN COUNTDOWN (DRY_RUN, nothing is executed): would shut down in ${delay}`
        : `SHUTDOWN COUNTDOWN: about to shut down in ${delay}, run "shutdown /a" to cancel`,
      'warning',
    );

    try {
      await shutdown('Idle timeout reached.');
      if (config.dryRun) {
        logShutdownEvent('SHUTDOWN RESULT: DRY_RUN is on, no shutdown command was run', 'dryRun');
      } else {
        logShutdownEvent(
          `SHUTDOWN RESULT: Windows accepted the command, the PC goes off in ${delay} unless it is cancelled`,
          'success',
        );
      }
      // Start a fresh window so a cancelled shutdown (shutdown /a) is not re-issued on the next check.
      idleCount = 0;
    } catch (err) {
      logShutdownEvent(`SHUTDOWN RESULT: command FAILED, retrying on the next check: ${describeError(err)}`, 'failure');
    }
  }

  async function tick(): Promise<void> {
    const results = await Promise.allSettled(checks.map((check) => check.run()));
    const idleReached = updateIdleCount(results);

    // The uptime guard is the last word: no shutdown, whatever else is true, until the PC has been on long enough.
    const uptimeStatus = checkUptime();
    const shutdownDue = idleReached && uptimeStatus.ok;
    if (config.dryRun) logDryRunTick(uptimeStatus, results, idleReached, shutdownDue);

    if (shutdownDue) {
      await shutdownForIdle(results, uptimeStatus);
    } else if (idleReached) {
      if (uptimeStatus.uptimeMs === null) {
        logError('Idle timeout reached, but not shutting down: could not read how long the PC has been on.');
      } else {
        log(
          `Idle timeout reached, but not shutting down: the PC has been on for only ` +
            `${formatDuration(uptimeStatus.uptimeMs)}, under the ${config.idleTimeoutMinutes} min minimum.`,
          'warning',
        );
      }
    }
  }

  async function run(): Promise<void> {
    try {
      await tick();
    } catch (err) {
      idleCount = 0;
      logError(`Unexpected error, idle counter reset: ${describeError(err)}`);
    }

    setTimeout(() => void run(), config.pollIntervalSeconds * 1000);
  }

  log(
    `Idle-shutdown guardian started. Checking every ${config.pollIntervalSeconds}s and shutting down after ` +
      `${config.idleThreshold} consecutive idle checks (${config.idleTimeoutMinutes} min), never within the first ` +
      `${config.idleTimeoutMinutes} min after the PC is switched on, with a ${config.shutdownDelaySeconds} second ` +
      `countdown before it goes off. ` +
      `RDT-Client: ${config.rdt?.baseUrl ?? 'off'}, Plex: ${config.plex?.baseUrl ?? 'off'}, ` +
      `Sunshine: ${config.sunshine ? `ports ${streamPorts(config.sunshine).join('/')}` : 'off'}.` +
      (config.dryRun ? ' DRY_RUN is on, no shutdown will be issued.' : ''),
    'success',
  );
  if (checks.length === 0) {
    log(
      'No activity checks are enabled, so nothing can hold the PC up: it will shut down after the idle timeout.',
      'warning',
    );
  }
  void run();
}

try {
  main();
} catch (err) {
  logError(describeError(err));
  process.exitCode = 1;
}
