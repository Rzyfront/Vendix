import { Prisma } from '@prisma/client';
import { CreditNotesService } from './credit-notes.service';

/**
 * CP-REFUND-FLOW-REDESIGN paso 10 — gate de NC guiada + puente refund↔NC (paso 7).
 *
 * Con FE aceptada la NC por lo reembolsado es guiada (1 clic, nunca
 * automática): deriva líneas de `refund_items` (ADR-03 movido a backend),
 * persiste `invoices.refund_id` y escribe el puente estructural por línea
 * en `credit_note_refund_items` — no comparación floja por monto/fecha.
 *
 * Ningún UPDATE toca documentos emitidos: todo rechazo sale ANTES de
 * numerar (inexistente, cruce de órdenes, doble vínculo vivo, mezcla
 * guiada+explícita, refund vacío).
 */
describe('CreditNotesService — gate de NC guiada + puente refund↔NC (paso 7, CP-REFUND-FLOW-REDESIGN)', () => {
  const refundItem = (over: any = {}) => ({
    id: 201,
    order_item_id: 11,
    quantity: 2,
    refund_amount: new Prisma.Decimal(5000),
    discount_amount: new Prisma.Decimal(0),
    tax_amount: new Prisma.Decimal(0),
    ...over,
  });

  const refundRow = (over: any = {}) => ({
    id: 55,
    order_id: 1,
    state: 'completed',
    reason: 'cliente devolvió',
    shipping_refund: new Prisma.Decimal(0),
    refund_items: [refundItem()],
    ...over,
  });

  const orderLine = (over: any = {}) => ({
    id: 11,
    product_id: 3,
    product_variant_id: null,
    product_name: 'Café',
    quantity: 2,
    unit_price: new Prisma.Decimal(2500),
    ...over,
  });

  function createService(over: any = {}) {
    const prisma = {
      refunds: { findFirst: jest.fn().mockResolvedValue(refundRow()) },
      invoices: { findFirst: jest.fn().mockResolvedValue(null) },
      order_items: { findMany: jest.fn().mockResolvedValue([orderLine()]) },
      ...(over.prisma ?? {}),
    };
    const service = new CreditNotesService(
      prisma as any,
      {} as any,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, prisma };
  }

  const resolve = (service: CreditNotesService, dto: any, type: any, invoice: any) =>
    (service as any).resolveRefundLink(dto, type, invoice);

  const guidedDto = (over: any = {}) => ({ refund_id: 55, ...over });
  const invoiceOf = (order_id: number | null) => ({ id: 9, order_id });

  describe('derivación guiada + puente estructural', () => {
    it('deriva líneas del refund (cant/montos del reembolso, precio/descripción de la orden)', async () => {
      const { service } = createService();

      const link = await resolve(service, guidedDto(), 'credit_note', invoiceOf(1));

      expect(link.refund).toEqual({ id: 55, order_id: 1 });
      expect(link.derived_items).toEqual([
        {
          product_id: 3,
          description: 'Café',
          quantity: 2,
          unit_price: 2500,
          discount_amount: 0,
          tax_amount: 0,
        },
      ]);
      expect(link.bridge_rows).toEqual([
        {
          refund_item_id: 201,
          covered_qty: 2,
          covered_amount: new Prisma.Decimal(5000),
        },
      ]);
      expect(link.default_reason).toContain('Reembolso #55 de la orden #1');
    });

    it('cobertura total ⇒ concepto 2 (anulación); parcial ⇒ concepto 1 (devolución)', async () => {
      const { service } = createService();

      const full = await resolve(service, guidedDto(), 'credit_note', invoiceOf(1));
      expect(full.concept_code).toBe('2');

      const { service: partial } = createService({
        prisma: {
          refunds: {
            findFirst: jest
              .fn()
              .mockResolvedValue(refundRow({ refund_items: [refundItem({ quantity: 1 })] })),
          },
          invoices: { findFirst: jest.fn().mockResolvedValue(null) },
          order_items: { findMany: jest.fn().mockResolvedValue([orderLine()]) },
        },
      });
      const part = await resolve(partial, guidedDto(), 'credit_note', invoiceOf(1));
      expect(part.concept_code).toBe('1');
      expect(part.bridge_rows).toEqual([
        expect.objectContaining({ refund_item_id: 201, covered_qty: 1 }),
      ]);
    });

    it('refund solo-envío: línea libre de envío SIN puente (no hay refund_item que cubrir)', async () => {
      const { service } = createService({
        prisma: {
          refunds: {
            findFirst: jest.fn().mockResolvedValue(
              refundRow({ refund_items: [], shipping_refund: new Prisma.Decimal(3000) }),
            ),
          },
          invoices: { findFirst: jest.fn().mockResolvedValue(null) },
          order_items: { findMany: jest.fn().mockResolvedValue([orderLine()]) },
        },
      });

      const link = await resolve(service, guidedDto(), 'credit_note', invoiceOf(1));

      expect(link.derived_items).toEqual([
        {
          description: 'Reembolso de envío — orden #1',
          quantity: 1,
          unit_price: 3000,
          discount_amount: 0,
          tax_amount: 0,
        },
      ]);
      expect(link.bridge_rows).toEqual([]);
    });

    it('sin refund_id ⇒ null: la NC manual sigue el flujo histórico intacto', async () => {
      const { service, prisma } = createService();

      await expect(resolve(service, {}, 'credit_note', invoiceOf(1))).resolves.toBeNull();
      expect(prisma.refunds.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('rechazos antes de numerar (la FE jamás se toca)', () => {
    it('nota débito + refund_id ⇒ FISCAL_DOCUMENT_UNSUPPORTED (solo la NC acredita)', async () => {
      const { service } = createService();

      await expect(resolve(service, guidedDto(), 'debit_note', invoiceOf(1))).rejects.toMatchObject({
        errorCode: 'FISCAL_DOCUMENT_UNSUPPORTED',
      });
    });

    it('guiada + items explícitos ⇒ INVOICING_CALC_001 (el puente mentiría)', async () => {
      const { service } = createService();

      await expect(
        resolve(service, guidedDto({ items: [{ description: 'x', quantity: 1, unit_price: 1 }] }), 'credit_note', invoiceOf(1)),
      ).rejects.toMatchObject({ errorCode: 'INVOICING_CALC_001' });
    });

    it('refund inexistente/ajeno ⇒ INVOICING_FIND_001', async () => {
      const { service } = createService({
        prisma: {
          refunds: { findFirst: jest.fn().mockResolvedValue(null) },
          invoices: { findFirst: jest.fn().mockResolvedValue(null) },
          order_items: { findMany: jest.fn().mockResolvedValue([]) },
        },
      });

      await expect(resolve(service, guidedDto(), 'credit_note', invoiceOf(1))).rejects.toMatchObject({
        errorCode: 'INVOICING_FIND_001',
      });
    });

    it('factura padre sin orden ⇒ INVOICING_CALC_001 (nada contra qué cruzar)', async () => {
      const { service } = createService();

      await expect(resolve(service, guidedDto(), 'credit_note', invoiceOf(null))).rejects.toMatchObject({
        errorCode: 'INVOICING_CALC_001',
      });
    });

    it('cruce de órdenes ⇒ INVOICING_CALC_001', async () => {
      const { service } = createService();

      await expect(resolve(service, guidedDto(), 'credit_note', invoiceOf(2))).rejects.toMatchObject({
        errorCode: 'INVOICING_CALC_001',
      });
    });

    it('doble vínculo vivo ⇒ INVOICING_CALC_001 (anti-doble nc_covered_qty)', async () => {
      const { service, prisma } = createService({
        prisma: {
          refunds: { findFirst: jest.fn().mockResolvedValue(refundRow()) },
          invoices: {
            findFirst: jest.fn().mockResolvedValue({ id: 12, invoice_number: 'NC-1', status: 'draft' }),
          },
          order_items: { findMany: jest.fn().mockResolvedValue([orderLine()]) },
        },
      });

      await expect(resolve(service, guidedDto(), 'credit_note', invoiceOf(1))).rejects.toMatchObject({
        errorCode: 'INVOICING_CALC_001',
      });
      expect(prisma.invoices.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            refund_id: 55,
            invoice_type: 'credit_note',
            status: { in: ['draft', 'validated', 'sent', 'accepted'] },
          }),
        }),
      );
    });

    it('refund sin líneas ni envío ⇒ INVOICING_CALC_001 (no cae al copiado TOTAL)', async () => {
      const { service } = createService({
        prisma: {
          refunds: {
            findFirst: jest.fn().mockResolvedValue(refundRow({ refund_items: [] })),
          },
          invoices: { findFirst: jest.fn().mockResolvedValue(null) },
          order_items: { findMany: jest.fn().mockResolvedValue([orderLine()]) },
        },
      });

      await expect(resolve(service, guidedDto(), 'credit_note', invoiceOf(1))).rejects.toMatchObject({
        errorCode: 'INVOICING_CALC_001',
      });
    });
  });

  describe('release-853 paso 8: estado válido, unicidad y envío (casos a, b y c)', () => {
    it('(a) refund failed ⇒ INVOICING_CALC_001 (no 404: el refund existe pero no acredita)', async () => {
      const { service } = createService({
        prisma: {
          refunds: {
            findFirst: jest.fn().mockResolvedValue(refundRow({ state: 'failed' })),
          },
          invoices: { findFirst: jest.fn().mockResolvedValue(null) },
          order_items: { findMany: jest.fn().mockResolvedValue([orderLine()]) },
        },
      });

      await expect(resolve(service, guidedDto(), 'credit_note', invoiceOf(1))).rejects.toMatchObject({
        errorCode: 'INVOICING_CALC_001',
      });
    });

    it('(a) refund cancelled ⇒ INVOICING_CALC_001', async () => {
      const { service } = createService({
        prisma: {
          refunds: {
            findFirst: jest.fn().mockResolvedValue(refundRow({ state: 'cancelled' })),
          },
          invoices: { findFirst: jest.fn().mockResolvedValue(null) },
          order_items: { findMany: jest.fn().mockResolvedValue([orderLine()]) },
        },
      });

      await expect(resolve(service, guidedDto(), 'credit_note', invoiceOf(1))).rejects.toMatchObject({
        errorCode: 'INVOICING_CALC_001',
      });
    });

    it('(b) P2002 con vínculo vivo ⇒ "refund ya vinculado" (carrera doble-clic, nunca 500)', async () => {
      const { service, prisma } = createService({
        prisma: {
          refunds: { findFirst: jest.fn().mockResolvedValue(refundRow()) },
          invoices: {
            findFirst: jest.fn().mockResolvedValue({ id: 12, invoice_number: 'NC-1', status: 'draft' }),
          },
          order_items: { findMany: jest.fn().mockResolvedValue([orderLine()]) },
        },
      });
      const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

      await expect(
        (service as any).throwIfDuplicateRefundLink(p2002, { refund: { id: 55, order_id: 1 } }),
      ).rejects.toMatchObject({ errorCode: 'INVOICING_CALC_001' });
      expect(prisma.invoices.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ refund_id: 55, invoice_type: 'credit_note' }),
        }),
      );
    });

    it('(b) P2002 sin vínculo vivo relanza el original (no era el índice de refund)', async () => {
      const { service } = createService();
      const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

      await expect(
        (service as any).throwIfDuplicateRefundLink(p2002, { refund: { id: 55, order_id: 1 } }),
      ).rejects.toBe(p2002);
    });

    it('(b) error no-P2002 o NC manual relanza intacto', async () => {
      const { service } = createService();
      const other = new Error('db caída');

      await expect(
        (service as any).throwIfDuplicateRefundLink(other, { refund: { id: 55, order_id: 1 } }),
      ).rejects.toBe(other);
      const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      await expect((service as any).throwIfDuplicateRefundLink(p2002, null)).rejects.toBe(p2002);
    });

    it('(c) refund con líneas + envío: la NC incluye la línea de envío (sin puente)', async () => {
      const { service } = createService({
        prisma: {
          refunds: {
            findFirst: jest
              .fn()
              .mockResolvedValue(refundRow({ shipping_refund: new Prisma.Decimal(3000) })),
          },
          invoices: { findFirst: jest.fn().mockResolvedValue(null) },
          order_items: { findMany: jest.fn().mockResolvedValue([orderLine()]) },
        },
      });

      const link = await resolve(service, guidedDto(), 'credit_note', invoiceOf(1));

      expect(link.derived_items).toEqual([
        expect.objectContaining({ description: 'Café', quantity: 2 }),
        {
          description: 'Reembolso de envío — orden #1',
          quantity: 1,
          unit_price: 3000,
          discount_amount: 0,
          tax_amount: 0,
        },
      ]);
      // El envío no toca el puente: solo la línea de producto lo hace.
      expect(link.bridge_rows).toEqual([
        expect.objectContaining({ refund_item_id: 201, covered_qty: 2 }),
      ]);
    });
  });
});
