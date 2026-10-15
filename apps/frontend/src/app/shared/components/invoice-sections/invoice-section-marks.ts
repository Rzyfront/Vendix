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

/**
 * Etiqueta de texto en la esquina superior derecha del campo («IA» /
 * «Revisar»): la marca NO puede comunicarse sólo por el color del borde. Es un
 * pseudo-elemento, así que no altera el DOM ni el layout del control (sólo
 * añade `relative` al contenedor, que ya es un bloque de rejilla o flex). El
 * texto va en `text-text-primary` sobre un tinte suave para asegurar contraste.
 */
const MARK_BADGE_BASE =
  "relative after:pointer-events-none after:absolute after:-top-2 after:right-0 after:z-[1] after:rounded-full after:border after:px-1.5 after:text-[10px] after:font-semibold after:leading-4";

const AI_MARK_BADGE =
  "after:content-['IA'] after:border-primary/40 after:bg-primary/10 after:text-primary";

const PENDING_MARK_BADGE =
  "after:content-['Revisar'] after:border-warning/60 after:bg-warning/15 after:text-text-primary";

export interface InvoiceFieldMarkOptions {
  /**
   * Pinta la etiqueta de texto además del borde (por defecto sí). Las filas de
   * «Líneas» la apagan: su cabecera ya dice «IA» y «Revisar: …» con texto.
   */
  badge?: boolean;
}

/** Clases del contenedor de un campo según su marca; `''` sin marca. */
export function invoiceFieldMarkClass(
  mark: InvoiceFieldMark | null | undefined,
  options: InvoiceFieldMarkOptions = {},
): string {
  const badge = options.badge !== false;
  if (mark === 'pending') {
    return badge
      ? `${PENDING_MARK_CLASS} ${MARK_BADGE_BASE} ${PENDING_MARK_BADGE}`
      : PENDING_MARK_CLASS;
  }
  if (mark === 'ai') {
    return badge
      ? `${AI_MARK_CLASS} ${MARK_BADGE_BASE} ${AI_MARK_BADGE}`
      : AI_MARK_CLASS;
  }
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
