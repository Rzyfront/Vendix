/**
 * Conceptos de corrección de notas crédito y débito —
 * `cac:DiscrepancyResponse/cbc:ResponseCode`.
 *
 * Hasta ahora estos códigos vivían como literales sueltos dentro de los
 * builders (`ubl-credit-note.builder.ts` emite `'2'`, `ubl-debit-note.builder.ts`
 * emite `'2'`, `ubl-support-document.builder.ts` emite `'5'`), cada uno con su
 * propio comentario enumerando la tabla. Tres copias del mismo catálogo en
 * comentarios es exactamente la forma en que un código se desactualiza sin que
 * nadie lo note.
 *
 * FUENTES
 * -------
 * - `Listas de valores/ConceptoNotaCredito-2.1.gc` (5 filas) y
 *   `ConceptoNotaDebito-2.1.gc` (4 filas).
 * - Anexo Técnico 1.9 §13.2.7.4 (notas crédito) y §13.2.7.5 (notas débito), que
 *   remiten las tablas 13.2.4 y 13.2.5 a `Tablas Referenciadas`.
 *
 * FORMATO: UN SOLO DÍGITO, SIN CERO A LA IZQUIERDA
 * -----------------------------------------------
 * Es el punto que hay que no equivocar y hay dos fuentes que dicen cosas
 * distintas:
 *   - Los `.gc` de la v1.8 usan `1`…`5` / `1`…`4`.
 *   - El Schematron `DIAN_UBL21-listacodigos_v1.6.sch` (2019) usa `01`…`06` /
 *     `01`…`04`.
 * Desempata el anexo 1.9, regla **CAD02a**: «Indicador del tipo de operación,
 * cuando se utiliza el código **"2"** de la tabla 13.2.4 Concepto de Anulación
 * para Notas Crédito → CustomizationID debe ser igual a "20"». Cita el código
 * como `"2"`, sin cero. Manda el dígito simple, que además es lo que los
 * builders ya emiten.
 *
 * DISCREPANCIA ADICIONAL: el Schematron de 2019 admite un sexto concepto de
 * nota crédito (`06`). El `.gc` de la v1.8 solo trae cinco. Se toman los cinco
 * del `.gc` por ser la fuente más reciente de las dos.
 */

/**
 * Concepto de corrección de una NOTA CRÉDITO.
 * Fuente: `ConceptoNotaCredito-2.1.gc`, verbatim.
 */
export const DIAN_CREDIT_NOTE_CONCEPTS = {
  /** 1 — Devolución parcial de los bienes y/o no aceptación parcial del servicio. */
  PARTIAL_RETURN: '1',
  /**
   * 2 — Anulación de factura electrónica.
   * Es el concepto que emite hoy `ubl-credit-note.builder.ts`. Ojo: usarlo
   * obliga a que `cbc:CustomizationID` sea `'20'` (anexo 1.9, regla CAD02a).
   */
  INVOICE_VOID: '2',
  /** 3 — Rebaja o descuento parcial o total. */
  DISCOUNT: '3',
  /** 4 — Ajuste de precio. */
  PRICE_ADJUSTMENT: '4',
  /** 5 — Otros. */
  OTHER: '5',
} as const;

export type DianCreditNoteConcept =
  (typeof DIAN_CREDIT_NOTE_CONCEPTS)[keyof typeof DIAN_CREDIT_NOTE_CONCEPTS];

/** Etiquetas en español. Exhaustivo sobre `DianCreditNoteConcept`. */
export const DIAN_CREDIT_NOTE_CONCEPT_LABELS: Readonly<
  Record<DianCreditNoteConcept, string>
> = {
  '1': 'Devolución parcial de los bienes y/o no aceptación parcial del servicio',
  '2': 'Anulación de factura electrónica',
  '3': 'Rebaja o descuento parcial o total',
  '4': 'Ajuste de precio',
  '5': 'Otros',
};

/**
 * Concepto de corrección de una NOTA DÉBITO.
 * Fuente: `ConceptoNotaDebito-2.1.gc`, verbatim.
 */
export const DIAN_DEBIT_NOTE_CONCEPTS = {
  /** 1 — Intereses. */
  INTEREST: '1',
  /** 2 — Gastos por cobrar. Es el que emite hoy `ubl-debit-note.builder.ts`. */
  CHARGES_RECEIVABLE: '2',
  /** 3 — Cambio del valor. */
  VALUE_CHANGE: '3',
  /** 4 — Otro. */
  OTHER: '4',
} as const;

export type DianDebitNoteConcept =
  (typeof DIAN_DEBIT_NOTE_CONCEPTS)[keyof typeof DIAN_DEBIT_NOTE_CONCEPTS];

/** Etiquetas en español. Exhaustivo sobre `DianDebitNoteConcept`. */
export const DIAN_DEBIT_NOTE_CONCEPT_LABELS: Readonly<
  Record<DianDebitNoteConcept, string>
> = {
  '1': 'Intereses',
  '2': 'Gastos por cobrar',
  '3': 'Cambio del valor',
  '4': 'Otro',
};

/** `true` si el código es un concepto válido de nota crédito. */
export function isDianCreditNoteConcept(
  value: unknown,
): value is DianCreditNoteConcept {
  return (
    typeof value === 'string' &&
    (Object.values(DIAN_CREDIT_NOTE_CONCEPTS) as readonly string[]).includes(
      value,
    )
  );
}

/** `true` si el código es un concepto válido de nota débito. */
export function isDianDebitNoteConcept(
  value: unknown,
): value is DianDebitNoteConcept {
  return (
    typeof value === 'string' &&
    (Object.values(DIAN_DEBIT_NOTE_CONCEPTS) as readonly string[]).includes(
      value,
    )
  );
}

/**
 * Motivo del descuento o cargo — `cbc:AllowanceChargeReasonCode`.
 * Fuente: `Listas de valores/CodigoDescuento-2.1.gc` (2 filas).
 *
 * DISCREPANCIA: el Schematron de 2019 admite `00`…`11` (12 valores). El `.gc` de
 * la v1.8 reduce la tabla a dos. Manda el `.gc`; los otros diez no tienen
 * nombre en ninguna fuente disponible, así que enumerarlos sería declarar
 * códigos sin saber qué significan.
 */
export const DIAN_ALLOWANCE_CHARGE_REASONS = {
  /** 00 — Descuento no condicionado. */
  UNCONDITIONAL_DISCOUNT: '00',
  /** 01 — Descuento condicionado. */
  CONDITIONAL_DISCOUNT: '01',
} as const;

export type DianAllowanceChargeReason =
  (typeof DIAN_ALLOWANCE_CHARGE_REASONS)[keyof typeof DIAN_ALLOWANCE_CHARGE_REASONS];

/**
 * Tipo de precio de referencia — `cbc:PriceTypeCode`.
 * Fuente: `Listas de valores/CodigoPrecioReferencia-2.1.gc` (3 filas). Es el
 * código que acompaña a `cac:AlternativeConditionPrice` cuando la línea va a
 * precio cero (muestras, obsequios, autoconsumo).
 */
export const DIAN_REFERENCE_PRICE_TYPES = {
  /** 01 — Valor comercial. */
  COMMERCIAL: '01',
  /** 02 — Valor en inventarios. */
  INVENTORY: '02',
  /** 03 — Otro valor. */
  OTHER: '03',
} as const;

export type DianReferencePriceType =
  (typeof DIAN_REFERENCE_PRICE_TYPES)[keyof typeof DIAN_REFERENCE_PRICE_TYPES];

/**
 * Términos de entrega (INCOTERMS) — `cbc:LossRiskResponsibilityCode`.
 * Fuente: `Listas de valores/TipoEntrega-2.1.gc` (11 filas) + Anexo 1.9
 * §13.3.7. Relevante solo para factura de exportación.
 */
export const DIAN_DELIVERY_TERMS = {
  /** CFR — Costo y flete. */
  CFR: 'CFR',
  /** CIF — Costo, flete y seguro. */
  CIF: 'CIF',
  /** CIP — Transporte y seguro pagados hasta. */
  CIP: 'CIP',
  /** CPT — Transporte pagado hasta. */
  CPT: 'CPT',
  /** DAP — Entregado en un lugar. */
  DAP: 'DAP',
  /** DAT — Entregado en terminal. */
  DAT: 'DAT',
  /** DDP — Entregado con pago de derechos. */
  DDP: 'DDP',
  /** EXW — En fábrica. */
  EXW: 'EXW',
  /** FAS — Franco al costado del buque. */
  FAS: 'FAS',
  /** FCA — Franco transportista. */
  FCA: 'FCA',
  /** FOB — Franco a bordo. */
  FOB: 'FOB',
} as const;

export type DianDeliveryTerm =
  (typeof DIAN_DELIVERY_TERMS)[keyof typeof DIAN_DELIVERY_TERMS];
