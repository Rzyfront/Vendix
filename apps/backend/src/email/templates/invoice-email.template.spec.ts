import { generateInvoiceEmailHtml } from './invoice-email.template';

/**
 * C.7 / F-106 — el correo de factura usa locale es-CO (miles con punto) y
 * la fila de Impuestos sólo sale con impuesto > 0 (§5.3 fail-closed: sin
 * bandera fiscal, la fila sin respaldo no se pinta).
 */
describe('invoice-email.template (C.7/F-106)', () => {
  const data: any = {
    invoice_number: 'FEV-1',
    invoice_type: 'sales_invoice',
    customer_name: 'Cliente',
    issue_date: '2026-09-14',
    items: [{ description: 'P1', quantity: 1, unit_price: 100000, tax_amount: 19000, total_amount: 119000 }],
    subtotal: 100000,
    discount: 0,
    tax: 19000,
    withholding: 0,
    total: 119000,
    currency: 'COP',
    store_name: 'Tienda',
  };

  it('miles con punto (es-CO), no con coma (en-US)', () => {
    const html = generateInvoiceEmailHtml(data);
    expect(html).toContain('$119.000');
    expect(html).not.toContain('$119,000');
  });

  it('la fila Impuestos sale con impuesto > 0', () => {
    expect(generateInvoiceEmailHtml(data)).toContain('Impuestos');
  });

  it('la fila Impuestos no sale con impuesto en cero', () => {
    const html = generateInvoiceEmailHtml({ ...data, tax: 0, total: 100000 });
    expect(html).not.toContain('>Impuestos<');
    expect(html).toContain('Subtotal');
    expect(html).toContain('Total');
  });
});
