import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WebhookHandlerService } from './services/webhook-handler.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { OrderFlowService } from '../orders/order-flow/order-flow.service';
import { TableSessionsService } from '../tables/table-sessions.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { InvoiceFlowService } from '../invoicing/invoice-flow/invoice-flow.service';
import { OrderStockCommitService } from '../inventory/shared/services/order-stock-commit.service';

/**
 * Asiento del webhook ecommerce con envío: antes omitía `shipping_amount`
 * (el asiento no cuadraba con flete). Ahora usa `buildOrderSaleTaxPayload`:
 * flete neto a 414505 y el impuesto del envío sumado al desglose.
 */
describe('WebhookHandlerService — payment.received con impuesto del envío', () => {
  async function setup(order: Record<string, unknown>) {
    const emit = jest.fn();
    const prisma: any = {
      payments: {
        findUnique: jest.fn().mockResolvedValue({
          id: 55,
          amount: order.grand_total,
          currency: 'COP',
          financial_account_id: null,
          store_payment_method_id: 3,
          store_payment_method: { system_payment_method: { display_name: 'Wompi', type: 'wompi' } },
          orders: { id: 9, store_id: 7, order_number: 'ORD-9', stores: { organization_id: 1 }, ...order },
        }),
      },
      order_items: {
        findMany: jest.fn().mockResolvedValue([
          {
            total_price: 20000,
            order_item_taxes: [{ tax_type: 'inc', tax_amount: 1600, tax_rate: 0.08 }],
          },
        ]),
      },
    };
    prisma.withoutScope = jest.fn(() => prisma);
    const module = await Test.createTestingModule({
      providers: [
        WebhookHandlerService,
        { provide: StorePrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: { emit } },
        { provide: StoreContextRunner, useValue: { runInStoreContext: jest.fn((_s: number, cb: () => unknown) => cb()) } },
        { provide: OrderFlowService, useValue: {} },
        { provide: TableSessionsService, useValue: {} },
        { provide: InvoicingService, useValue: {} },
        { provide: InvoiceFlowService, useValue: {} },
        { provide: OrderStockCommitService, useValue: {} },
      ],
    }).compile();
    const service = module.get(WebhookHandlerService);
    await (service as any).emitPaymentReceivedAccounting(55);
    const call = emit.mock.calls.find((c) => c[0] === 'payment.received');
    return call?.[1];
  }

  it('orden con envío gravado con IVA: flete neto, impuesto sumado, asiento cuadra', async () => {
    const order = {
      subtotal_amount: 20000,
      discount_amount: 0,
      tip_amount: 0,
      tax_amount: 1600,
      shipping_cost: 15000,
      shipping_tax_type: 'iva',
      shipping_tax_rate: 0.19,
      shipping_tax_amount: 2394.96,
      grand_total: 36600,
    };
    const payload = await setup(order);
    expect(payload).toBeDefined();
    expect(payload.shipping_amount).toBe(12605.04);
    expect(payload.tax_amount).toBe(3994.96);
    expect(payload.tax_breakdown).toEqual([
      { tax_type: 'inc', tax_amount: 1600, tax_rate: 0.08, taxable_amount: 20000 },
      { tax_type: 'iva', tax_amount: 2394.96, tax_rate: 0.19, taxable_amount: 12605.04 },
    ]);
    // DR banco (grand_total) = CR revenue + 414505 + Σ impuestos
    const credit =
      Math.round(payload.subtotal_amount * 100) +
      Math.round(payload.shipping_amount * 100) +
      payload.tax_breakdown.reduce((s: number, r: any) => s + Math.round(r.tax_amount * 100), 0);
    expect(credit).toBe(Math.round(payload.amount * 100));
  });

  it('orden con envío sin impuesto: el flete bruto va a 414505 (antes se omitía)', async () => {
    const payload = await setup({
      subtotal_amount: 20000,
      tax_amount: 1600,
      shipping_cost: 5000,
      shipping_tax_amount: 0,
      grand_total: 26600,
    });
    expect(payload.shipping_amount).toBe(5000);
    expect(payload.tax_amount).toBe(1600);
    expect(payload.tax_breakdown).toHaveLength(1);
  });
});
