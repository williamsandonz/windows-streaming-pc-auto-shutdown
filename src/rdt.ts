import { isRecord, type ActivityCheck } from './activity';
import type { RdtSettings } from './config';

// qBittorrent states for a torrent that is receiving data. stalledDL and queuedDL
// are left out on purpose: nothing is moving, so they should not hold the machine up.
const DOWNLOADING_STATES = new Set(['downloading', 'forceddl', 'metadl', 'forcedmetadl']);

function isDownloading(torrent: unknown): boolean {
  if (!isRecord(torrent)) return false;

  const { state, dlspeed } = torrent;
  if (typeof dlspeed === 'number' && dlspeed > 0) return true;
  return typeof state === 'string' && DOWNLOADING_STATES.has(state.toLowerCase());
}

/** Checks RDT-Client through its qBittorrent-compatible API, the one Sonarr and Radarr use. */
export function createRdtCheck(settings: RdtSettings, timeoutMs: number): ActivityCheck {
  // Logs in afresh on every check. It is one small local request a minute, and it means an
  // expired or invalidated session can never leave the check stuck.
  async function login(): Promise<string> {
    const res = await fetch(`${settings.baseUrl}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: settings.username, password: settings.password }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });

    // This API answers 200 with "Fails." for bad credentials.
    const reply = (await res.text()).trim();
    if (!res.ok || /^fails/i.test(reply)) {
      throw new Error(`RDT-Client login rejected (HTTP ${res.status}). Check RDT_USERNAME and RDT_PASSWORD.`);
    }

    return res.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0])
      .join('; ');
  }

  return {
    name: 'rdt',
    async run() {
      const cookie = await login();
      const res = await fetch(`${settings.baseUrl}/api/v2/torrents/info`, {
        headers: cookie ? { Cookie: cookie } : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`RDT-Client returned HTTP ${res.status}`);

      const torrents: unknown = await res.json();
      if (!Array.isArray(torrents)) throw new Error('RDT-Client did not return a list of torrents');

      const downloading = torrents.filter(isDownloading).length;
      return {
        active: downloading > 0,
        detail: `downloading: ${downloading} of ${torrents.length}`,
      };
    },
  };
}
