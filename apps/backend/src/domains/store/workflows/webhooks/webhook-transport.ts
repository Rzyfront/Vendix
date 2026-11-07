import * as http from 'http';
import * as https from 'https';
import { Readable } from 'stream';
import { assertWebhookUrl, createVettedLookup } from './webhook-url-policy';

export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_MAX_RESPONSE_BYTES = 4096;

export interface WebhookRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface WebhookResponse {
  status: number;
  /** At most {@link WEBHOOK_MAX_RESPONSE_BYTES} bytes of the response body. */
  body: string;
}

/** Seam for the delivery service (and its tests). */
export type WebhookTransport = (
  req: WebhookRequest,
) => Promise<WebhookResponse>;

/**
 * Reads at most `maxBytes` of a stream and stops (destroys it) beyond that, so
 * a hostile endpoint cannot make us buffer an unbounded response.
 */
export function readCapped(
  stream: Readable,
  maxBytes: number,
): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8'));
    };
    stream.on('data', (chunk: Buffer | string) => {
      if (done) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const room = maxBytes - size;
      chunks.push(room >= buf.length ? buf : buf.subarray(0, room));
      size += Math.min(room, buf.length);
      if (size >= maxBytes) {
        finish();
        stream.destroy();
      }
    });
    stream.on('end', finish);
    stream.on('close', finish);
    stream.on('error', finish);
  });
}

/**
 * Production transport. No redirects are followed (`https.request` never does),
 * the DNS lookup is the vetted one, the whole exchange has a 10 s deadline and
 * the response body is capped. Throws on network errors and policy violations.
 */
export const httpsWebhookTransport: WebhookTransport = (req) =>
  new Promise<WebhookResponse>((resolve, reject) => {
    let url: URL;
    try {
      url = assertWebhookUrl(req.url);
    } catch (e) {
      reject(e);
      return;
    }
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn();
    };
    const request = https.request(
      {
        protocol: 'https:',
        hostname: url.hostname.startsWith('[')
          ? url.hostname.slice(1, -1)
          : url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          ...req.headers,
          'Content-Length': Buffer.byteLength(req.body),
        },
        agent: false,
        lookup:
          createVettedLookup() as unknown as https.RequestOptions['lookup'],
        servername: url.hostname.startsWith('[') ? undefined : url.hostname,
      },
      (res) => {
        readCapped(res, WEBHOOK_MAX_RESPONSE_BYTES).then((body) =>
          settle(() => resolve({ status: res.statusCode ?? 0, body })),
        );
        res.on('error', () =>
          settle(() => resolve({ status: res.statusCode ?? 0, body: '' })),
        );
      },
    );
    const deadline = setTimeout(() => {
      request.destroy(new Error('Webhook request timed out'));
    }, WEBHOOK_TIMEOUT_MS);
    request.on('error', (e) => settle(() => reject(e)));
    request.end(req.body);
  });

/* ------------------------------------------------------------------ */
/* P3.2: generic outbound HTTP (the flow's "Llamada HTTP" node)        */
/* ------------------------------------------------------------------ */

export interface OutboundHttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface OutboundHttpResponse {
  status: number;
  /** Lower-case names; `set-cookie` is never exposed. */
  headers: Record<string, string>;
  body: string;
  /** True when the response was longer than `maxResponseBytes`. */
  truncated: boolean;
}

/** Seam for the HTTP node (and its tests). */
export type OutboundHttpTransport = (
  req: OutboundHttpRequest,
) => Promise<OutboundHttpResponse>;

export class OutboundTimeoutError extends Error {
  constructor(seconds: number) {
    super(`The request exceeded ${seconds} seconds`);
  }
}

function flattenHeaders(
  raw: http.IncomingHttpHeaders,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (name === 'set-cookie' || value === undefined) continue;
    out[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

/**
 * Production transport of the HTTP node. Same guarantees as the webhook one
 * (static URL policy, vetted DNS lookup = the address checked is the address
 * connected to, no redirects followed) for http and https, any method, and a
 * caller-chosen deadline and response cap.
 */
export const outboundHttpTransport: OutboundHttpTransport = (req) =>
  new Promise<OutboundHttpResponse>((resolve, reject) => {
    let url: URL;
    try {
      url = assertWebhookUrl(req.url, { allowHttp: true });
    } catch (e) {
      reject(e);
      return;
    }
    const secure = url.protocol === 'https:';
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn();
    };
    const hostname = url.hostname.startsWith('[')
      ? url.hostname.slice(1, -1)
      : url.hostname;
    const headers: Record<string, string | number> = { ...req.headers };
    if (req.body !== undefined) {
      headers['Content-Length'] = Buffer.byteLength(req.body);
    }
    const options: https.RequestOptions = {
      hostname,
      port: url.port || (secure ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: req.method,
      headers,
      agent: false,
      lookup: createVettedLookup() as unknown as https.RequestOptions['lookup'],
      ...(secure && !url.hostname.startsWith('[') ? { servername: hostname } : {}),
    };
    const request = (secure ? https : http).request(options, (res) => {
      readCapped(res, req.maxResponseBytes + 1).then((text) => {
        const bytes = Buffer.from(text, 'utf8');
        const truncated = bytes.length > req.maxResponseBytes;
        settle(() =>
          resolve({
            status: res.statusCode ?? 0,
            headers: flattenHeaders(res.headers),
            body: truncated
              ? bytes.subarray(0, req.maxResponseBytes).toString('utf8')
              : text,
            truncated,
          }),
        );
      });
      res.on('error', () =>
        settle(() =>
          resolve({
            status: res.statusCode ?? 0,
            headers: flattenHeaders(res.headers),
            body: '',
            truncated: false,
          }),
        ),
      );
    });
    const deadline = setTimeout(() => {
      request.destroy(new OutboundTimeoutError(Math.round(req.timeoutMs / 1000)));
    }, req.timeoutMs);
    request.on('error', (e) => settle(() => reject(e)));
    request.end(req.body);
  });
