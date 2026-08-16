/**
 * CONCEPTOS DE CORRECCIÓN DE NOTAS CRÉDITO Y DÉBITO (DIAN).
 *
 * Espejo EXACTO de
 * `apps/backend/src/domains/store/invoicing/providers/dian-direct/constants/dian-note-concepts.ts`
 * — mismos códigos, mismas etiquetas, verbatim de los `.gc`
 * `ConceptoNotaCredito-2.1.gc` (5 filas) y `ConceptoNotaDebito-2.1.gc` (4 filas).
 *
 * FORMATO: UN SOLO DÍGITO, SIN CERO A LA IZQUIERDA. El Schematron de 2019 usa
 * `01`…`06`, pero el Anexo Técnico 1.9 regla CAD02a cita el código como `"2"`,
 * y es lo que los builders del backend emiten. Manda el dígito simple.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE CATÁLOGO NO VIAJA AL BACKEND (leer antes de "arreglarlo")
 * ─────────────────────────────────────────────────────────────────────────────
 * Hoy el concepto NO se puede transmitir desde el panel, y no por falta de UI:
 *
 *  1. `CreateCreditNoteDto` / `CreateDebitNoteDto` no tienen campo de concepto.
 *  2. `invoices` no tiene columna donde guardarlo (no existe
 *     `discrepancy_response_code` ni equivalente en `schema.prisma`).
 *  3. `ubl-credit-note.builder.ts:131` y `ubl-debit-note.builder.ts:152`
 *     emiten `cac:DiscrepancyResponse/cbc:ResponseCode` con el literal `'2'`,
 *     HARDCODEADO.
 *
 * Y el `ValidationPipe` global corre con `forbidNonWhitelisted: true`
 * (`main.ts:205-206`), así que mandar `concept_code` no lo ignoraría en
 * silencio: devolvería 400 y la nota no se crearía.
 *
 * Entonces, ¿por qué existe el selector? Porque el concepto SÍ llega a la DIAN
 * por la otra puerta, la legible: el backend escribe `reason` en
 * `invoices.notes` (`credit-notes.service.ts:223`) y el builder publica ese
 * texto en `cbc:Description` del mismo `cac:DiscrepancyResponse`
 * (`ubl-credit-note.builder.ts:132-134`). Declarar el concepto ahí es lo único
 * que hoy queda registrado; esconder el catálogo dejaría al comerciante sin
 * saber siquiera que la elección existe.
 *
 * Lo que NO se hace es fingir: cuando el concepto elegido no coincide con el
 * que el backend va a emitir, el modal lo dice con todas sus letras en vez de
 * dar por hecho que se transmitió.
 */

/** Código de concepto tal y como viaja en `cbc:ResponseCode`. */
export type DianNoteConceptCode = string;

export interface DianNoteConcept {
  code: DianNoteConceptCode;
  label: string;
  /** Qué significa en la práctica, para el comerciante que no lee anexos. */
  hint: string;
}

/**
 * Conceptos de NOTA CRÉDITO. Fuente: `ConceptoNotaCredito-2.1.gc`.
 *
 * OJO con `'2'`: usarlo obliga a que `cbc:CustomizationID` sea `'20'`
 * (Anexo 1.9, regla CAD02a). El builder ya emite `'20'` siempre que la nota
 * referencia una factura, así que `'2'` es el único concepto hoy coherente
 * de punta a punta.
 */
export const DIAN_CREDIT_NOTE_CONCEPTS: readonly DianNoteConcept[] = [
  {
    code: '1',
    label:
      'Devolución parcial de los bienes y/o no aceptación parcial del servicio',
    hint: 'El adquiriente devolvió parte de lo facturado. La nota corrige solo esas líneas.',
  },
  {
    code: '2',
    label: 'Anulación de factura electrónica',
    hint: 'Deja sin efecto la factura completa. Es la salida cuando una factura ya aceptada se emitió por error.',
  },
  {
    code: '3',
    label: 'Rebaja o descuento parcial o total',
    hint: 'Se pactó un menor valor después de emitir. Los bienes no vuelven; baja el precio.',
  },
  {
    code: '4',
    label: 'Ajuste de precio',
    hint: 'El precio facturado estaba mal y se corrige a la baja.',
  },
  { code: '5', label: 'Otros', hint: 'Cualquier corrección a la baja que no encaje en las anteriores.' },
] as const;

/** Conceptos de NOTA DÉBITO. Fuente: `ConceptoNotaDebito-2.1.gc`. */
export const DIAN_DEBIT_NOTE_CONCEPTS: readonly DianNoteConcept[] = [
  {
    code: '1',
    label: 'Intereses',
    hint: 'Intereses de mora o de financiación sobre la factura original.',
  },
  {
    code: '2',
    label: 'Gastos por cobrar',
    hint: 'Gastos en que incurrió el vendedor y que se le trasladan al adquiriente.',
  },
  {
    code: '3',
    label: 'Cambio del valor',
    hint: 'El valor facturado quedó por debajo del real y se corrige al alza.',
  },
  { code: '4', label: 'Otro', hint: 'Cualquier corrección al alza que no encaje en las anteriores.' },
] as const;

/**
 * El concepto que el backend REALMENTE emite hoy en el XML, por tipo de nota.
 *
 * No es una preferencia ni un default configurable: es el literal que hay
 * escrito en los builders. Vive acá para que el modal pueda contrastar lo que
 * el usuario eligió contra lo que de verdad va a viajar, en vez de suponer que
 * coinciden.
 */
export const DIAN_HARDCODED_NOTE_CONCEPT: Readonly<
  Record<'credit' | 'debit', DianNoteConceptCode>
> = {
  credit: '2',
  debit: '2',
};

export function noteConcepts(
  type: 'credit' | 'debit',
): readonly DianNoteConcept[] {
  return type === 'credit'
    ? DIAN_CREDIT_NOTE_CONCEPTS
    : DIAN_DEBIT_NOTE_CONCEPTS;
}

export function findNoteConcept(
  type: 'credit' | 'debit',
  code: string,
): DianNoteConcept | null {
  return noteConcepts(type).find((concept) => concept.code === code) ?? null;
}
