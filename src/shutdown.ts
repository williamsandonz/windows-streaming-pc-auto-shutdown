import { execFile } from 'node:child_process';
import { log } from './log';

const DELAY_SECONDS = 60;

/** Starts a shutdown, given the reason to show in the countdown message. */
export type Shutdown = (reason: string) => Promise<void>;

function buildMessage(reason: string): string {
  return `${reason} Shutting down in ${DELAY_SECONDS} seconds.`;
}

/** Starts a Windows shutdown with a 60 second countdown. `shutdown /a` aborts it. */
function shutdownNow(reason: string): Promise<void> {
  const args = ['/s', '/t', String(DELAY_SECONDS), '/c', buildMessage(reason)];

  return new Promise<void>((resolve, reject) => {
    execFile('shutdown', args, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }

      log(`Shutdown scheduled in ${DELAY_SECONDS} seconds. Run "shutdown /a" to abort.`);
      resolve();
    });
  });
}

async function logOnly(reason: string): Promise<void> {
  log(`DRY_RUN is on, not running: shutdown /s /t ${DELAY_SECONDS} /c "${buildMessage(reason)}"`);
}

/**
 * Picks the shutdown action once, at startup, so an unsupported platform fails
 * straight away rather than an hour into the run.
 */
export function createShutdown(dryRun: boolean): Shutdown {
  if (dryRun) return logOnly;
  if (process.platform !== 'win32') {
    throw new Error('Shutdown is only implemented for Windows. Set DRY_RUN=true to run on other platforms.');
  }
  return shutdownNow;
}
