import { PDFDocument } from '@common/pdf/pdfkit';
import { InvoicePdfBuilder, InvoicePdfData } from './invoice-pdf.builder';

function data(overrides: Partial<InvoicePdfData>): InvoicePdfData {
  return {
    company_name: 'Tienda',
    company_nit: '900000001',
    customer_name: 'Cliente',
    invoice_number: 'FV-1',
    invoice_type: 'sales_invoice',
    issue_date: '01/10/2026',
    items: [],
    taxes: [],
    subtotal_amount: 100000,
    discount_amount: 0,
    tax_amount: 0,
    withholding_amount: 0,
    total_amount: 100000,
    ...overrides,
  } as InvoicePdfData;
}

async function texts(d: InvoicePdfData): Promise<string[]> {
  const calls: string[] = [];
  const orig = (PDFDocument as any).prototype.text;
  const spy = jest
    .spyOn((PDFDocument as any).prototype, 'text')
    .mockImplementation(function (this: any, t: any, ...rest: any[]) {
      calls.push(String(t));
      return orig.call(this, t, ...rest);
    });
  try {
    await InvoicePdfBuilder.generate(d);
  } finally {
    spy.mockRestore();
  }
  return calls;
}

describe('InvoicePdfBuilder tip lines', () => {
  it('con propina pinta propina voluntaria y total pagado', async () => {
    const t = await texts(data({ tip_amount: 10000.1 }));
    expect(t.some((x) => x.includes('Propina voluntaria'))).toBe(true);
    expect(t.some((x) => x.includes('Total pagado'))).toBe(true);
    expect(t.some((x) => x.includes('110.000'))).toBe(true);
  });

  it('sin propina no aparece ninguna linea de propina', async () => {
    for (const tip of [undefined, 0]) {
      const t = await texts(data({ tip_amount: tip }));
      expect(t.some((x) => x.includes('Propina'))).toBe(false);
      expect(t.some((x) => x.includes('Total pagado'))).toBe(false);
    }
  });
});
