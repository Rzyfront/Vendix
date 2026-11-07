import { Injectable } from '@nestjs/common';
import { WORKFLOW_HTTP_OUTPUT_PATH } from '@common/workflows/contract';
import {
  DnsResolver,
  WebhookUrlError,
  assertWebhookUrl,
  resolveAndVet,
} from '../../webhooks/webhook-url-policy';
import {
  OutboundHttpResponse,
  OutboundHttpTransport,
  OutboundTimeoutError,
  outboundHttpTransport,
} from '../../webhooks/webhook-transport';
import {
  SECRET_TOKEN,
  WorkflowSecretsService,
  secretNamesIn,
} from '../../secrets/workflow-secrets.service';
import {
  WorkflowActionContext,
  WorkflowActionGroup,
  WorkflowActionHandlerMap,
  WorkflowActionInputError,
  WorkflowActionResult,
  actionInputs,
  must,
} from './workflow-action.types';

export const HTTP_DEFAULT_TIMEOUT_SECONDS = 10;
export const HTTP_MAX_TIMEOUT_SECONDS = 30;
export const HTTP_MAX_RESPONSE_BYTES = 1_048_576;
const HTTP_MAX_HEADERS = 30;
const HTTP_MAX_BODY_CHARS = 200_000;
const USER_AGENT = 'Vendix-Flujos/1.0';

/** Set by the transport itself or hop-by-hop: the flow may not choose them. */
const FORBIDDEN_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'keep-alive',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-connection',
  'expect',
]);
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000a-\u001f\u007f]/;

export type HttpCallErrorKind =
  | 'invalid'
  | 'secret'
  | 'blocked'
  | 'timeout'
  | 'network';

/** A failure of the call, already worded for the user and free of secret values. */
export class HttpCallError extends Error {
  constructor(
    readonly kind: HttpCallErrorKind,
    message: string,
    /** True when running it again may succeed (network, timeout). */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface HttpCallOutcome extends OutboundHttpResponse {
  duration_ms: number;
  /** Values substituted into the request: callers must mask them in anything they echo. */
  secretValues: string[];
}

/** Replaces every secret value in `text` with a mask. */
export function maskSecrets(text: string, values: readonly string[]): string {
  let out = text;
  for (const v of values) {
    if (v.length >= 4) out = out.split(v).join('••••');
  }
  return out;
}

/** `Name: value` per line → header map; rejects forbidden names and injection. */
function parseHeaderLines(text: string): Array<[string, string]> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (lines.length > HTTP_MAX_HEADERS) {
    throw new HttpCallError('invalid', `Máximo ${HTTP_MAX_HEADERS} encabezados.`, false);
  }
  return lines.map((line) => {
    const colon = line.indexOf(':');
    const name = colon > 0 ? line.slice(0, colon).trim() : '';
    if (!HEADER_NAME.test(name)) {
      throw new HttpCallError(
        'invalid',
        `Encabezado no válido: "${line.slice(0, 40)}". Usa "Nombre: valor" en cada línea.`,
        false,
      );
    }
    if (FORBIDDEN_HEADERS.has(name.toLowerCase()) || name.toLowerCase().startsWith('proxy-')) {
      throw new HttpCallError(
        'invalid',
        `El encabezado ${name} lo define Vendix y no se puede cambiar.`,
        false,
      );
    }
    return [name, line.slice(colon + 1).trim()] as [string, string];
  });
}

const BLOCKED_REASONS = [
  'private or reserved IP address',
  'host resolves to a private or reserved address',
  'internal host name',
  'ambiguous numeric host',
];

function blockedError(e: WebhookUrlError): HttpCallError {
  const message = BLOCKED_REASONS.includes(e.reason)
    ? 'Destino bloqueado: dirección privada o de metadatos'
    : `Destino no permitido (${e.reason})`;
  return new HttpCallError('blocked', message, false);
}

/** Value at `path` of the response: `status`, `body`, `body.a.0.b`, `headers.x`. */
export function readResponsePath(
  path: string,
  res: Pick<OutboundHttpResponse, 'status' | 'headers' | 'body'>,
): unknown {
  if (!WORKFLOW_HTTP_OUTPUT_PATH.test(path)) return undefined;
  if (path === 'status') return res.status;
  if (path === 'body') return res.body;
  if (path.startsWith('headers.')) return res.headers[path.slice(8).toLowerCase()];
  let node: unknown;
  try {
    node = JSON.parse(res.body);
  } catch {
    return undefined;
  }
  for (const key of path.split('.').slice(1)) {
    if (Array.isArray(node)) {
      node = /^\d+$/.test(key) ? node[Number(key)] : undefined;
    } else if (node && typeof node === 'object') {
      node = Object.prototype.hasOwnProperty.call(node, key)
        ? (node as Record<string, unknown>)[key]
        : undefined;
    } else {
      return undefined;
    }
    if (node === undefined) return undefined;
  }
  return node;
}

/** Response values for the declared `output` map (absent paths are skipped). */
export function mapResponseOutput(
  output: Record<string, string> | undefined,
  res: Pick<OutboundHttpResponse, 'status' | 'headers' | 'body'>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [field, path] of Object.entries(output ?? {})) {
    const value = readResponsePath(path, res);
    if (value !== undefined && value !== null) fields[field] = value;
  }
  return fields;
}

/**
 * P3.2: `vendix.http.request`. The only place where `{{secrets.NAME}}` becomes
 * a value, and only while the call runs. Shared by the engine action and the
 * editor's "Probar esta acción".
 */
@Injectable()
export class WorkflowHttpActions implements WorkflowActionGroup {
  /** Seams for tests: the policy and the validators stay real. */
  transport: OutboundHttpTransport = outboundHttpTransport;
  resolver?: DnsResolver;

  constructor(private readonly secrets: WorkflowSecretsService) {}

  readonly handlers: WorkflowActionHandlerMap = {
    'vendix.http.request': (ctx) => this.request(ctx),
  };

  private async request(ctx: WorkflowActionContext): Promise<WorkflowActionResult> {
    let outcome: HttpCallOutcome;
    try {
      outcome = await this.perform(ctx.instance.store_id, ctx.map);
    } catch (e) {
      if (e instanceof HttpCallError) {
        if (e.retryable) throw new Error(e.message);
        throw new WorkflowActionInputError(e.message);
      }
      throw e;
    }
    const { status } = outcome;
    if (status >= 500 || status === 429 || status === 408) {
      throw new Error(`El servicio respondió con error ${status}.`);
    }
    if (status < 200 || status >= 300) {
      throw new WorkflowActionInputError(
        status >= 300 && status < 400
          ? `El servicio respondió ${status} (redirección); las redirecciones no se siguen.`
          : `El servicio rechazó la llamada con ${status}.`,
      );
    }
    return {
      record_id: null,
      fields: mapResponseOutput(
        ctx.output,
        {
          status,
          headers: outcome.headers,
          body: maskSecrets(outcome.body, outcome.secretValues),
        },
      ),
    };
  }

  /**
   * Runs one call. `map` holds the inputs with `{{fields.*}}` already resolved
   * and `{{secrets.*}}` still in place. Throws {@link HttpCallError} /
   * `WorkflowActionInputError` for anything that is not a response.
   */
  async perform(storeId: number, map: Record<string, unknown>): Promise<HttpCallOutcome> {
    let i: ReturnType<typeof actionInputs>;
    let method: string;
    let urlTemplate: string;
    let headersTemplate: string;
    let bodyTemplate: string | undefined;
    let timeoutSeconds: number;
    try {
      i = actionInputs('vendix.http.request', map);
      method = must(i.enum<string>('method'), 'method');
      urlTemplate = must(i.text('url', 2000), 'url');
      headersTemplate = i.text('headers', 20_000) ?? '';
      bodyTemplate = i.text('body', HTTP_MAX_BODY_CHARS);
      timeoutSeconds = i.int('timeout_seconds') ?? HTTP_DEFAULT_TIMEOUT_SECONDS;
    } catch (e) {
      if (e instanceof WorkflowActionInputError) {
        throw new HttpCallError('invalid', e.message, false);
      }
      throw e;
    }
    if (timeoutSeconds > HTTP_MAX_TIMEOUT_SECONDS) {
      throw new HttpCallError(
        'invalid',
        `El tiempo máximo no puede pasar de ${HTTP_MAX_TIMEOUT_SECONDS} segundos.`,
        false,
      );
    }
    if (method === 'GET' && bodyTemplate) {
      throw new HttpCallError('invalid', 'Una llamada GET no lleva cuerpo.', false);
    }
    const headerPairs = parseHeaderLines(headersTemplate);

    // Secrets: resolved here and nowhere else.
    const names = new Set<string>([
      ...secretNamesIn(urlTemplate),
      ...secretNamesIn(headersTemplate),
      ...secretNamesIn(bodyTemplate ?? ''),
    ]);
    const values = await this.secrets.resolveMany(storeId, [...names]);
    for (const name of names) {
      if (!values.has(name)) {
        throw new HttpCallError(
          'secret',
          `El secreto "${name}" no existe en la tienda. Créalo en Integraciones → Secretos.`,
          false,
        );
      }
    }
    const fill = (text: string) =>
      text.replace(SECRET_TOKEN, (_m, name: string) => values.get(name) ?? '');
    const secretValues = [...values.values()];

    const url = fill(urlTemplate);
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: '*/*',
    };
    for (const [name, raw] of headerPairs) {
      const value = fill(raw);
      if (CONTROL_CHARS.test(value)) {
        throw new HttpCallError(
          'invalid',
          `El encabezado ${name} contiene caracteres de control.`,
          false,
        );
      }
      headers[name] = value;
    }
    const body = bodyTemplate === undefined ? undefined : fill(bodyTemplate);
    if (body !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = looksLikeJson(body)
        ? 'application/json'
        : 'text/plain; charset=utf-8';
    }

    let target: URL;
    try {
      target = assertWebhookUrl(url, { allowHttp: true });
      await resolveAndVet(target.hostname, this.resolver);
    } catch (e) {
      if (e instanceof WebhookUrlError) throw blockedError(e);
      throw new HttpCallError('network', 'No se pudo resolver el destino.', true);
    }

    const started = Date.now();
    try {
      const res = await this.transport({
        method,
        url: target.toString(),
        headers,
        body,
        timeoutMs: timeoutSeconds * 1000,
        maxResponseBytes: HTTP_MAX_RESPONSE_BYTES,
      });
      return { ...res, duration_ms: Date.now() - started, secretValues };
    } catch (e) {
      if (e instanceof WebhookUrlError) throw blockedError(e);
      if (e instanceof OutboundTimeoutError) {
        throw new HttpCallError(
          'timeout',
          `El servicio no respondió en ${timeoutSeconds} segundos.`,
          true,
        );
      }
      const code = (e as { code?: string })?.code;
      throw new HttpCallError(
        'network',
        maskSecrets(
          `No se pudo conectar con el servicio${code ? ` (${code})` : ''}.`,
          secretValues,
        ),
        true,
      );
    }
  }
}

function looksLikeJson(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}
