import { RequestContextService } from '@common/context/request-context.service';

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
  const context = RequestContextService.getContext();
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
