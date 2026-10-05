import { execFile } from 'node:child_process';
import { log } from './log';

/** Starts a shutdown, given the reason to show in the countdown message. */
export type Shutdown = (reason: string) => Promise<void>;

export function formatSeconds(seconds: number): string {
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

function buildMessage(reason: string, delaySeconds: number): string {
  return `${reason} Shutting down in ${formatSeconds(delaySeconds)}.`;
}

/** Starts a Windows shutdown that counts down for `delaySeconds`. `shutdown /a` aborts it. */
function shutdownNow(delaySeconds: number): Shutdown {
  return (reason) =>
    new Promise<void>((resolve, reject) => {
      const args = ['/s', '/t', String(delaySeconds), '/c', buildMessage(reason, delaySeconds)];

      execFile('shutdown', args, (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve();
      });
    });
}

function logOnly(delaySeconds: number): Shutdown {
  return async (reason) => {
    log(
      `DRY_RUN is on, not running: shutdown /s /t ${delaySeconds} /c "${buildMessage(reason, delaySeconds)}"`,
      'dryRun',
    );
  };
}

/**
 * Picks the shutdown action once, at startup, so an unsupported platform fails
 * straight away rather than an hour into the run.
 */
export function createShutdown(dryRun: boolean, delaySeconds: number): Shutdown {
  if (dryRun) return logOnly(delaySeconds);
  if (process.platform !== 'win32') {
    throw new Error('Shutdown is only implemented for Windows. Set DRY_RUN=true to run on other platforms.');
  }
  return shutdownNow(delaySeconds);
}
