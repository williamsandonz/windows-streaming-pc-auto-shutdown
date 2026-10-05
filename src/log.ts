function timestamp(): string {
  return new Date().toISOString();
}

export function log(message: string): void {
  console.log(`${timestamp()} ${message}`);
}

export function logError(message: string): void {
  console.error(`${timestamp()} ERROR ${message}`);
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
