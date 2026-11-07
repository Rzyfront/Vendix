import { resolveHttpActionMap } from '../../secrets/workflow-http-map';

type HttpMap = Parameters<typeof resolveHttpActionMap>[0];
type HttpMapContext = Parameters<typeof resolveHttpActionMap>[1];
type ResolvedHttpMap = ReturnType<typeof resolveHttpActionMap>;

/** Content of a JSON string literal: quotes, backslashes and line breaks escaped. */
export const jsonStringContent = (s: string): string => JSON.stringify(s).slice(1, -1);

type Encoder = (s: string) => string;

function encodeStrings<T extends object | undefined>(source: T, encode: Encoder): T {
  if (!source) return source;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) out[k] = typeof v === 'string' ? encode(v) : v;
  return out as T;
}

function contentType(headers: unknown): string | null {
  if (typeof headers !== 'string') return null;
  const line = headers.split(/\r?\n/).find((l) => /^\s*content-type\s*:/i.test(l));
  return line ? line.slice(line.indexOf(':') + 1).trim().toLowerCase() : null;
}

/** How the values pasted into `body` must be encoded, or `null` to paste them as they are. */
function bodyEncoder(map: Record<string, unknown>): Encoder | null {
  const type = contentType(map.headers);
  if (type) {
    if (type.includes('json')) return jsonStringContent;
    if (type.startsWith('application/x-www-form-urlencoded')) return encodeURIComponent;
    return null;
  }
  // Without a declared type the action sends JSON when the body looks like it.
  const body = typeof map.body === 'string' ? map.body.trim() : '';
  return body.startsWith('{') || body.startsWith('[') ? jsonStringContent : null;
}

/**
 * Resolves the `{{fields.*}}` / `{{instance.*}}` tokens of a
 * `vendix.http.request` map encoding each value for the place it lands in:
 * URL component in `url`, JSON string content in a JSON `body` (form encoding
 * in a form body). A value with quotes, line breaks, `&` or `#` (a public form
 * answer, a webhook field) can neither break the request nor add keys to the
 * JSON. Headers keep the plain value (their resolver already strips line
 * breaks) and `{{secrets.*}}` stays in place for the call.
 */
export function resolveHttpRequestMap(map: HttpMap, ctx: HttpMapContext): ResolvedHttpMap {
  const plain = resolveHttpActionMap(map, ctx);
  const raw = map as Record<string, unknown>;
  const encoded = (encode: Encoder) =>
    resolveHttpActionMap(map, {
      ...ctx,
      fields: encodeStrings(ctx.fields, encode),
      instance: encodeStrings(ctx.instance, encode),
    }) as Record<string, unknown>;
  const out = { ...plain } as Record<string, unknown>;
  if (typeof raw.url === 'string') out.url = encoded(encodeURIComponent).url;
  const forBody = typeof raw.body === 'string' ? bodyEncoder(raw) : null;
  if (forBody) out.body = encoded(forBody).body;
  return out as ResolvedHttpMap;
}
