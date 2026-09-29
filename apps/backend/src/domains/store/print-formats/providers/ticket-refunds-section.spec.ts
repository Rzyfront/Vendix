import { PosSaleTicketDataProvider } from './pos-sale-ticket.provider';
import { SalesOrderInvoiceDataProvider } from './sales-order-invoice.provider';
import { PrintLayoutComposerService } from '../services/print-layout-composer.service';

/**
 * CP-REFUND-FLOW-REDESIGN paso 10 — gate de sección Reembolsos/NC (pasos 9+9b).
 *
 * Los documentos originales son inmutables: la reimpresión posterior a
 * refunds agrega la sección en `custom_variables.refunds` (provider, paso 9)
 * y la pinta como `sec_refunds`/`REEMBOLSOS` (composer, paso 9b). Sin
 * refunds, el modelo y el papel salen byte-idénticos. La ruta
 * `custom_template` queda excluida por diseño (plantilla total de la tienda).
 */
describe('ticket — gate de sección Reembolsos/NC (pasos 9+9b, CP-REFUND-FLOW-REDESIGN)', () => {
  const orderRow: any = {
    id: 7,
    order_number: 'POS-0007',
    created_at: new Date('2026-08-27T09:15:00.000Z'),
    state: 'finished',
    subtotal_amount: 4629.62,
    discount_amount: 0,
    tax_amount: 370.36,
    shipping_cost: 0,
    grand_total: 5000,
    order_items: [],
    users: null,
    stores: {
      name: 'Tienda Test',
      organizations: { tax_id: '900.000.000-1' },
      addresses: [],
    },
    table_sessions: [],
    payments: [],
  };

  const refundLine = (over: any = {}) => ({
    id: 301,
    order_item_id: 11,
    quantity: 1,
    refund_amount: 2500,
    order_items: { product_name: 'Café' },
    ...over,
  });

  const refundRow = (over: any = {}) => ({
    id: 55,
    state: 'completed',
    amount: 2500,
    refund_method: 'cash',
    reason: 'cliente devolvió',
    requested_at: new Date('2026-09-01T10:00:00.000Z'),
    processed_at: new Date('2026-09-01T10:05:00.000Z'),
    refund_items: [refundLine()],
    ...over,
  });

  const bridgeRow = (over: any = {}) => ({
    refund_item_id: 301,
    covered_qty: 1,
    covered_amount: 2500,
    credit_note: { id: 12, invoice_number: 'NC-1', status: 'accepted' },
    ...over,
  });

  const makePrisma = (refunds: any[], bridge: any[] = []) =>
    ({
      orders: { findFirst: jest.fn().mockResolvedValue(orderRow) },
      invoices: { findFirst: jest.fn().mockResolvedValue(null) },
      refunds: { findMany: jest.fn().mockResolvedValue(refunds) },
      // B17 — ambos providers resuelven la zona de la tienda
      // (`resolveStoreTimezone`) antes de formatear `date_formatted`. Sin
      // fila cae al default (`America/Bogota`); `orderRow.created_at` es un
      // instante de mañana en Bogotá (09:15 UTC), así que la fecha civil no
      // cambia de día bajo ese default.
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
      withoutScope: () => ({
        credit_note_refund_items: { findMany: jest.fn().mockResolvedValue(bridge) },
        invoices: { findFirst: jest.fn().mockResolvedValue(null) },
        order_items: { findMany: jest.fn().mockResolvedValue([]) },
      }),
    }) as any;

  describe('provider pos_sale_ticket (paso 9)', () => {
    it('orden SIN refunds: sin sección y modelo byte-idéntico entre renders', async () => {
      const prisma = makePrisma([]);
      const provider = new PosSaleTicketDataProvider(prisma);

      const a = await provider.fetchDocumentData(10, 7);
      const b = await provider.fetchDocumentData(10, 7);

      expect((a as any).custom_variables?.refunds).toBeUndefined();
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(JSON.stringify(a)).not.toContain('refunds');
    });

    it('refunds sin ítems (cancelación/legacy) aportan solo a nivel orden: sin sección', async () => {
      const data = await new PosSaleTicketDataProvider(
        makePrisma([refundRow({ refund_items: [] })]),
      ).fetchDocumentData(10, 7);

      expect((data as any).custom_variables?.refunds).toBeUndefined();
    });

    it('orden CON refunds: sección no vacía y totales originales intactos', async () => {
      const withRefunds = await new PosSaleTicketDataProvider(
        makePrisma([refundRow()]),
      ).fetchDocumentData(10, 7);
      const withoutRefunds = await new PosSaleTicketDataProvider(
        makePrisma([]),
      ).fetchDocumentData(10, 7);

      const section = (withRefunds as any).custom_variables?.refunds;
      expect(section).toBeDefined();
      expect(section.lines).toEqual([
        expect.objectContaining({
          order_item_id: 11,
          product_name: 'Café',
          refunded_qty: 1,
          refunded_amount: 2500,
        }),
      ]);
      expect(section.totals).toMatchObject({ refunded_amount: 2500 });
      expect(section.refunds).toEqual([
        expect.objectContaining({ id: 55, state: 'completed', refund_method: 'cash' }),
      ]);
      // Inmutabilidad del original: mismos totales, mismos ítems, mismos impuestos.
      expect(withRefunds.totals).toEqual(withoutRefunds.totals);
      expect(withRefunds.items).toEqual(withoutRefunds.items);
      expect(withRefunds.taxes).toEqual(withoutRefunds.taxes);
    });

    it('solo la NC accepted cubre: la draft se LISTA pero no suma', async () => {
      const data = await new PosSaleTicketDataProvider(
        makePrisma([refundRow()], [bridgeRow(), bridgeRow({ credit_note: { id: 13, invoice_number: 'NC-2', status: 'draft' } })]),
      ).fetchDocumentData(10, 7);

      const line = (data as any).custom_variables.refunds.lines[0];
      expect(line.nc_covered_qty).toBe(1);
      expect(line.nc_covered_amount).toBe(2500);
      expect(line.notes).toEqual([
        expect.objectContaining({ invoice_number: 'NC-1', status: 'accepted' }),
        expect.objectContaining({ invoice_number: 'NC-2', status: 'draft' }),
      ]);
    });
  });

  describe('provider sales_order_invoice (paso 9, espejo)', () => {
    it('publica la misma sección refunds en custom_variables', async () => {
      const provider = new SalesOrderInvoiceDataProvider(makePrisma([refundRow()], [bridgeRow()]));
      const model: any = { custom_variables: {} };

      await (provider as any).attachRefundsSection(7, model);

      expect(model.custom_variables.refunds.lines).toEqual([
        expect.objectContaining({ order_item_id: 11, refunded_qty: 1, nc_covered_qty: 1 }),
      ]);
      expect(model.custom_variables.refunds.totals).toMatchObject({
        refunded_amount: 2500,
        nc_covered_amount: 2500,
      });
    });

    it('sin refunds deja el modelo intacto (sin llave refunds)', async () => {
      const provider = new SalesOrderInvoiceDataProvider(makePrisma([]));
      const model: any = { custom_variables: {} };

      await (provider as any).attachRefundsSection(7, model);

      expect(model.custom_variables.refunds).toBeUndefined();
    });
  });

  describe('composer (paso 9b)', () => {
    const compiler: any = {
      escapeHtml: (v: unknown) => String(v ?? ''),
      compile: jest.fn((tpl: string) => ({ compiled: `<div>${tpl}</div>` })),
    };
    const composer = () => new PrintLayoutComposerService(compiler);

    const modelWith = (over: any = {}) =>
      ({
        totals: { grand_total: 5000 },
        custom_variables: {
          refunds: {
            lines: [
              {
                order_item_id: 11,
                product_name: 'Café',
                refunded_qty: 1,
                refunded_amount: 2500,
                refunded_amount_formatted: '$2.500',
                nc_covered_qty: 1,
                nc_covered_amount: 2500,
                notes: [{ credit_note_id: 12, invoice_number: 'NC-1', status: 'accepted' }],
              },
            ],
            totals: {
              refunded_amount: 2500,
              refunded_amount_formatted: '$2.500',
              nc_covered_amount: 2500,
              nc_covered_amount_formatted: '$2.500',
            },
            refunds: [
              {
                id: 55,
                state: 'completed',
                amount: 2500,
                amount_formatted: '$2.500',
                refund_method: 'cash',
                reason: 'cliente devolvió',
              },
            ],
          },
        },
        ...over,
      }) as any;

    it('con sección: pinta sec_refunds + REEMBOLSOS + neto derivado', () => {
      const html = (composer() as any).renderRefundsSection(modelWith());

      expect(html).toContain('sec_refunds');
      expect(html).toContain('REEMBOLSOS');
      expect(html).toContain('Reembolsado:');
      expect(html).toContain('Cubierto por NC:');
      expect(html).toContain('Neto:');
      expect(html).toContain('NC-1');
      expect(html).toContain('Reembolso #55');
    });

    it('sin refunds: string vacío (salida byte-idéntica)', () => {
      expect((composer() as any).renderRefundsSection({ totals: {}, custom_variables: {} })).toBe('');
      expect((composer() as any).renderRefundsSection({ totals: {} })).toBe('');
      expect(
        (composer() as any).renderRefundsSection(modelWith({ custom_variables: { refunds: { lines: [] } } })),
      ).toBe('');
    });

    it('custom_template queda excluida por diseño (plantilla total de la tienda)', () => {
      const html = composer().compose(
        { custom_template: '<div>Mi diseño</div>', sections: [], paper: {}, styles: {} } as any,
        modelWith(),
      );

      expect(compiler.compile).toHaveBeenCalledWith('<div>Mi diseño</div>', expect.anything(), 'dummy', undefined);
      expect(html).not.toContain('sec_refunds');
      expect(html).not.toContain('REEMBOLSOS');
    });
  });
});
