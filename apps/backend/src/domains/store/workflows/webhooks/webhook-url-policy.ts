import * as dns from 'dns';
import * as net from 'net';

/**
 * SSRF policy for outgoing webhooks. Two layers:
 *  1. `assertWebhookUrl` (static): https only, no credentials, sane port, no
 *     private/loopback/link-local/CGNAT/multicast/metadata IP literal, no
 *     `localhost`/internal-looking names. WHATWG `URL` already normalises
 *     decimal, octal and hex IPv4 forms (`2130706433`, `0177.0.0.1`,
 *     `0x7f.1`) to dotted decimal, and IPv6 (incl. `::ffff:` mapped) to its
 *     canonical form, so those spellings hit the same checks.
 *  2. `createVettedLookup` (dynamic): the DNS lookup used by the socket itself
 *     rejects the connection when ANY resolved address is blocked, so the
 *     address that is vetted is the address that is connected to (no
 *     check-then-connect gap, hence no DNS rebinding window).
 */

export class WebhookUrlError extends Error {
  constructor(readonly reason: string) {
    super(`Webhook URL not allowed: ${reason}`);
  }
}

export const WEBHOOK_URL_MAX_LENGTH = 500;

const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.intranet',
  '.lan',
  '.home',
  '.corp',
  '.private',
];

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
}

/** [network, prefix length] */
const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

function isBlockedV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return BLOCKED_V4.some(([net_, bits]) => {
    const base = ipv4ToInt(net_);
    const size = 2 ** (32 - bits);
    return n >= base && n < base + size;
  });
}

/** Expands an IPv6 literal to 8 hextets; null when malformed. */
function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  // Embedded dotted IPv4 tail (::ffff:1.2.3.4).
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (net.isIPv4(tail) === false) return null;
    const [a, b, c, d] = tail.split('.').map(Number);
    s = `${s.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = [
    ...head,
    ...(halves.length === 2 ? Array(missing).fill('0') : []),
    ...rest,
  ];
  if (groups.length !== 8) return null;
  const out = groups.map((g) =>
    /^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN,
  );
  return out.some(Number.isNaN) ? null : out;
}

function v4FromHextets(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function isBlockedV6(ip: string): boolean {
  const h = expandV6(ip);
  if (!h) return true; // unparsable: fail closed
  const allZeroUntil = (n: number) => h.slice(0, n).every((x) => x === 0);
  // :: and ::1
  if (allZeroUntil(7) && (h[7] === 0 || h[7] === 1)) return true;
  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (IPv4-compatible)
  if (allZeroUntil(5) && (h[5] === 0xffff || h[5] === 0)) {
    return isBlockedV4(v4FromHextets(h[6], h[7]));
  }
  // 64:ff9b::/96 (NAT64) embeds an IPv4 address
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) {
    return isBlockedV4(v4FromHextets(h[6], h[7]));
  }
  // 2002::/16 (6to4) embeds an IPv4 address
  if (h[0] === 0x2002) return isBlockedV4(v4FromHextets(h[1], h[2]));
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local
  if ((h[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // documentation
  if (h[0] === 0x2001 && h[1] === 0) return true; // 2001::/32 Teredo tunnels to IPv4
  if (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 1) return true; // 64:ff9b:1::/48 local NAT64
  if (h[0] === 0x0100 && h.slice(1, 4).every((x) => x === 0)) return true; // 100::/64 discard
  return false;
}

/** True when `ip` (v4 or v6 literal, no brackets) must never be contacted. */
export function isBlockedAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedV4(ip);
  if (family === 6) return isBlockedV6(ip);
  return true; // not an IP: fail closed
}

/**
 * Validates the shape of a webhook URL and returns the parsed URL. Throws
 * {@link WebhookUrlError} with a reason that is safe to show to the user.
 */
export function assertWebhookUrl(
  raw: unknown,
  opts: { allowHttp?: boolean } = {},
): URL {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new WebhookUrlError('empty');
  }
  if (raw.length > WEBHOOK_URL_MAX_LENGTH)
    throw new WebhookUrlError('too long');
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) {
    throw new WebhookUrlError('whitespace or control characters');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookUrlError('malformed');
  }
  // P3.2: the generic HTTP node may also call plain http, but only on public
  // addresses (the same blocklist applies); webhooks stay https only.
  const httpOk = opts.allowHttp === true && url.protocol === 'http:';
  if (url.protocol !== 'https:' && !httpOk) {
    throw new WebhookUrlError(
      opts.allowHttp ? 'only http and https are allowed' : 'only https is allowed',
    );
  }
  if (url.username || url.password) {
    throw new WebhookUrlError('credentials in the URL are not allowed');
  }
  if (url.port !== '') {
    const port = Number(url.port);
    const standard = httpOk ? 80 : 443;
    if (port !== standard && port < 1024) {
      throw new WebhookUrlError(`port must be ${standard} or 1024 and above`);
    }
  }
  let host = url.hostname.toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host === '') throw new WebhookUrlError('missing host');
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new WebhookUrlError('private or reserved IP address');
    }
    return url;
  }
  // A non-IP host that still looks numeric ("1.2.3" / "0x7f") is an obfuscated
  // IP the parser did not normalise: refuse instead of trusting the resolver.
  if (/^[0-9.x]+$/i.test(host))
    throw new WebhookUrlError('ambiguous numeric host');
  if (host === 'localhost' || !host.includes('.')) {
    throw new WebhookUrlError('internal host name');
  }
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new WebhookUrlError('internal host name');
  }
  return url;
}

export type DnsResolver = (
  hostname: string,
  options: { all: true; verbatim: boolean },
) => Promise<Array<{ address: string; family: number }>>;

const defaultResolver: DnsResolver = (hostname, options) =>
  dns.promises.lookup(hostname, options);

/**
 * Resolves `hostname` and returns ALL its addresses, throwing when any of them
 * is blocked (a name with one public and one private record is rejected).
 */
export async function resolveAndVet(
  hostname: string,
  resolver: DnsResolver = defaultResolver,
): Promise<Array<{ address: string; family: number }>> {
  const bare = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  if (net.isIP(bare)) {
    if (isBlockedAddress(bare)) {
      throw new WebhookUrlError('private or reserved IP address');
    }
    return [{ address: bare, family: net.isIP(bare) }];
  }
  const addresses = await resolver(bare, { all: true, verbatim: true });
  if (!addresses || addresses.length === 0) {
    throw new WebhookUrlError('host does not resolve');
  }
  for (const a of addresses) {
    if (isBlockedAddress(a.address)) {
      throw new WebhookUrlError(
        'host resolves to a private or reserved address',
      );
    }
  }
  return addresses;
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | Array<{ address: string; family: number }>,
  family?: number,
) => void;

/**
 * `lookup` option for `https.request`: the socket connects to an address that
 * passed {@link resolveAndVet}; the Host header and TLS SNI stay the original
 * hostname.
 */
export function createVettedLookup(resolver: DnsResolver = defaultResolver) {
  return (
    hostname: string,
    options: { all?: boolean } | undefined,
    callback: LookupCallback,
  ): void => {
    resolveAndVet(hostname, resolver).then(
      (addresses) => {
        if (options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
      (err) => callback(err as NodeJS.ErrnoException),
    );
  };
}
