/**
 * Contador de caracteres para campos de texto acotados. F.3 del plan
 * CP-INVOICE-PROFILE-MIRROR-AIU.
 *
 * ## Por qué el contador se calcula, no se declara por campo
 *
 * El tope de cada campo (300 en la descripción de línea de una factura, 500
 * en la nota de cabecera, 500 en la descripción de línea de una nota crédito
 * o débito) sale del DTO del backend — ver F.1/F.5/F.6 del plan y los
 * docblocks de `CreateFacturaInvoiceItemDto`, `CreateInvoiceDto.notes` y
 * `CreateCreditNoteDto`/`CreateDebitNoteDto`. Esta utilidad no fija ningún
 * número: sólo mide cuánto falta y decide cuándo eso vale la pena mostrarse.
 *
 * ## Por qué el contador aparece «cuando queda poco» y no siempre
 *
 * El plan lo pide así (F.3, business decision): un contador permanente en 300
 * campos de línea sería ruido; uno que sólo aparece cerca del tope enseña la
 * regla en el momento en que importa, sin competir por atención el resto del
 * tiempo.
 */

/** A partir de cuántos caracteres restantes se pinta el contador. */
export const CHAR_COUNTER_WARNING_THRESHOLD = 20;

/** Cuánto falta para el tope. Negativo si ya se pasó. */
export function remainingChars(
  value: string | null | undefined,
  max: number,
): number {
  return max - (value ?? '').length;
}

/**
 * Si el contador debe pintarse: cuando quedan pocos caracteres o ya se pasó
 * el tope (el caso pegado que no debería poder ocurrir con `maxlength` nativo,
 * pero que el texto pegado desde el portapapeles sí puede producir en un
 * campo que no lleva el atributo — ver `TextareaComponent`).
 */
export function showCharCounter(
  value: string | null | undefined,
  max: number,
): boolean {
  return remainingChars(value, max) <= CHAR_COUNTER_WARNING_THRESHOLD;
}
