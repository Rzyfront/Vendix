import { AccountingEventsListener } from './accounting-events.listener';
import { AutoEntryService } from './auto-entry.service';
import { buildOrderSaleTaxPayload } from '../../payments/utils/order-sale-tax-payload.util';

/**
 * payment.received con envío (venta POS sin factura): el listener debe
 * reenviar `shipping_amount` a `AutoEntryService.onPaymentReceived`, que lo
 * acredita en 414505. Antes el listener lo descartaba: el asiento no cuadraba
 * por el flete, `createAutoEntry` lanzaba y el listener tragaba el error ⇒
 * venta sin asiento. Se pasa por el servicio REAL (líneas + impuestos) y sólo
 * se capturan las líneas en `createAutoEntry`.
 */
describe('AccountingEventsListener.handlePaymentReceived — envío', () => {
  function setup() {
    const service: any = Object.create(AutoEntryService.prototype);
    service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    service.prisma = {
      invoices: { findFirst: jest.fn().mockResolvedValue(null) },
      // Sin credit_sale.created posteado ⇒ rama de venta directa.
      withoutScope: () => ({
        accounting_entries: { findFirst: jest.fn().mockResolvedValue(null) },
      }),
    };
    service.account_mapping_service = {
      getMapping: jest.fn().mockImplementation((_o: number, key: string) =>
        Promise.resolve({ account_code: key }),
      ),
    };
    service.entry_failure_service = { recordSkip: jest.fn(), recordFailure: jest.fn() };
    const captured: any[] = [];
    service.createAutoEntry = jest.fn().mockImplementation((data: any) => {
      captured.push(data);
      return Promise.resolve({ id: 1 });
    });
    const listener = new AccountingEventsListener(
      service,
      { getMapping: jest.fn() } as any,
      { isSubflowEnabled: jest.fn().mockResolvedValue(true) } as any,
      { getPlatformContext: jest.fn() } as any,
      { recordSkip: jest.fn(), recordFailure: jest.fn() } as any,
    );
    return { listener, captured };
  }

  const cents = (n: number) => Math.round(Number(n || 0) * 100);
  const totals = (lines: any[]) =>
    lines.filter(Boolean).reduce(
      (acc, l) => ({ d: acc.d + cents(l.debit_amount), c: acc.c + cents(l.credit_amount) }),
      { d: 0, c: 0 },
    );

  function event(order: any) {
    const sale_tax = buildOrderSaleTaxPayload({
      product_tax_rows: [
        { tax_type: 'iva', tax_amount: 1900, tax_rate: 0.19, taxable_amount: 10000 },
      ],
      order,
    });
    return {
      payment_id: 5, store_id: 1, organization_id: 1, order_id: 9, order_number: 'POS-9',
      amount: order.grand_total, subtotal_amount: order.subtotal_amount,
      tax_amount: sale_tax.tax_amount, tax_breakdown: sale_tax.tax_breakdown,
      shipping_amount: sale_tax.shipping_amount, discount_amount: 0,
      currency: 'COP', payment_method: 'cash',
    };
  }

  it('envío sin impuesto: 414505 por el flete bruto y D = C', async () => {
    const { listener, captured } = setup();
    await listener.handlePaymentReceived(event({
      subtotal_amount: 10000, tax_amount: 1900, shipping_cost: 5000,
      shipping_tax_amount: 0, grand_total: 16900,
    }));
    expect(captured).toHaveLength(1);
    const lines = captured[0].lines.filter(Boolean);
    expect(lines.find((l: any) => l.account_code === 'payment.received.shipping_income'))
      .toMatchObject({ credit_amount: 5000 });
    const { d, c } = totals(lines);
    expect(d).toBe(1690000);
    expect(c).toBe(d);
  });

  it('envío con IVA incluido: 414505 por la base neta, IVA del envío aparte y D = C', async () => {
    const { listener, captured } = setup();
    await listener.handlePaymentReceived(event({
      subtotal_amount: 10000, tax_amount: 1900, shipping_cost: 15000,
      shipping_tax_type: 'iva', shipping_tax_rate: 0.19, shipping_tax_amount: 2394.96,
      grand_total: 26900,
    }));
    const lines = captured[0].lines.filter(Boolean);
    expect(lines.find((l: any) => l.account_code === 'payment.received.shipping_income'))
      .toMatchObject({ credit_amount: 12605.04 });
    const taxCredits = lines
      .filter((l: any) => /payable/.test(l.account_code))
      .reduce((s: number, l: any) => s + cents(l.credit_amount), 0);
    expect(taxCredits).toBe(cents(1900 + 2394.96));
    const { d, c } = totals(lines);
    expect(d).toBe(2690000);
    expect(c).toBe(d);
  });
});
