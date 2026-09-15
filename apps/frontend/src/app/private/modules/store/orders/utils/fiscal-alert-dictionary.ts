/**
 * C.9 CP-pos-exclusive-tax-double-charge — Diccionario de alerta fiscal.
 *
 * Mapa `fiscal_alert_code → { título, cuerpo, acción }` para el banner del
 * detalle de orden (`order-details-page.component.html`). El copy del banner
 * es derivado del código, nunca fijo: un código nuevo sin entrada hereda la
 * fila *default*, que ordena NO emitir y lleva a soporte.
 *
 * Regla dura del paso: si este diccionario no entra en el PR, D.5 no puede
 * escribir `POS_EXCLUSIVE_TAX_DOUBLE` — un marcador con instrucción falsa
 * (emitir) quema un consecutivo con base inflada.
 *
 * - `INVOICE_AUTO_SEND_FAILED`: conserva el comportamiento de hoy, explícito.
 * - `POS_EXCLUSIVE_TAX_DOUBLE` (24 caracteres, cabe en `VarChar(60)` del
 *   `schema.prisma`): la orden se cobró de más; la acción es ver la
 *   devolución y el CTA de emisión queda oculto (`allowEmitInvoiceCta: false`).
 * - Fila *default*: código desconocido → no emitir nunca, CTA de soporte.
 */

export type FiscalAlertActionKind = 'emit-invoice' | 'open-refund' | 'support';

export interface FiscalAlertAction {
  kind: FiscalAlertActionKind;
  label: string;
}

export interface FiscalAlertEntry {
  title: string;
  body: string;
  action: FiscalAlertAction;
  /**
   * ¿Puede seguir visible el CTA «Emitir factura electrónica» mientras este
   * código está puesto? Sólo `true` para el fallo de auto-envío. Un código
   * desconocido nunca ofrece emitir.
   */
  allowEmitInvoiceCta: boolean;
}

export const INVOICE_AUTO_SEND_FAILED = 'INVOICE_AUTO_SEND_FAILED';
export const POS_EXCLUSIVE_TAX_DOUBLE = 'POS_EXCLUSIVE_TAX_DOUBLE';

const FISCAL_ALERT_DICTIONARY: Record<string, FiscalAlertEntry> = {
  [INVOICE_AUTO_SEND_FAILED]: {
    title: 'Factura sin emitir',
    body: 'El envío automático a la DIAN falló para esta orden. Revísala en el módulo de facturación.',
    action: { kind: 'emit-invoice', label: 'Emitir manualmente' },
    allowEmitInvoiceCta: true,
  },
  [POS_EXCLUSIVE_TAX_DOUBLE]: {
    title: 'Esta orden se cobró de más',
    body: 'El IVA se aplicó dos veces al cobrar. El cliente pagó de más. No emitas la factura: primero registra la devolución del excedente.',
    action: { kind: 'open-refund', label: 'Ver devolución' },
    allowEmitInvoiceCta: false,
  },
};

export const FISCAL_ALERT_DEFAULT: FiscalAlertEntry = {
  title: 'Alerta fiscal',
  body: 'Esta orden tiene una marca fiscal que este panel no reconoce. No emitas el documento hasta revisarla.',
  action: { kind: 'support', label: 'Contactar soporte' },
  allowEmitInvoiceCta: false,
};

/** Resuelve la entrada del diccionario; cualquier código no listado da la fila *default*. */
export function resolveFiscalAlert(code: string): FiscalAlertEntry {
  return FISCAL_ALERT_DICTIONARY[code] ?? FISCAL_ALERT_DEFAULT;
}
