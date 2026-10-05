import chalk from 'chalk';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

/** Next to .env in the project root, so it does not depend on the working directory or how the guardian was started. */
const SHUTDOWN_LOG = join(__dirname, '..', 'shutdown.log');

/** How a line is coloured, by what it means: red for failure, green for success, yellow for attention. */
export type Tone = 'normal' | 'progress' | 'success' | 'warning' | 'failure' | 'muted' | 'dryRun';

function toned(instance: chalk.Chalk, tone: Tone): chalk.Chalk {
  switch (tone) {
    case 'progress':
      return instance.cyan;
    case 'success':
      return instance.green;
    case 'warning':
      return instance.yellow;
    case 'failure':
      return instance.red;
    case 'muted':
      return instance.gray;
    case 'dryRun':
      return instance.magenta;
    case 'normal':
      return instance;
  }
}

/** Colours part of a line. Chalk leaves the text plain when the output is not a terminal, such as guardian.log. */
export function paint(tone: Tone, text: string): string {
  return toned(chalk, tone)(text);
}

function timestamp(): string {
  return new Date().toISOString();
}

/** Local time with its UTC offset, e.g. 2026-10-05T01:00:12+01:00: the clock you remember, and still unambiguous. */
export function localTimestamp(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? '-' : '+';
  const offset = `${sign}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`;
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`;
}

export function log(message: string, tone: Tone = 'normal'): void {
  console.log(`${paint('muted', timestamp())} ${paint(tone, message)}`);
}

export function logError(message: string): void {
  // Its own instance, as stderr can be a terminal while stdout is redirected to a file, or the other way round.
  const { stderr } = chalk;
  console.error(`${stderr.gray(timestamp())} ${stderr.bold.red('ERROR')} ${stderr.red(message)}`);
}

/**
 * Records a shutdown event on the console and in shutdown.log. The file holds nothing else, so the next
 * morning it is a short list of every shutdown with the evidence behind it, and it is always plain text,
 * colours only go to the console. A failure to write it is reported but never stops the shutdown, as the
 * console log still has the record.
 */
export function logShutdownEvent(message: string, tone: Tone): void {
  if (tone === 'failure') logError(message);
  else log(chalk.bold(message), tone);

  try {
    appendFileSync(SHUTDOWN_LOG, `${localTimestamp()} ${message}\n`);
  } catch (err) {
    logError(`Could not write to ${SHUTDOWN_LOG}: ${describeError(err)}`);
  }
}

/** Flattens an error and its cause, as fetch failures hide the real reason in `cause`. */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  const cause = err.cause;
  if (cause instanceof Error) {
    const reason = cause.message || (cause as NodeJS.ErrnoException).code;
    if (reason) return `${err.message}: ${reason}`;
  }
  return err.message;
}
