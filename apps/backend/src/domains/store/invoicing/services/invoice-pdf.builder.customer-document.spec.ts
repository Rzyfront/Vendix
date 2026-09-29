import { InvoicePdfBuilder, InvoicePdfData } from './invoice-pdf.builder';

/**
 * `formatCustomerDocumentLine` cierra el último tramo del incidente Óptica
 * Panorama SAS: el PDF imprimía «NIT/CC: <número>» fijo, sin importar el tipo
 * real ni el DV. Se prueba directo (método privado, invocado vía cast) porque
 * el resto de `drawCustomerInfo` es maquetación de pdfkit sin texto
 * extraíble en los specs de este repo (no hay lector de PDF en las
 * dependencias de test).
 */
function formatLine(overrides: Partial<InvoicePdfData>): string {
  const base = { customer_tax_id: '800214345' } as InvoicePdfData;
  return (InvoicePdfBuilder as any).formatCustomerDocumentLine({
    ...base,
    ...overrides,
  });
}

describe('InvoicePdfBuilder.formatCustomerDocumentLine', () => {
  it('incidente real: NIT con DV imprime "NIT: 800214345-7", no "NIT/CC"', () => {
    expect(
      formatLine({
        customer_tax_id: '800214345',
        customer_document_type: 'NIT',
        customer_verification_digit: '7',
      }),
    ).toBe('NIT: 800214345-7');
  });

  it('CC sin DV imprime "CC: <número>" sin guion colgante', () => {
    expect(
      formatLine({
        customer_tax_id: '1118860776',
        customer_document_type: 'CC',
        customer_verification_digit: undefined,
      }),
    ).toBe('CC: 1118860776');
  });

  it('sin document_type (dato histórico/no resuelto) cae al rótulo genérico "NIT/CC" — compatibilidad', () => {
    expect(
      formatLine({
        customer_tax_id: '800214345',
        customer_document_type: undefined,
        customer_verification_digit: undefined,
      }),
    ).toBe('NIT/CC: 800214345');
  });

  it('el tipo se normaliza a mayúsculas para la etiqueta impresa', () => {
    expect(
      formatLine({
        customer_tax_id: '800214345',
        customer_document_type: 'nit',
        customer_verification_digit: '7',
      }),
    ).toBe('NIT: 800214345-7');
  });
});
