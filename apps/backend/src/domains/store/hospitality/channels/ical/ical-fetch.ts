import { lookup } from 'dns/promises';
import { BlockList, isIP } from 'net';

/** Why a feed could not be read; `message` is shown to the manager as-is. */
export class IcalFetchError extends Error {}

export interface IcalFetchOptions {
  timeout_ms?: number;
  max_bytes?: number;
  max_redirects?: number;
  /** DNS resolver; injectable for tests. */
  resolve?: (hostname: string) => Promise<string[]>;
  fetchImpl?: typeof fetch;
}

/** Loopback, private, link-local, CGNAT and other non-public ranges. */
const PRIVATE_RANGES = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const) {
  PRIVATE_RANGES.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  PRIVATE_RANGES.addSubnet(net, prefix, 'ipv6');
}

export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = mapped ? mapped[1] : address;
  const family = isIP(ip);
  if (family === 0) return false;
  return !PRIVATE_RANGES.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/** `webcal://` (what some channels show) is the same feed over https. */
export function normalizeIcalUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim().replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    throw new IcalFetchError('La URL del calendario no es válida');
  }
  if (url.protocol !== 'https:') {
    throw new IcalFetchError('La URL del calendario debe empezar por https://');
  }
  if (url.username || url.password) {
    throw new IcalFetchError('La URL del calendario no puede llevar usuario ni clave');
  }
  return url;
}

const defaultResolve = async (hostname: string) =>
  (await lookup(hostname, { all: true })).map((a) => a.address);

/** The host must resolve only to public addresses (no internal network). */
async function assertPublicHost(url: URL, resolve: (h: string) => Promise<string[]>) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await resolve(host);
  } catch {
    throw new IcalFetchError(`No se encontró el servidor ${url.hostname}`);
  }
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
    throw new IcalFetchError('La URL del calendario apunta a una red privada');
  }
}

/**
 * Hospitality Suite (H6.2) — downloads an external iCal feed for the
 * import. The URL is typed by a store user, so the server never follows it
 * blindly: https only, public hosts only (re-checked on every redirect),
 * a timeout and a size cap.
 */
export async function fetchIcalFeed(raw: string, options: IcalFetchOptions = {}): Promise<string> {
  const {
    timeout_ms = 15_000,
    max_bytes = 2_000_000,
    max_redirects = 3,
    resolve = defaultResolve,
    fetchImpl = fetch,
  } = options;
  let url = normalizeIcalUrl(raw);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout_ms);
  try {
    for (let hop = 0; ; hop++) {
      await assertPublicHost(url, resolve);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          redirect: 'manual',
          signal: controller.signal,
          headers: { Accept: 'text/calendar, */*;q=0.5', 'User-Agent': 'Vendix-iCal/1.0' },
        });
      } catch {
        throw new IcalFetchError(
          controller.signal.aborted
            ? 'El canal no respondió a tiempo'
            : `No se pudo conectar con ${url.hostname}`,
        );
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || hop >= max_redirects) {
          throw new IcalFetchError('El canal redirigió demasiadas veces');
        }
        url = normalizeIcalUrl(new URL(location, url).toString());
        continue;
      }
      if (!response.ok) {
        throw new IcalFetchError(`El canal respondió ${response.status}: revisa la URL`);
      }
      const text = await readCapped(response, max_bytes);
      if (!/BEGIN:VCALENDAR/i.test(text)) {
        throw new IcalFetchError('La URL no devuelve un calendario iCal');
      }
      return text;
    }
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(response: Response, max_bytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > max_bytes) throw new IcalFetchError('El calendario es demasiado grande');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max_bytes) {
      await reader.cancel();
      throw new IcalFetchError('El calendario es demasiado grande');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
