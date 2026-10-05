import { isRecord, type ActivityCheck } from './activity';
import type { PlexSettings } from './config';

interface SessionCounts {
  /** Sessions that hold the PC up: playing, buffering, or whose state could not be read. */
  active: number;
  /** Sessions Plex reports as paused, which are ignored. */
  paused: number;
}

/** Only an explicit "paused" is ignored, so a session whose state cannot be read still counts as activity. */
function isPaused(session: unknown): boolean {
  const player = isRecord(session) ? session.Player : undefined;
  const state = isRecord(player) ? player.state : undefined;
  return typeof state === 'string' && state.toLowerCase() === 'paused';
}

/** Reads the sessions from MediaContainer: the Metadata entries, or the size attribute when there are none. */
function countSessions(body: unknown): SessionCounts {
  const container = isRecord(body) ? body.MediaContainer : undefined;
  if (!isRecord(container)) throw new Error('Plex response has no MediaContainer');

  const { size, Metadata } = container;
  if (Array.isArray(Metadata)) {
    const paused = Metadata.filter(isPaused).length;
    return { active: Metadata.length - paused, paused };
  }
  // Without the entries there is no state to read, so every session counts.
  if (typeof size === 'number') return { active: size, paused: 0 };
  throw new Error('Plex response has neither size nor Metadata');
}

// /status/sessions lists paused sessions too, and keeps listing one for a few minutes after a client exits
// without telling Plex it stopped (Plex only times it out then). A paused session is therefore not activity.
export function createPlexCheck(settings: PlexSettings, timeoutMs: number): ActivityCheck {
  return {
    name: 'plex',
    async run() {
      const res = await fetch(`${settings.baseUrl}/status/sessions`, {
        headers: { Accept: 'application/json', 'X-Plex-Token': settings.token },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`Plex returned HTTP ${res.status}`);

      const { active, paused } = countSessions(await res.json());
      return {
        active: active > 0,
        detail: `active sessions: ${active}` + (paused > 0 ? `, paused (ignored): ${paused}` : ''),
      };
    },
  };
}
