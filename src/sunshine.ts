import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ActivityCheck } from './activity';
import type { SunshineSettings } from './config';

const execFileAsync = promisify(execFile);

// Sunshine's video, control and audio ports sit 9, 10 and 11 above its base port (47998, 47999 and 48000 by default).
const STREAM_PORT_OFFSETS = [9, 10, 11];

export function streamPorts(settings: SunshineSettings): number[] {
  return STREAM_PORT_OFFSETS.map((offset) => settings.basePort + offset);
}

/** Reads the local port of every UDP socket from `netstat -ano -p UDP`, for IPv4 (0.0.0.0:47998) and IPv6 ([::]:47998). */
function listUdpPorts(netstatOutput: string): Set<number> {
  const ports = new Set<number>();
  // UDP has no state column, so a row is the protocol, local address, foreign address and PID.
  for (const match of netstatOutput.matchAll(/^\s*UDP\s+(\S+)\s+\S+\s+\d+\s*$/gim)) {
    const port = Number(match[1].slice(match[1].lastIndexOf(':') + 1));
    if (Number.isInteger(port)) ports.add(port);
  }
  return ports;
}

// Sunshine is understood to open its streaming ports only while a Moonlight client is connected, so a bound port
// means a stream. It needs no Sunshine login. If netstat cannot be read the check rejects, which never allows a shutdown.
export function createSunshineCheck(settings: SunshineSettings, timeoutMs: number): ActivityCheck {
  if (process.platform !== 'win32') {
    throw new Error('The Sunshine check reads Windows netstat. Set SUNSHINE_CHECK=false to run on other platforms.');
  }
  const ports = streamPorts(settings);

  return {
    name: 'sunshine',
    async run() {
      const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'UDP'], { timeout: timeoutMs, windowsHide: true });

      const udpPorts = listUdpPorts(stdout);
      // Every Windows PC has some UDP sockets open, so none at all means the output was not understood, not that it is quiet.
      if (udpPorts.size === 0) throw new Error('netstat listed no UDP sockets');

      const open = ports.filter((port) => udpPorts.has(port));
      return {
        active: open.length > 0,
        detail: open.length > 0 ? `streaming ports open: ${open.join(', ')}` : `streaming ports closed: ${ports.join(', ')}`,
      };
    },
  };
}
