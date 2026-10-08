import {
  generateInvoiceEmailHtml,
  generateInvoiceEmailText,
} from './invoice-email.template';

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

  it('resumen breve: número, a nombre de, fecha y total a pagar', () => {
    const html = generateInvoiceEmailHtml(data);
    expect(html).toContain('Número de comprobante');
    expect(html).toContain('A nombre de');
    expect(html).toContain('Fecha');
    expect(html).toContain('Total a pagar');
    expect(html).toContain('FEV-1');
  });

  it('saludo con el adquiriente y frase del emisor', () => {
    const html = generateInvoiceEmailHtml({
      ...data,
      issuer_name: 'PRINT SOLUTIONS SAS',
    });
    expect(html).toContain('¡Hola, Cliente!');
    expect(html).toContain('PRINT SOLUTIONS SAS');
    expect(html).toContain('te informa que se generó el siguiente comprobante');
  });

  it('sin issuer_name cae al nombre de la tienda', () => {
    expect(generateInvoiceEmailHtml(data)).toContain(
      '<strong>Tienda</strong> te informa',
    );
  });

  it('marca Vendix: sello superior con logo PNG y pie con enlace contáctanos', () => {
    const html = generateInvoiceEmailHtml(data);
    expect(html).toContain('Comprobante elaborado y enviado a través de');
    expect(html).toContain('src="https://vendix.online/vlogo.png"');
    expect(html).toContain('alt="Vendix"');
    expect(html).toContain('Comprobante elaborado y enviado a través de Vendix.');
    expect(html).toContain('Si deseas esta funcionalidad,');
    expect(html).toContain('<a href="https://vendix.online"');
    expect(html).toContain('contáctanos</a>');
    expect(html).toContain('correo automático');
  });

  it('escapa HTML en nombres del adquiriente y emisor', () => {
    const html = generateInvoiceEmailHtml({
      ...data,
      customer_name: '<script>x</script>',
      issuer_name: 'A & B',
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('A &amp; B');
  });

  it('conserva el CUFE cuando existe', () => {
    expect(generateInvoiceEmailHtml({ ...data, cufe: 'abc123' })).toContain(
      'abc123',
    );
  });

  it('versión texto equivalente', () => {
    const text = generateInvoiceEmailText({ ...data, issuer_name: 'Emisor SAS' });
    expect(text).toContain('¡Hola, Cliente!');
    expect(text).toContain('Emisor SAS te informa que se generó el siguiente comprobante');
    expect(text).toContain('Total a pagar: $119.000');
    expect(text).toContain('https://vendix.online');
  });
});
