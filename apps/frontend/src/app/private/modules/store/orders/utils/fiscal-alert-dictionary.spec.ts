import {
  FISCAL_ALERT_DEFAULT,
  INVOICE_AUTO_SEND_FAILED,
  POS_EXCLUSIVE_TAX_DOUBLE,
  resolveFiscalAlert,
} from './fiscal-alert-dictionary';

/**
 * C.9 CP-pos-exclusive-tax-double-charge — diccionario de alerta fiscal.
 *
 * Tres filas (dos códigos + *default*) y la invariante que sostiene el paso:
 * sólo el fallo de auto-envío conserva el CTA de emisión.
 */
describe('resolveFiscalAlert', () => {
  it('resuelve INVOICE_AUTO_SEND_FAILED con el comportamiento de hoy, explícito', () => {
    const entry = resolveFiscalAlert(INVOICE_AUTO_SEND_FAILED);
    expect(entry.title).toBe('Factura sin emitir');
    expect(entry.action).toEqual({ kind: 'emit-invoice', label: 'Emitir manualmente' });
    expect(entry.allowEmitInvoiceCta).toBe(true);
  });

  it('resuelve POS_EXCLUSIVE_TAX_DOUBLE sin CTA de emisión y con CTA de devolución', () => {
    expect(POS_EXCLUSIVE_TAX_DOUBLE.length).toBeLessThanOrEqual(60);
    const entry = resolveFiscalAlert(POS_EXCLUSIVE_TAX_DOUBLE);
    expect(entry.title).toBe('Esta orden se cobró de más');
    expect(entry.action).toEqual({ kind: 'open-refund', label: 'Ver devolución' });
    expect(entry.allowEmitInvoiceCta).toBe(false);
  });

  it('un código desconocido cae en la fila default: nunca emitir, CTA de soporte', () => {
    const entry = resolveFiscalAlert('CODIGO_INVENTADO');
    expect(entry).toBe(FISCAL_ALERT_DEFAULT);
    expect(entry.allowEmitInvoiceCta).toBe(false);
    expect(entry.action.kind).toBe('support');
    expect(entry.body).toContain('No emitas el documento hasta revisarla');
  });
});
