import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';

import { AsyncJobStatus } from './async-job-poll.util';
import { ERROR_MESSAGES } from './error-messages';
import { parseApiError } from './parse-api-error';

/**
 * Who is to blame when an AI process fails (QUI-1020). The user sees a
 * different message for each, so "your document could not be read" is never
 * confused with "Vendix failed" or "the AI service is out of credits":
 * - `document`: the file itself (unreadable, wrong type, empty).
 * - `technical`: Vendix failed (a bug, S3, a 5xx, no connection).
 * - `ai_unavailable`: the AI service cannot answer (no credits, rate limited,
 *   not configured) or the store's plan ran out of AI quota.
 * - `stalled`: the job never finished (stuck worker, waited too long).
 *
 * Mirrors `apps/backend/src/common/ai-scan-jobs/ai-job-failure.util.ts`; the
 * server sends `error_category` in the job status, the local mapping is only
 * the fallback for HTTP errors and older status payloads.
 */
export type AiJobErrorCategory =
  | 'document'
  | 'technical'
  | 'ai_unavailable'
  | 'stalled';

export type AiUnavailableReason =
  | 'credits'
  | 'rate_limited'
  | 'not_configured'
  | 'plan_quota';

/** Real progress a handler reported (`job.updateProgress`). */
export interface AiJobRealProgress {
  done: number;
  total: number;
  stage?: string;
  /** What is counted ("filas", "páginas"): the bar then says "120 de 800 filas". */
  unit?: string;
}

/**
 * Additive metadata of `GET /ai-scan-jobs/:id` and the legacy AI queues'
 * status endpoints (QUI-1020). Every field is optional: mobile and older
 * endpoints keep working with `{status, result, error}` only.
 */
export interface AiJobStatusMeta {
  kind?: string;
  progress?: AiJobRealProgress | null;
  queued_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  server_time?: string | null;
  attempts_made?: number;
  max_attempts?: number;
  /** The server considers the job stuck and already alerted the team. */
  stalled?: boolean;
  error_category?: Exclude<AiJobErrorCategory, 'stalled'>;
  error_reason?: AiUnavailableReason;
}

export type AiJobStatus<T = unknown> = AsyncJobStatus<T> & AiJobStatusMeta;

/** Failure of an AI job, with the category the UI needs to explain it. */
export class AiScanJobError extends Error {
  override readonly name = 'AiScanJobError';

  constructor(
    message: string,
    readonly category: AiJobErrorCategory,
    readonly code: string | null = null,
    readonly reason: AiUnavailableReason | null = null,
    /** The server alerted the Vendix team (incident + e-mail). */
    readonly teamNotified = false,
  ) {
    super(message);
  }
}

/** What the progress panel shows for a failure. */
export interface AiJobErrorView {
  category: AiJobErrorCategory;
  reason: AiUnavailableReason | null;
  code: string | null;
  title: string;
  message: string;
  teamNotified: boolean;
}

const AI_UNAVAILABLE_CODES: Readonly<Record<string, AiUnavailableReason>> = {
  AI_PROVIDER_003: 'credits',
  AI_PROVIDER_004: 'rate_limited',
  AI_APP_004: 'rate_limited',
  AI_APP_001: 'not_configured',
  AI_APP_003: 'not_configured',
  AI_VISION_001: 'not_configured',
  AI_CONFIG_001: 'not_configured',
  AI_PROVIDER_002: 'not_configured',
};

/** Document-side suffixes of the scanners' error codes. */
const DOCUMENT_CODE_SUFFIXES = [
  '_PARSE_FAIL',
  '_INVALID_FILE',
  '_NO_FILE',
  '_NO_FILES',
  '_INCOMPLETE',
  '_UNSUPPORTED_TYPE',
  '_TOO_MANY_FILES',
];

const TITLES: Readonly<Record<AiJobErrorCategory, string>> = {
  document: 'No pudimos leer tu documento',
  technical: 'Tuvimos un problema técnico',
  ai_unavailable: 'El servicio de IA no está disponible',
  stalled: 'El proceso se quedó atascado',
};

export const AI_JOB_GENERIC_ERROR =
  'No se pudo procesar el documento. Intenta nuevamente.';

function classifyCode(code: string | null): {
  category: Exclude<AiJobErrorCategory, 'stalled'>;
  reason: AiUnavailableReason | null;
} {
  const c = (code ?? '').trim();
  const unavailable = AI_UNAVAILABLE_CODES[c];
  if (unavailable) return { category: 'ai_unavailable', reason: unavailable };
  if (c.startsWith('SUBSCRIPTION_')) {
    return { category: 'ai_unavailable', reason: 'plan_quota' };
  }
  if (DOCUMENT_CODE_SUFFIXES.some((suffix) => c.endsWith(suffix))) {
    return { category: 'document', reason: null };
  }
  return { category: 'technical', reason: null };
}

function messageFor(
  category: AiJobErrorCategory,
  reason: AiUnavailableReason | null,
  code: string | null,
  teamNotified: boolean,
): string {
  const known = code ? ERROR_MESSAGES[code] : undefined;
  switch (category) {
    case 'document':
      return (
        known ??
        'Revisa que el archivo sea legible y del tipo correcto, e intenta de nuevo.'
      );
    case 'ai_unavailable':
      if (reason === 'plan_quota') {
        return known ?? 'Se agotó la cuota de IA de tu plan para este periodo.';
      }
      if (reason === 'not_configured' && known) return known;
      return teamNotified
        ? 'El servicio de IA no está respondiendo en este momento; no es un problema de tu documento. Ya avisamos al equipo de Vendix. Tu archivo sigue cargado para que lo intentes más tarde.'
        : 'El servicio de IA no está respondiendo en este momento; no es un problema de tu documento. Intenta de nuevo en unos minutos.';
    case 'stalled':
      return teamNotified
        ? 'El análisis se quedó atascado y ya avisamos al equipo de Vendix. Tu archivo sigue cargado: puedes intentarlo de nuevo.'
        : 'El análisis tardó demasiado. Tu archivo sigue cargado: puedes intentarlo de nuevo en unos minutos.';
    case 'technical':
    default:
      return teamNotified
        ? 'Algo falló en Vendix al procesar tu archivo; no es un problema de tu documento. Ya avisamos al equipo. Tu archivo sigue cargado para que lo intentes de nuevo.'
        : 'Algo falló en Vendix al procesar tu archivo; no es un problema de tu documento. Tu archivo sigue cargado para que lo intentes de nuevo.';
  }
}

/** Builds the error of a job that ended in `failed`. */
export function aiJobErrorFromStatus(status: AiJobStatus): AiScanJobError {
  const code = status.error?.trim() || null;
  const local = classifyCode(code);
  const category = status.error_category ?? local.category;
  const reason =
    category === 'ai_unavailable'
      ? (status.error_reason ?? local.reason ?? 'not_configured')
      : null;
  // A final technical or AI-unavailable failure always opens an incident on
  // the server (except the store's own plan quota).
  const teamNotified =
    category === 'technical' ||
    (category === 'ai_unavailable' && reason !== 'plan_quota');
  return new AiScanJobError(
    messageFor(category, reason, code, teamNotified),
    category,
    code,
    reason,
    teamNotified,
  );
}

/** The job outlived the client's patience (or the server flagged it). */
export function aiJobStalledError(teamNotified: boolean): AiScanJobError {
  return new AiScanJobError(
    messageFor('stalled', null, null, teamNotified),
    'stalled',
    null,
    null,
    teamNotified,
  );
}

/**
 * Turns anything an AI process can throw (job failure, HTTP error on the
 * upload, timeout) into what the user must read.
 */
export function describeAiJobError(err: unknown): AiJobErrorView {
  if (err instanceof AiScanJobError) {
    return {
      category: err.category,
      reason: err.reason,
      code: err.code,
      title: TITLES[err.category],
      message: err.message,
      teamNotified: err.teamNotified,
    };
  }
  if (err instanceof TimeoutError) {
    return describeAiJobError(aiJobStalledError(false));
  }
  if (err instanceof HttpErrorResponse) {
    const parsed = parseApiError(err);
    const code = parsed.errorCode;
    let { category, reason } = classifyCode(code);
    if (!code) {
      const status = err.status;
      category =
        status === 400 || status === 413 || status === 415 || status === 422
          ? 'document'
          : 'technical';
    }
    const message =
      category === 'technical' && err.status === 0
        ? 'No pudimos conectar con Vendix. Revisa tu conexión; tu archivo sigue cargado para que lo intentes de nuevo.'
        : category === 'technical' || category === 'document'
          ? parsed.userMessage
          : messageFor(category, reason, code, false);
    return {
      category,
      reason,
      code,
      title: TITLES[category],
      message,
      teamNotified: false,
    };
  }
  const message =
    err instanceof Error && err.message ? err.message : AI_JOB_GENERIC_ERROR;
  return {
    category: 'technical',
    reason: null,
    code: null,
    title: TITLES.technical,
    message,
    teamNotified: false,
  };
}
