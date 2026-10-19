/**
 * Texto visible de Vex/Vexi: catálogo cerrado en español de tienda.
 *
 * El backend manda códigos y notas pensadas para el modelo. Nada de eso llega
 * a la pantalla, a la voz ni a una notificación: lo que se muestra sale de
 * aquí y solo de aquí. Un código nuevo sin entrada cae en el texto genérico,
 * nunca en el código crudo.
 */

const NO_PERMISSION = 'No tienes permiso para esta consulta';
const GENERIC_READ = 'No pude consultar este dato';

/** Códigos conocidos → frase humana. Lo que no está aquí es {@link GENERIC_READ}. */
export const VEXI_ERROR_COPY: Readonly<Record<string, string>> = {
  NOT_ALLOWED: NO_PERMISSION,
  DENIED: NO_PERMISSION,
  FORBIDDEN: NO_PERMISSION,
  AI_AGENT_TOOL_NOT_ALLOWED: NO_PERMISSION,
  NOT_FOUND: 'No encontré ese dato',
  INVALID_ARGS: 'Me faltó un dato para hacer esta consulta',
  VALIDATION_ERROR: 'Me faltó un dato para hacer esta consulta',
  BUSINESS_REJECTED: 'La tienda no permitió hacer esto',
  TOOL_PREVIEW_REJECTED: 'La tienda no permitió hacer esto',
  AGENT_DEADLINE_EXCEEDED: 'La consulta tardó demasiado; inténtalo de nuevo',
  AGENT_CANCELLED: 'Detuviste esta consulta',
  PROVIDER_TRANSIENT: 'El servicio no respondió a tiempo; inténtalo de nuevo',
  HTTP_ERROR: GENERIC_READ,
};

/**
 * Códigos de transporte: la llamada no se ejecutó todavía, se reintenta sola.
 * No cuentan como fallo ni se muestran como «no se pudo».
 */
const NON_FAILURE_CODES: ReadonlySet<string> = new Set([
  'BATCH_NOT_DISPATCHED',
  'AI_AGENT_TOOL_STAGED',
  'AI_AGENT_TOOL_NOT_OFFERED',
]);

export function vexiIsNonFailureCode(code?: string | null): boolean {
  return !!code && NON_FAILURE_CODES.has(code.trim().toUpperCase());
}

/** Frase humana para un código; desconocido o vacío → texto genérico. */
export function vexiErrorText(code?: string | null): string {
  const key = (code ?? '').trim().toUpperCase();
  return (key && VEXI_ERROR_COPY[key]) || GENERIC_READ;
}

// ─── Conversación bloqueada (409) ───────────────────────────────────────────

export type VexiObjectiveConflict = 'requires_resume' | 'lease_busy';

export const VEXI_OBJECTIVE_CONFLICT_COPY: Readonly<
  Record<VexiObjectiveConflict, string>
> = {
  requires_resume:
    'Esta conversación quedó con un cambio pendiente de revisar.',
  lease_busy:
    'Todavía estoy terminando tu mensaje anterior; espera un momento.',
};

/** Etiqueta de la acción que abre una conversación nueva. */
export const VEXI_RESTART_LABEL = 'Empezar de nuevo';

const CONFLICT_BY_CODE: Readonly<Record<string, VexiObjectiveConflict>> = {
  AI_OBJECTIVE_REQUIRES_RESUME: 'requires_resume',
  AI_OBJECTIVE_LEASE_BUSY: 'lease_busy',
  AI_OBJECTIVE_LEASE_CHANGED: 'lease_busy',
};

function conflictFromText(text: string): VexiObjectiveConflict | null {
  for (const [code, kind] of Object.entries(CONFLICT_BY_CODE)) {
    if (text.includes(code)) return kind;
  }
  return null;
}

function conflictFromBody(
  body: unknown,
  depth: number,
): VexiObjectiveConflict | null {
  if (depth > 3 || body === null || body === undefined) return null;
  if (typeof body === 'string') return conflictFromText(body);
  if (typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
  for (const key of ['error_code', 'code']) {
    const code = value[key];
    if (typeof code === 'string' && CONFLICT_BY_CODE[code]) {
      return CONFLICT_BY_CODE[code];
    }
  }
  return (
    conflictFromBody(value['message'], depth + 1) ??
    conflictFromBody(value['error'], depth + 1)
  );
}

/**
 * Reconoce el 409 de objetivo bloqueado en cualquiera de las formas en que
 * llega: `HttpErrorResponse` (`error.error.error_code`, `error.error.code`,
 * `error.error.message.error_code`, `error.error.message` texto), un `Error`
 * cuyo mensaje trae el código, o el `error` de un frame SSE.
 */
export function parseVexiObjectiveConflict(
  error: unknown,
): VexiObjectiveConflict | null {
  return conflictFromBody(error, 0);
}

/** Inverso del catálogo: ¿este aviso visible es un conflicto de objetivo? */
export function vexiConflictFromNotice(
  notice: string | null | undefined,
): VexiObjectiveConflict | null {
  if (!notice) return null;
  const match = (
    Object.entries(VEXI_OBJECTIVE_CONFLICT_COPY) as [
      VexiObjectiveConflict,
      string,
    ][]
  ).find(([, text]) => text === notice);
  return match ? match[0] : null;
}

// ─── Detalle libre de un paso ───────────────────────────────────────────────

/** Vocabulario que delata una nota interna (misma familia que el gate noJargon). */
const INTERNAL_TEXT =
  /postcondici|search_tools|search_playbooks|load_playbook|playbook|objetivo original|next_step|next_action|semantic_status|requires_revalidation|Conservo el avance|evidencia suficiente|no está verificada|RECUPERACIÓN TÉCNICA|inferencia|schema|preflight|fingerprint|lease|tool_call:|objective:|\(interno\)|BATCH_NOT|AI_AGENT_/i;

/**
 * Detalle de un paso apto para pantalla: vacío si es un payload crudo (JSON)
 * o si trae vocabulario interno. Mejor no decir nada que filtrar una nota del
 * modelo.
 */
export function vexiVisibleDetail(text: string | null | undefined): string {
  const value = (text ?? '').trim();
  if (!value) return '';
  if (value.startsWith('{') || value.startsWith('[')) return '';
  return INTERNAL_TEXT.test(value) ? '' : value;
}
