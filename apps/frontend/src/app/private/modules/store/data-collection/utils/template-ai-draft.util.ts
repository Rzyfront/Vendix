/** Pure decision logic for "Crear con IA (PDF/foto)". */

export const AI_DRAFT_MAX_BYTES = 10 * 1024 * 1024;
export const AI_DRAFT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp';
/** Polling cadence and hard stop (about 4 minutes). */
export const AI_DRAFT_POLL_INTERVAL_MS = 2500;
export const AI_DRAFT_POLL_TIMEOUT_MS = 4 * 60 * 1000;
/** Consecutive transient poll failures tolerated before giving up. */
export const AI_DRAFT_MAX_TRANSIENT_RETRIES = 3;

const ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'webp'];
const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

export interface AiDraftFileLike {
  name: string;
  type: string;
  size: number;
}

export type AiDraftFileCheck = { ok: true } | { ok: false; message: string };

export function validateAiDraftFile(file: AiDraftFileLike): AiDraftFileCheck {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  const typeOk = file.type ? ALLOWED_MIME.includes(file.type.toLowerCase()) : ALLOWED_EXTENSIONS.includes(ext);
  if (!typeOk) {
    return { ok: false, message: 'Formato no admitido. Sube un PDF o una imagen JPG, PNG o WEBP.' };
  }
  if (file.size <= 0) {
    return { ok: false, message: 'El archivo está vacío.' };
  }
  if (file.size > AI_DRAFT_MAX_BYTES) {
    return { ok: false, message: 'El archivo es demasiado grande (máximo 10 MB).' };
  }
  return { ok: true };
}

export interface AiDraftPathError {
  path: string;
  message: string;
}

export type AiDraftStatusResponse =
  | { status: 'pending' }
  | { status: 'done'; json: unknown; errors: AiDraftPathError[] }
  | {
      status: 'failed';
      error_code: string | null;
      error_reason?: 'credits' | 'rate_limited' | 'not_configured' | 'plan_quota';
      message: string;
    };

export type AiDraftUiState =
  | { kind: 'pending' }
  | { kind: 'done'; text: string; errors: AiDraftPathError[] }
  | { kind: 'failed'; message: string };

export const AI_DRAFT_NO_VISION_MESSAGE =
  'Esta tienda no tiene un modelo de IA con visión configurado. Contacta al administrador.';
export const AI_DRAFT_QUOTA_MESSAGE =
  'La cuota de IA está agotada. Intenta más tarde o contacta al administrador.';

export function mapAiDraftStatus(res: AiDraftStatusResponse): AiDraftUiState {
  if (res.status === 'pending') return { kind: 'pending' };
  if (res.status === 'done') {
    return {
      kind: 'done',
      text: JSON.stringify(res.json, null, 2),
      errors: Array.isArray(res.errors) ? res.errors : [],
    };
  }
  if (res.error_reason === 'not_configured' || res.error_code === 'AI_VISION_001') {
    return { kind: 'failed', message: AI_DRAFT_NO_VISION_MESSAGE };
  }
  if (res.error_reason === 'plan_quota') {
    return { kind: 'failed', message: AI_DRAFT_QUOTA_MESSAGE };
  }
  return { kind: 'failed', message: res.message || 'No se pudo generar el borrador.' };
}

/** Transient poll errors: network (0) and 5xx. */
export function isTransientPollError(status: number | undefined): boolean {
  return status === 0 || (typeof status === 'number' && status >= 500);
}
