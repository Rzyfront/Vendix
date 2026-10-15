import { InvoicePdfBuilder, InvoicePdfData } from './invoice-pdf.builder';
import { PDFDocument } from '@common/pdf/pdfkit';
// Probe the real measured layout without a DIAN provider, network or fiscal mutation.
describe('holder PDF measured representation', () => {
  it.each(['thermal_58', 'thermal_80', 'a4'] as const)(
    'places the additional QR at printable width in %s',
    async (format) => {
      const image = jest.spyOn(PDFDocument.prototype, 'image').mockReturnThis();
      const data: InvoicePdfData = {
        company_name: 'Comercio',
        company_nit: '900123456',
        customer_name: 'Consumidor final',
        invoice_number: 'FE-1',
        invoice_type: 'sales_invoice',
        issue_date: '2026-10-14',
        items: [],
        taxes: [],
        subtotal_amount: 100,
        discount_amount: 0,
        tax_amount: 0,
        withholding_amount: 0,
        total_amount: 100,
        format,
        tz: 'America/Bogota',
        holder_change: {
          url: 'https://example.test/factura/cfh1.fixture',
          expires_at: '2026-11-14T00:00:00Z',
          qr_buffer: Buffer.from('png'),
        },
      };
      try {
        const output = await InvoicePdfBuilder.generate(data);
        expect(output.subarray(0, 4).toString()).toBe('%PDF');
        expect(image).toHaveBeenCalled();
        for (const call of image.mock.calls) {
          const options = call[3] as { fit?: number[] };
          if (options?.fit)
            expect(options.fit[0]).toBeLessThanOrEqual(
              format === 'thermal_58'
                ? 137
                : format === 'thermal_80'
                  ? 205
                  : 600,
            );
        }
      } finally {
        image.mockRestore();
      }
    },
  );
});
