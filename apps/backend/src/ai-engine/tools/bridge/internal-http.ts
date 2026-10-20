import { RequestContextService } from '@common/context/request-context.service';
import {
  agentDeadlineContext,
  createAgentOperation,
} from '../../tasks/agent-deadline';
import {
  domainScopeDecision,
  type DomainScopeDecision,
} from '../../../common/guards/domain-scope.rule';

/** D2 never borrows the historical process-global RequestContext fallback. */
export function internalRequestContext() {
  return agentDeadlineContext.getStore()
    ? RequestContextService.asyncLocalStorage.getStore()
    : RequestContextService.getContext();
}

/**
 * Si el `DomainScopeGuard` dejaría pasar al llamante por una ruta del catálogo
 * (`store/...`, `organization/...`, sin el prefijo `/api`).
 *
 * El puente replica la petición con el token del usuario, así que una ruta de
 * otro dominio termina SIEMPRE en 403: ofrecerla o despacharla solo produce un
 * resultado `blocked` y el aviso falso de permisos (E2E g09: a un STORE_ADMIN
 * se le ofreció `organization/payroll/settings`). Misma regla que el guard,
 * no una copia.
 *
 * Sin `app_type` en el contexto no se filtra: esa superficie no viene de un
 * request con JWT de dominio (pruebas, procesos internos) y el guard decide
 * igual en el salto HTTP; ocultar todo el catálogo ahí sería peor.
 */
export function callerDomainScope(catalogPath: string): DomainScopeDecision {
  const context = internalRequestContext();
  if (!context?.app_type && context?.is_super_admin !== true)
    return { allowed: true };
  return domainScopeDecision(
    context,
    `/api/${String(catalogPath ?? '').replace(/^\/+/, '')}`,
  );
}

/** Same guarded HTTP hop; the deadline covers headers AND response-body IO. */
export async function internalApiText(
  input: string | URL,
  init: RequestInit,
): Promise<{ response: Response; body: string }> {
  const deadline = createAgentOperation({ signal: init.signal ?? undefined });
  const request = async () => {
    const response = await fetch(
      input,
      deadline ? { ...init, signal: deadline.signal } : init,
    );
    const body = await response.text();
    return { response, body };
  };
  try {
    return deadline ? await deadline.run(request) : await request();
  } finally {
    deadline?.dispose();
  }
}

/**
 * How Vexi reaches the rest of the application: over HTTP, against this same
 * process, as the very user who asked.
 *
 * Shared by the generic write bridge and by the bulk-upload tools because both
 * need the identical property — the request traverses the real guard, interceptor
 * and ALS-scoping chain, so a tool cannot reach something the person's own browser
 * could not. Calling controller handlers directly would skip exactly those layers
 * and turn every tool into a potential privilege escalation.
 */
export function internalApiBase(): string {
  const port = process.env.PORT ?? '3000';
  const prefix = process.env.API_PREFIX || 'api';
  return `http://127.0.0.1:${port}/${prefix}`;
}

/**
 * The caller's own credential, plus their correlation id.
 *
 * Deliberately NOT a service account: the whole authorization story rests on
 * replaying the user's token, so an internal hop with elevated credentials would
 * silently void every permission check the tools depend on.
 */
export function internalAuthHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  const context = internalRequestContext();
  return {
    Authorization: `Bearer ${context?.access_token ?? ''}`,
    Accept: 'application/json',
    ...(context?.request_id ? { 'X-Request-Id': context.request_id } : {}),
    ...extra,
  };
}

/**
 * Rebuilds the `multipart/form-data` body a module's own screen would have sent.
 *
 * Every document-driven flow in the product is multipart — the purchase-order
 * `scan/confirm`, the expense receipt, the route sheet, the bulk analyzers — so a
 * JSON-only bridge could read an invoice and then have no way to hand it to the
 * endpoint that persists it.
 *
 * Nested objects are serialised as JSON strings, matching what a browser `FormData`
 * does: the DTOs on multipart routes parse them back with `@Transform`.
 *
 * No `Content-Type` is returned on purpose. undici sets it together with the
 * boundary token it generated, and overriding it makes multer parse an empty body.
 */
export function buildMultipartBody(params: {
  file: { buffer: Buffer; mimeType: string; fileName: string };
  fileField: string;
  fields?: Record<string, unknown>;
}): FormData {
  const form = new FormData();

  form.append(
    params.fileField,
    new Blob([new Uint8Array(params.file.buffer)], {
      type: params.file.mimeType,
    }),
    params.file.fileName,
  );

  for (const [key, value] of Object.entries(params.fields ?? {})) {
    if (value === undefined || value === null) continue;
    form.append(
      key,
      typeof value === 'object' ? JSON.stringify(value) : String(value),
    );
  }

  return form;
}
