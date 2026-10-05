import { join } from 'node:path';

export interface RdtSettings {
  baseUrl: string;
  username: string;
  password: string;
}

export interface PlexSettings {
  baseUrl: string;
  token: string;
}

export interface Config {
  pollIntervalSeconds: number;
  idleTimeoutMinutes: number;
  /** Consecutive idle checks needed before shutting down. */
  idleThreshold: number;
  requestTimeoutMs: number;
  dryRun: boolean;
  /** The PC is never shut down until it has been on this long, whatever else is true. */
  minUptimeMinutes: number;
  /** How long Windows counts down once a shutdown is issued, during which `shutdown /a` cancels it. */
  shutdownDelaySeconds: number;
  /** Null when the RDT-Client check is switched off. */
  rdt: RdtSettings | null;
  /** Null when the Plex check is switched off. */
  plex: PlexSettings | null;
}

/** Reads .env from the project root, so the working directory does not matter under PM2 or Task Scheduler. */
function loadDotEnv(): void {
  try {
    process.loadEnvFile(join(__dirname, '..', '.env'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

function readRequired(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is not set. Add it to the .env file (see README.md).`);
  }
  return value;
}

function readUrl(name: string, fallback: string): string {
  const raw = process.env[name]?.trim() || fallback;
  if (!/^https?:\/\/\S+$/i.test(raw)) {
    throw new Error(`${name} must be a full address starting with http:// or https://, got "${raw}".`);
  }
  return raw.replace(/\/+$/, '');
}

function readPositiveNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got "${raw}".`);
  }
  return value;
}

/** Whole seconds only, as that is all Windows' `shutdown /t` accepts. */
function readPositiveInteger(name: string, fallback: number): number {
  const value = readPositiveNumber(name, fallback);
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be a whole number above zero, got "${process.env[name]?.trim()}".`);
  }
  return value;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['true', '1', 'yes'].includes(raw)) return true;
  if (['false', '0', 'no'].includes(raw)) return false;
  throw new Error(`${name} must be true or false, got "${raw}".`);
}

export function loadConfig(): Config {
  loadDotEnv();

  const pollIntervalSeconds = readPositiveNumber('POLL_INTERVAL_SECONDS', 60);
  const idleTimeoutMinutes = readPositiveNumber('IDLE_TIMEOUT_MINUTES', 60);

  return {
    pollIntervalSeconds,
    idleTimeoutMinutes,
    idleThreshold: Math.ceil((idleTimeoutMinutes * 60) / pollIntervalSeconds),
    requestTimeoutMs: 10_000,
    dryRun: readBoolean('DRY_RUN', false),
    minUptimeMinutes: readPositiveNumber('MIN_UPTIME_MINUTES', 60),
    shutdownDelaySeconds: readPositiveInteger('SHUTDOWN_DELAY_SECONDS', 10),
    // A switched-off check is not built, so its address and credentials are not required.
    rdt: readBoolean('RDT_CHECK', true)
      ? {
          baseUrl: readUrl('RDT_URL', 'http://localhost:6500'),
          username: readRequired('RDT_USERNAME'),
          password: readRequired('RDT_PASSWORD'),
        }
      : null,
    plex: readBoolean('PLEX_CHECK', true)
      ? {
          baseUrl: readUrl('PLEX_URL', 'http://localhost:32400'),
          token: readRequired('PLEX_TOKEN'),
        }
      : null,
  };
}
