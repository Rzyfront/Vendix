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
 * CÓMO VIAJA EL CONCEPTO (y por qué viaja por DOS caminos)
 * ─────────────────────────────────────────────────────────────────────────────
 * El código elegido sale del selector, va en `note_concept_code` del cuerpo de
 * la petición, lo valida `@IsIn` contra el catálogo del tipo de nota
 * correspondiente, se persiste en `invoices.note_concept_code` y los builders
 * lo emiten en `cac:DiscrepancyResponse/cbc:ResponseCode`.
 *
 * En paralelo, `buildNoteReason` antepone «[Concepto DIAN N — etiqueta]» al
 * motivo; ese texto acaba en `invoices.notes` y en el `cbc:Description` del
 * MISMO grupo UBL. Los dos caminos no compiten: el código lo lee un validador,
 * la descripción la lee una persona.
 *
 * HISTORIA, porque explica el default del backend: hasta agosto de 2026 no
 * existía ni el campo del DTO ni la columna, y los builders emitían el literal
 * `'2'` pasara lo que pasara — una nota por «Rebaja o descuento» le declaraba a
 * la DIAN «Anulación de factura electrónica». Por eso hoy una nota SIN concepto
 * (las creadas antes de la columna, o cualquier cliente de la API que no lo
 * mande) sigue saliendo con `'2'`: es compatibilidad, no preferencia.
 *
 * OJO al `ValidationPipe` global con `forbidNonWhitelisted: true`
 * (`main.ts:205-206`): cualquier campo que no esté declarado en el DTO produce
 * un 400. Renombrar `note_concept_code` en un solo lado rompe la creación de
 * notas por completo.
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
 * El concepto que el backend emite cuando la nota NO trae ninguno.
 *
 * Es el literal de compatibilidad de `ubl-credit-note.builder.ts` y
 * `ubl-debit-note.builder.ts`: lo que emitían SIEMPRE antes de que existiera
 * `invoices.note_concept_code`, y lo que siguen emitiendo para las notas que
 * nacieron con la columna en NULL. El modal ya no lo necesita —siempre manda un
 * concepto, el selector es `required`—, pero queda documentado acá porque es la
 * respuesta a «¿qué se declaró en las notas viejas?»: un '2'.
 *
 * Coincidencia engañosa: en nota crédito '2' es «Anulación de factura
 * electrónica» y en nota débito es «Gastos por cobrar». Mismo dígito,
 * significados sin relación.
 */
export const DIAN_FALLBACK_NOTE_CONCEPT: Readonly<
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
