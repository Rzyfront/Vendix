import { RequestContextService } from '@common/context/request-context.service';
import {
  buildFonturLines,
  documentSign,
  fonturRate,
  FonturSource,
  lastClosedQuarter,
  LodgingFonturService,
  quarterDates,
} from './fontur.service';

const UNIT_TYPES = new Map([
  [100, { id: 7, name: 'Doble' }],
  [101, { id: 9, name: 'Suite' }],
]);

function source(id: string, sign: number, items: Array<[number | null, number]>): FonturSource {
  return { id, sign, items: items.map(([product_id, base]) => ({ product_id, base })) };
}

describe('H4.4 — Fontur contribution base', () => {
  describe('buildFonturLines', () => {
    it('sums the base before taxes per room type and other charges, with the contribution at 2.5 per mil', () => {
      const sources = [
        // 3 nights Doble (600.000 before VAT) and a minibar charge.
        source('invoice:1', 1, [
          [100, 600000],
          [55, 10000],
        ]),
        // 2 nights Suite on a POS equivalent document.
        source('invoice:2', 1, [[101, 900000]]),
        // A folio closed as a sale without a fiscal document: 1 night Doble.
        source('order:40', 1, [[100, 200000]]),
      ];

      const result = buildFonturLines(sources, UNIT_TYPES, 2.5);

      expect(result.lines).toEqual([
        { key: 'unit_type:7', label: 'Alojamiento – Doble', kind: 'lodging', documents: 2, base: 800000 },
        { key: 'unit_type:9', label: 'Alojamiento – Suite', kind: 'lodging', documents: 1, base: 900000 },
        { key: 'other', label: 'Otros consumos del huésped', kind: 'other', documents: 1, base: 10000 },
      ]);
      // 1.710.000 × 2,5 ‰ = 4.275.
      expect(result.base).toBe(1710000);
      expect(result.contribution).toBe(4275);
    });

    it('subtracts credit notes and adds debit notes on the line they touch', () => {
      const sources = [
        source('invoice:1', documentSign('sales_invoice'), [[100, 600000]]),
        source('invoice:2', documentSign('credit_note'), [[100, 200000]]),
        source('invoice:3', documentSign('debit_note'), [[null, 5000]]),
      ];

      const result = buildFonturLines(sources, UNIT_TYPES, 2.5);

      expect(result.lines).toEqual([
        { key: 'unit_type:7', label: 'Alojamiento – Doble', kind: 'lodging', documents: 2, base: 400000 },
        { key: 'other', label: 'Otros consumos del huésped', kind: 'other', documents: 1, base: 5000 },
      ]);
      expect(result.base).toBe(405000);
      expect(result.contribution).toBe(1012.5);
    });

    it('applies the store rate and returns zeros without sources', () => {
      const result = buildFonturLines([source('invoice:1', 1, [[100, 1000000]])], UNIT_TYPES, 3);
      expect(result.contribution).toBe(3000);
      expect(buildFonturLines([], UNIT_TYPES, 2.5)).toEqual({ lines: [], base: 0, contribution: 0 });
    });
  });

  it('signs fiscal documents by type', () => {
    expect(documentSign('sales_invoice')).toBe(1);
    expect(documentSign('pos_equivalent_document')).toBe(1);
    expect(documentSign('credit_note')).toBe(-1);
    expect(documentSign('debit_note')).toBe(1);
    expect(documentSign('purchase_invoice')).toBe(0);
  });

  it('defaults to the last closed quarter and computes its civil dates', () => {
    expect(lastClosedQuarter('2026-10-28')).toEqual({ year: 2026, quarter: 3 });
    expect(lastClosedQuarter('2026-02-10')).toEqual({ year: 2025, quarter: 4 });
    expect(quarterDates(2026, 1)).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(quarterDates(2026, 4)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
  });

  it('uses 2.5 per mil when the store has no valid rate', () => {
    expect(fonturRate(undefined)).toBe(2.5);
    expect(fonturRate('3')).toBe(2.5);
    expect(fonturRate(-1)).toBe(2.5);
    expect(fonturRate(0)).toBe(0);
    expect(fonturRate(3.5)).toBe(3.5);
  });

  describe('LodgingFonturService.get', () => {
    function build(hospitality: Record<string, unknown> = {}) {
      const prisma = {
        store_settings: {
          findFirst: jest.fn(async () => ({ settings: {}, stores: { timezone: 'America/Bogota' } })),
        },
        invoices: {
          findMany: jest.fn(async () => [
            {
              id: 1,
              invoice_type: 'sales_invoice',
              invoice_items: [{ product_id: 100, total_amount: 714000, tax_amount: 114000 }],
            },
          ]),
        },
        lodging_folios: {
          findMany: jest.fn(async () => [
            { order_id: 40, order: { order_items: [{ product_id: 100, total_price: 200000 }] } },
          ]),
        },
        lodging_unit_types: {
          findMany: jest.fn(async () => [{ id: 7, name: 'Doble', product_id: 100 }]),
        },
      };
      const settings = { getSettings: jest.fn(async () => ({ hospitality })) };
      return { service: new LodgingFonturService(prisma as any, settings as any), prisma };
    }

    beforeEach(() => {
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 3 } as any);
    });
    afterEach(() => jest.restoreAllMocks());

    it('adds the folio invoices and the accounts closed without one, in the quarter, at the store rate', async () => {
      const { service, prisma } = build({ fontur_rate_per_mil: 3 });

      const result = await service.get({ year: 2026, quarter: 3 });

      expect(result).toMatchObject({
        year: 2026,
        quarter: 3,
        from: '2026-07-01',
        to: '2026-09-30',
        timezone: 'America/Bogota',
        rate_per_mil: 3,
        lines: [{ label: 'Alojamiento – Doble', documents: 2, base: 800000 }],
        totals: { documents: 2, without_invoice: 1, base: 800000, contribution: 2400 },
      });
      // Bogotá midnight = 05:00 UTC; the quarter ends before Oct 1 local.
      const window = {
        gte: new Date('2026-07-01T05:00:00.000Z'),
        lt: new Date('2026-10-01T05:00:00.000Z'),
      };
      const invoiceWhere = (prisma.invoices.findMany.mock.calls[0] as any)[0].where;
      expect(invoiceWhere.issue_date).toEqual(window);
      expect(invoiceWhere.status).toEqual({ notIn: ['draft', 'rejected', 'voided', 'cancelled'] });
      expect(invoiceWhere.OR[0]).toEqual({
        invoice_type: { in: ['sales_invoice', 'pos_equivalent_document'] },
        order: { lodging_folio: { isNot: null } },
      });
      expect(invoiceWhere.OR[1].invoice_type).toEqual({ in: ['credit_note', 'debit_note'] });
      // Only the active lines of the sale (its subtotal), never the cancelled ones.
      const folioSelect = (prisma.lodging_folios.findMany.mock.calls[0] as any)[0].select;
      expect(folioSelect.order.select.order_items.where).toEqual({ cancelled_at: null });
      // A folio with a valid fiscal document is never counted twice.
      const folioWhere = (prisma.lodging_folios.findMany.mock.calls[0] as any)[0].where;
      expect(folioWhere).toEqual({
        status: 'closed',
        closed_at: window,
        order: {
          state: { in: ['delivered', 'finished'] },
          invoices: {
            none: {
              invoice_type: { in: ['sales_invoice', 'pos_equivalent_document'] },
              status: { notIn: ['draft', 'rejected', 'voided', 'cancelled'] },
            },
          },
        },
      });
    });

    it('defaults to the 2.5 per mil rate when the store never set one', async () => {
      const { service } = build();

      const result = await service.get({ year: 2026, quarter: 3 });

      expect(result.rate_per_mil).toBe(2.5);
      expect(result.totals.contribution).toBe(2000);
    });
  });
});
