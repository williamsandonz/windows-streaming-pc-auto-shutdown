import type { ActivityCheck } from './activity';
import { loadConfig } from './config';
import { describeError, log, logError } from './log';
import { createPlexCheck } from './plex';
import { createRdtCheck } from './rdt';
import { createShutdown } from './shutdown';

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function main(): void {
  const config = loadConfig();
  const shutdown = createShutdown(config.dryRun);

  // A switched-off check is simply not built, so it can neither hold the PC up nor report as unavailable.
  const checks: ActivityCheck[] = [];
  if (config.rdt) checks.push(createRdtCheck(config.rdt, config.requestTimeoutMs));
  if (config.plex) checks.push(createPlexCheck(config.plex, config.requestTimeoutMs));

  let idleCount = 0;
  let nightlyShutdownDay: string | null = null;

  /**
   * Shuts down during the nightly hour whatever the checks say, once per day. Returns true when this
   * round was spent on it, so the activity checks are skipped and cannot delay or veto it.
   */
  async function tryNightlyShutdown(): Promise<boolean> {
    const hour = config.nightlyShutdownHour;
    if (hour === null) return false;

    const now = new Date();
    if (now.getHours() !== hour) return false;

    // Once per day, so a shutdown cancelled with `shutdown /a` is not re-issued for the rest of the hour.
    const today = now.toDateString();
    if (nightlyShutdownDay === today) return false;

    log(`Nightly shutdown hour (${formatHour(hour)}) reached, shutting down regardless of activity.`);
    try {
      await shutdown('Nightly shutdown time reached.');
      nightlyShutdownDay = today;
      idleCount = 0;
    } catch (err) {
      logError(`Shutdown command failed, retrying on the next check: ${describeError(err)}`);
    }
    return true;
  }

  async function tick(): Promise<void> {
    if (await tryNightlyShutdown()) return;

    const results = await Promise.allSettled(checks.map((check) => check.run()));
    const summary =
      results
        .map((result, i) => {
          const { name } = checks[i];
          return result.status === 'fulfilled'
            ? `${name}=${result.value.active ? 'active' : 'idle'} (${result.value.detail})`
            : `${name}=unavailable (${describeError(result.reason)})`;
        })
        .join(', ') || 'no checks enabled';

    if (results.some((r) => r.status === 'fulfilled' && r.value.active)) {
      idleCount = 0;
      log(`Activity detected, idle counter reset. ${summary}`);
      return;
    }

    // Fail safe: an unreachable service could be hiding activity, so it never counts towards idle time.
    if (results.some((r) => r.status === 'rejected')) {
      idleCount = 0;
      logError(`Could not confirm idle, idle counter reset. ${summary}`);
      return;
    }

    idleCount += 1;
    log(`Idle ${idleCount}/${config.idleThreshold}. ${summary}`);
    if (idleCount < config.idleThreshold) return;

    log(`Idle timeout of ${config.idleTimeoutMinutes} min reached, shutting down.`);
    try {
      await shutdown('Idle timeout reached.');
      // Start a fresh window so a cancelled shutdown (shutdown /a) is not re-issued on the next check.
      idleCount = 0;
    } catch (err) {
      logError(`Shutdown command failed, retrying on the next check: ${describeError(err)}`);
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

  const nightly = config.nightlyShutdownHour === null ? 'off' : `${formatHour(config.nightlyShutdownHour)} daily`;
  log(
    `Idle-shutdown guardian started. Checking every ${config.pollIntervalSeconds}s and shutting down after ` +
      `${config.idleThreshold} consecutive idle checks (${config.idleTimeoutMinutes} min). ` +
      `RDT-Client: ${config.rdt?.baseUrl ?? 'off'}, Plex: ${config.plex?.baseUrl ?? 'off'}, ` +
      `nightly shutdown: ${nightly}.` +
      (config.dryRun ? ' DRY_RUN is on, no shutdown will be issued.' : ''),
  );
  if (checks.length === 0) {
    log('No activity checks are enabled, so nothing can hold the PC up: it will shut down after the idle timeout.');
  }
  void run();
}

try {
  main();
} catch (err) {
  logError(describeError(err));
  process.exitCode = 1;
}
