/**
 * TRADUCCIÓN DE LOS ESTADOS FISCALES DE UNA FACTURA.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. `invoices` no tiene UN estado, tiene CUATRO, y
 * cada uno responde una pregunta distinta que el comerciante necesita separada:
 *
 *   · `status`              — dónde está el documento en el flujo de Vendix.
 *   · `transmission_status` — qué pasó con el ENVÍO (firma, cola, contingencia).
 *   · `dian_status`         — qué dijo la DIAN.
 *   · `accounting_status`   — si el asiento ya quedó posteado.
 *
 * Antes el detalle pintaba `status` y escupía `send_status` en crudo
 * (`sent_error`, literal, en inglés y sin contexto). Los otros tres ni se
 * mostraban: una factura en contingencia —válida, entregada y con 48 h de plazo
 * para transmitir— se veía EXACTAMENTE igual que una que nadie envió nunca.
 *
 * TODAS las etiquetas de acá salen de columnas VERIFICADAS en
 * `apps/backend/prisma/schema.prisma` (modelo `invoices`, enums
 * `fiscal_transmission_status_enum`, `dian_document_status_enum`,
 * `fiscal_accounting_status_enum`, `document_send_status_enum`). Un valor que no
 * esté en el enum cae al propio código crudo en vez de inventar una traducción:
 * mostrar el valor real es preferible a mostrar una etiqueta bonita y falsa.
 */

import { Invoice } from '../../interfaces/invoice.interface';

/**
 * Tono visual del badge. Se mapea a los tokens del tema —nunca a un hex— porque
 * el mismo componente se pinta en claro y oscuro.
 */
export type FiscalTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

const TONE_CLASSES: Record<FiscalTone, string> = {
  neutral: 'bg-[var(--color-surface-secondary)] text-text-secondary',
  info: 'bg-[var(--color-info-light)] text-[var(--color-info)]',
  success: 'bg-success-light text-success',
  warning: 'bg-warning-light text-warning',
  error: 'bg-error-light text-error',
};

export function toneClasses(tone: FiscalTone): string {
  return TONE_CLASSES[tone];
}

/** Una celda del tablero de estados fiscales. */
export interface FiscalStatusCell {
  /** Qué pregunta responde esta columna. */
  label: string;
  /** Valor traducido; el código crudo cuando no está en el enum conocido. */
  text: string;
  tone: FiscalTone;
  /** Explicación de una línea. `null` cuando la etiqueta ya se basta sola. */
  hint: string | null;
}

// ── transmission_status (fiscal_transmission_status_enum) ─────

const TRANSMISSION_LABELS: Record<string, string> = {
  draft: 'Borrador',
  queued: 'En cola',
  signing: 'Firmando',
  signed: 'Firmado',
  submitted: 'Transmitido',
  accepted: 'Aceptado por la DIAN',
  rejected: 'Rechazado por la DIAN',
  error: 'Error de transmisión',
  retrying: 'Reintentando',
  cancelled: 'Cancelado',
  contingency: 'Expedido en contingencia',
};

const TRANSMISSION_TONES: Record<string, FiscalTone> = {
  draft: 'neutral',
  queued: 'info',
  signing: 'info',
  signed: 'info',
  submitted: 'info',
  accepted: 'success',
  rejected: 'error',
  error: 'error',
  retrying: 'warning',
  cancelled: 'neutral',
  contingency: 'warning',
};

const TRANSMISSION_HINTS: Record<string, string> = {
  contingency:
    'Entregado al adquiriente SIN validación previa de la DIAN. Debe transmitirse dentro de las 48 h siguientes.',
  retrying: 'La transmisión falló por una causa transitoria y se está reintentando sola.',
  error: 'La transmisión no llegó a la DIAN. No es un rechazo: el documento no fue juzgado.',
};

// ── dian_status (dian_document_status_enum) ───────────────────

const DIAN_LABELS: Record<string, string> = {
  pending: 'Pendiente de validación',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
  error: 'Error',
  not_applicable: 'No aplica',
};

const DIAN_TONES: Record<string, FiscalTone> = {
  pending: 'warning',
  accepted: 'success',
  rejected: 'error',
  error: 'error',
  not_applicable: 'neutral',
};

const DIAN_HINTS: Record<string, string> = {
  not_applicable:
    'Este documento no es electrónico: no se transmitió a la DIAN y no tiene CUFE. Es un comprobante interno.',
  pending: 'La DIAN todavía no ha emitido veredicto sobre este documento.',
};

// ── accounting_status (fiscal_accounting_status_enum) ─────────

const ACCOUNTING_LABELS: Record<string, string> = {
  blocked: 'Bloqueado',
  provisional: 'Provisional',
  posted: 'Contabilizado',
  reversed: 'Reversado',
  not_applicable: 'No aplica',
};

const ACCOUNTING_TONES: Record<string, FiscalTone> = {
  blocked: 'error',
  provisional: 'warning',
  posted: 'success',
  reversed: 'neutral',
  not_applicable: 'neutral',
};

const ACCOUNTING_HINTS: Record<string, string> = {
  blocked: 'El asiento contable no se generará mientras el documento siga en este estado.',
  provisional: 'Hay asiento, pero todavía puede cambiar: el documento no está en firme.',
};

// ── send_status (document_send_status_enum) ───────────────────

const SEND_LABELS: Record<string, string> = {
  pending: 'Pendiente de envío',
  sending: 'Enviando',
  sent_ok: 'Enviado',
  sent_error: 'Falló el envío',
  not_applicable: 'No aplica',
};

const SEND_TONES: Record<string, FiscalTone> = {
  pending: 'warning',
  sending: 'info',
  sent_ok: 'success',
  sent_error: 'error',
  not_applicable: 'neutral',
};

/**
 * El tablero completo, en el orden en que se lee una emisión: se envía, la DIAN
 * responde, y sólo entonces la contabilidad se mueve.
 *
 * Cada celda se OMITE cuando la columna no viene en el payload. Las tres
 * columnas de estado fiscal son NOT NULL con DEFAULT en la base, así que en la
 * práctica siempre llegan; el guard existe porque el detalle también se pinta
 * con la fila de la lista, y una respuesta vieja en caché podría no traerlas.
 * Pintar «—» sería inventar un estado que la base nunca tuvo.
 */
export function fiscalStatusCells(invoice: Invoice): FiscalStatusCell[] {
  const cells: FiscalStatusCell[] = [];

  if (invoice.transmission_status) {
    cells.push(
      buildCell(
        'Transmisión',
        invoice.transmission_status,
        TRANSMISSION_LABELS,
        TRANSMISSION_TONES,
        TRANSMISSION_HINTS,
      ),
    );
  }

  if (invoice.dian_status) {
    cells.push(
      buildCell('DIAN', invoice.dian_status, DIAN_LABELS, DIAN_TONES, DIAN_HINTS),
    );
  }

  if (invoice.send_status) {
    cells.push(buildCell('Envío', invoice.send_status, SEND_LABELS, SEND_TONES, {}));
  }

  if (invoice.accounting_status) {
    cells.push(
      buildCell(
        'Contabilidad',
        invoice.accounting_status,
        ACCOUNTING_LABELS,
        ACCOUNTING_TONES,
        ACCOUNTING_HINTS,
      ),
    );
  }

  return cells;
}

function buildCell(
  label: string,
  value: string,
  labels: Record<string, string>,
  tones: Record<string, FiscalTone>,
  hints: Record<string, string>,
): FiscalStatusCell {
  return {
    label,
    // Sin traducción conocida se muestra el valor CRUDO. Un enum nuevo del
    // backend debe verse tal cual y delatarse, no disfrazarse de «Desconocido».
    text: labels[value] ?? value,
    tone: tones[value] ?? 'neutral',
    hint: hints[value] ?? null,
  };
}

// ─────────────────────────────────────────────────────────────
// Contingencia y su plazo de 48 h
// ─────────────────────────────────────────────────────────────

/**
 * `invoices.contingency_type` — códigos del Anexo Técnico 1.9 §12.
 * Verificados en el schema: `contingency_type String? @db.VarChar(2)`.
 */
const CONTINGENCY_TYPE_LABELS: Record<string, string> = {
  '03': 'Contingencia del facturador',
  '04': 'Indisponibilidad de la DIAN',
};

export interface ContingencyWindow {
  /** '03' | '04' tal como lo persiste el backend. */
  type: string;
  typeLabel: string;
  /** ISO del instante en que se declaró. */
  declaredAt: string | null;
  /** ISO del vencimiento de las 48 h, **persistido** por el backend. */
  deadline: string | null;
  reason: string | null;
  /**
   * Milisegundos que faltan (negativo = vencido). `null` cuando el backend NO
   * dejó `contingency_deadline`: en ese caso NO se calcula nada a mano —
   * `InvoiceRetryQueueService.declareContingency()` es el único dueño del
   * arranque del plazo, y recalcularlo desde `contingency_declared_at` en el
   * navegador produciría una segunda verdad que se desviaría de la del backend.
   */
  remainingMs: number | null;
  expired: boolean;
  /** «Quedan 11 h 42 min» / «Venció hace 3 h 10 min». `null` sin `deadline`. */
  countdown: string | null;
}

/**
 * Lee la ventana de contingencia de la factura.
 *
 * Devuelve `null` cuando el documento NO está en contingencia. El disparador es
 * `contingency_type`, no `transmission_status`: la columna es la que el backend
 * escribe de forma idempotente (`declareContingency` preserva el plazo original
 * en un reintento), mientras `transmission_status` sí se mueve cuando la
 * retransmisión finalmente entra.
 *
 * @param nowMs instante de referencia. Se recibe como parámetro —y no se lee
 *        `Date.now()` acá dentro— para que el componente pueda derivarlo de una
 *        señal que late: en zoneless, un `Date.now()` dentro de un `computed`
 *        se congela en el primer cálculo y la cuenta regresiva nunca avanza.
 */
export function readContingency(
  invoice: Invoice,
  nowMs: number,
): ContingencyWindow | null {
  const type = invoice.contingency_type;
  if (!type) {
    return null;
  }

  const deadline = invoice.contingency_deadline ?? null;
  const deadlineMs = deadline ? new Date(deadline).getTime() : NaN;
  const hasDeadline = Number.isFinite(deadlineMs);
  const remainingMs = hasDeadline ? deadlineMs - nowMs : null;

  return {
    type,
    typeLabel: CONTINGENCY_TYPE_LABELS[type] ?? `Contingencia tipo ${type}`,
    declaredAt: invoice.contingency_declared_at ?? null,
    deadline,
    reason: invoice.contingency_reason ?? null,
    remainingMs,
    expired: remainingMs != null && remainingMs <= 0,
    countdown:
      remainingMs == null
        ? null
        : remainingMs > 0
          ? `Quedan ${formatDuration(remainingMs)}`
          : `Venció hace ${formatDuration(-remainingMs)}`,
  };
}

/** «11 h 42 min» / «42 min» / «menos de 1 min». */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(Math.max(ms, 0) / 60_000);
  if (totalMinutes < 1) {
    return 'menos de 1 min';
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

// ─────────────────────────────────────────────────────────────
// Cola de reintentos
// ─────────────────────────────────────────────────────────────

/**
 * `invoice_retry_queue.status` — verificado en `invoice-retry-queue.service.ts`
 * (`RETRY_STATUS`). `contingency` es terminal PARA LA COLA, no para el
 * documento: significa que se agotaron los reintentos reglamentados y el
 * documento se expidió bajo contingencia.
 */
const RETRY_STATUS_LABELS: Record<string, string> = {
  pending: 'En cola de reintento',
  processing: 'Reintentando ahora',
  completed: 'Reintento exitoso',
  failed: 'Reintentos agotados',
  contingency: 'Escalado a contingencia',
};

const RETRY_STATUS_TONES: Record<string, FiscalTone> = {
  pending: 'info',
  processing: 'info',
  completed: 'success',
  failed: 'error',
  contingency: 'warning',
};

export function retryStatusLabel(status: string): string {
  return RETRY_STATUS_LABELS[status] ?? status;
}

export function retryStatusTone(status: string): FiscalTone {
  return RETRY_STATUS_TONES[status] ?? 'neutral';
}

// ─────────────────────────────────────────────────────────────
// Eventos RADIAN (Res. 000085/2022)
// ─────────────────────────────────────────────────────────────

/**
 * Etiquetas de `dian_document_events.event_code`, COPIADAS VERBATIM de
 * `DIAN_EVENT_LABELS` en
 * `apps/backend/.../providers/dian-direct/constants/dian-endpoints.ts`
 * (numeral 14.2.1 del Anexo Técnico).
 *
 * Se duplican y no se importan porque el frontend no puede alcanzar el backend;
 * el riesgo de deriva se acota igual que en el resto del módulo: un código sin
 * etiqueta se pinta con su número crudo (`Evento 052`) en vez de desaparecer.
 */
const DIAN_EVENT_LABELS: Record<string, string> = {
  '030': 'Acuse de recibo de la factura',
  '031': 'Reclamo de la factura',
  '032': 'Recibo del bien o servicio',
  '033': 'Aceptación expresa',
  '034': 'Aceptación tácita',
  '035': 'Aval',
  '036': 'Inscripción en el RADIAN como título valor',
  '037': 'Endoso en propiedad',
  '038': 'Endoso en garantía',
  '039': 'Endoso en procuración',
  '040': 'Cancelación de endoso',
  '041': 'Limitación para circulación',
  '042': 'Terminación de la limitación para circulación',
  '043': 'Mandato',
  '044': 'Terminación del mandato',
  '045': 'Pago de la factura como título valor',
  '046': 'Informe para el pago',
  '047': 'Endoso con efectos de cesión ordinaria',
  '048': 'Protesto',
  '049': 'Transferencia de los derechos económicos',
  '050': 'Notificación al deudor sobre la transferencia de derechos económicos',
  '051': 'Pago de la transferencia de los derechos económicos',
};

export function dianEventLabel(code: string): string {
  return DIAN_EVENT_LABELS[code] ?? `Evento ${code}`;
}

/**
 * `dian_document_events.status` — verificado en `DIAN_EVENT_STATUS`
 * (`dian-events.service.ts`). Es un `VarChar(20)` con default `'pending'`, no un
 * enum de Postgres, así que el fallback al valor crudo importa más acá.
 */
const EVENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
  error: 'Error',
};

const EVENT_STATUS_TONES: Record<string, FiscalTone> = {
  pending: 'warning',
  accepted: 'success',
  rejected: 'error',
  error: 'error',
};

export function dianEventStatusLabel(status: string): string {
  return EVENT_STATUS_LABELS[status] ?? status;
}

export function dianEventStatusTone(status: string): FiscalTone {
  return EVENT_STATUS_TONES[status] ?? 'neutral';
}
