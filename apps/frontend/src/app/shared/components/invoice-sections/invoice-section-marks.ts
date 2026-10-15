/**
 * Marcas visuales de un campo PRECARGADO por fuera del operador (hoy: el
 * escáner IA de «Nueva factura»).
 *
 *  · `ai`      — lo escribió la IA: borde con el color de acento del tema. Es
 *                una propuesta, no un dato confirmado.
 *  · `pending` — la IA no lo encontró o no está segura: borde ámbar, «Revisar».
 *
 * Un solo acento (el primario) más el ámbar semántico de «revisar»: nada de
 * paleta por campo. Las clases se aplican al CONTENEDOR del control y alcanzan
 * al `input`/`select`/`textarea` interno, igual que el borde rojo de «falta
 * para emitir» de la página.
 */
export type InvoiceFieldMark = 'ai' | 'pending';

/** Marca por ruta de control (la misma ruta que usa el mapa de la sección). */
export type InvoiceFieldMarks = Readonly<Record<string, InvoiceFieldMark>>;

const AI_MARK_CLASS =
  '[&_input]:!border-[var(--color-primary)] [&_select]:!border-[var(--color-primary)] [&_textarea]:!border-[var(--color-primary)] [&_[role=button]]:!border-[var(--color-primary)]';

const PENDING_MARK_CLASS =
  '[&_input]:!border-[var(--color-warning)] [&_select]:!border-[var(--color-warning)] [&_textarea]:!border-[var(--color-warning)] [&_[role=button]]:!border-[var(--color-warning)]';

/** Clases del contenedor de un campo según su marca; `''` sin marca. */
export function invoiceFieldMarkClass(
  mark: InvoiceFieldMark | null | undefined,
): string {
  if (mark === 'pending') return PENDING_MARK_CLASS;
  if (mark === 'ai') return AI_MARK_CLASS;
  return '';
}

/**
 * Marcas de UNA fila de líneas: qué campos (nombres de control de la fila)
 * precargó la IA y cuáles quedaron por revisar, más un motivo corto opcional
 * («sin impuesto 19 % en el catálogo»).
 */
export interface LineasRowMark {
  ai: readonly string[];
  pending: readonly string[];
  note?: string | null;
}
