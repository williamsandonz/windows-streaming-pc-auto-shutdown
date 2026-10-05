export interface ActivityResult {
  /** True when the service reports work that should keep the machine awake. */
  active: boolean;
  /** Short reason, shown in the poll log line. */
  detail: string;
}

export interface ActivityCheck {
  name: string;
  /** Resolves with the current activity, or rejects when the service cannot be queried. */
  run(): Promise<ActivityResult>;
}

/** Narrows parsed JSON to an object whose fields can then be read safely. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
