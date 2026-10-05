import { isRecord, type ActivityCheck } from './activity';
import type { PlexSettings } from './config';

/** Reads the session count from MediaContainer: its size attribute, or the Metadata entries as a fallback. */
function countSessions(body: unknown): number {
  const container = isRecord(body) ? body.MediaContainer : undefined;
  if (!isRecord(container)) throw new Error('Plex response has no MediaContainer');

  const { size, Metadata } = container;
  if (typeof size === 'number') return size;
  if (Array.isArray(Metadata)) return Metadata.length;
  throw new Error('Plex response has neither size nor Metadata');
}

// /status/sessions also lists paused sessions, so a paused stream counts as activity.
export function createPlexCheck(settings: PlexSettings, timeoutMs: number): ActivityCheck {
  return {
    name: 'plex',
    async run() {
      const res = await fetch(`${settings.baseUrl}/status/sessions`, {
        headers: { Accept: 'application/json', 'X-Plex-Token': settings.token },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`Plex returned HTTP ${res.status}`);

      const sessions = countSessions(await res.json());
      return { active: sessions > 0, detail: `active sessions: ${sessions}` };
    },
  };
}
