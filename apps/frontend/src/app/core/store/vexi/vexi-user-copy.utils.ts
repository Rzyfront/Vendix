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

/**
 * Mensajes humanos del 409 `AI_OBJECTIVE_REQUIRES_RESUME` tal como los escribe
 * el backend (`agent-durable-session.service.ts`, `resumeRequired`). Lista
 * blanca: solo una de estas frases exactas se muestra tal cual; cualquier otro
 * texto del 409 cae en {@link VEXI_OBJECTIVE_CONFLICT_COPY}.
 */
export const VEXI_OBJECTIVE_SERVER_NOTICES: readonly string[] = [
  'Tienes una propuesta pendiente en esta conversación. Apruébala o recházala antes de pedir otra cosa.',
  'No pude confirmar si el último cambio se aplicó. Revisa ese registro antes de pedir otro cambio, o inicia una conversación nueva.',
  'Este trabajo venció. Para retomarlo, confírmalo de nuevo; sus datos se volverán a consultar.',
  'Este trabajo está detenido. Reanúdalo cuando esté resuelto, o inicia una conversación nueva para otra solicitud.',
];

function serverNoticeFrom(body: unknown, depth: number): string | null {
  if (depth > 3 || body === null || body === undefined) return null;
  if (typeof body === 'string') {
    const text = body.trim();
    return VEXI_OBJECTIVE_SERVER_NOTICES.includes(text) ? text : null;
  }
  if (typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
  return (
    serverNoticeFrom(value['message'], depth + 1) ??
    serverNoticeFrom(value['error'], depth + 1)
  );
}

/**
 * Aviso visible de un 409 de objetivo: la frase específica del backend si es
 * una del catálogo (propuesta pendiente, efecto incierto, vencido, detenido);
 * si no, la genérica del tipo de conflicto. `null` si no es un 409 de objetivo.
 */
export function vexiObjectiveConflictNotice(error: unknown): string | null {
  const kind = parseVexiObjectiveConflict(error);
  if (!kind) return null;
  return (
    (kind === 'requires_resume' ? serverNoticeFrom(error, 0) : null) ??
    VEXI_OBJECTIVE_CONFLICT_COPY[kind]
  );
}

/** Inverso del catálogo: ¿este aviso visible es un conflicto de objetivo? */
export function vexiConflictFromNotice(
  notice: string | null | undefined,
): VexiObjectiveConflict | null {
  if (!notice) return null;
  if (VEXI_OBJECTIVE_SERVER_NOTICES.includes(notice)) return 'requires_resume';
  const match = (
    Object.entries(VEXI_OBJECTIVE_CONFLICT_COPY) as [
      VexiObjectiveConflict,
      string,
    ][]
  ).find(([, text]) => text === notice);
  return match ? match[0] : null;
}

// ─── Detalle de un paso ─────────────────────────────────────────────────────

/**
 * Notas de paso que el backend emite para la persona (`USER_TOOL_NOTES` en
 * `agent-execution.contract.ts`) más las propias del frontend. Lista blanca:
 * el resumen de un paso solo se muestra si es exactamente una de estas.
 */
export const VEXI_STEP_DETAIL_COPY: readonly string[] = [
  'Preparando la consulta.',
  'Sin acceso con tu usuario o plan actual.',
  'No se pudo confirmar el resultado.',
  'Esperando tu aprobación.',
  'Falta un dato para continuar.',
  'No se pudo consultar este dato.',
  'Faltan argumentos válidos.',
  'Esperando confirmación del usuario.',
  'No se pudo preparar el cambio.',
  'Pendiente de la aprobación anterior.',
];

/**
 * Detalle de un paso apto para pantalla: solo una frase del catálogo cerrado.
 * Un payload, una nota del recibo o un `next_step` («Cuéntale…», «Usa
 * search_tools…») nunca se muestran: mejor no decir nada que filtrar una nota
 * del modelo.
 */
export function vexiVisibleDetail(text: string | null | undefined): string {
  const value = (text ?? '').trim();
  return VEXI_STEP_DETAIL_COPY.includes(value) ? value : '';
}

// ─── Andamiaje del runtime ──────────────────────────────────────────────────

/**
 * Herramientas de descubrimiento y del plan interno: andamiaje del agente,
 * no trabajo sobre el negocio. No aparecen en el rastro ni cuentan como
 * «consulté N datos».
 */
const SCAFFOLD_TOOLS: ReadonlySet<string> = new Set([
  'search_tools',
  'search_playbooks',
  'load_playbook',
  'load_recipe',
  'propose_plan',
  'update_plan_step',
  'verify_deliverables',
  'ask_user',
  'revise_plan',
  'pause_plan',
  'resume_plan',
]);

export function vexiIsScaffoldTool(name: string): boolean {
  return SCAFFOLD_TOOLS.has(name);
}
