import { Prisma } from '@prisma/client';
import { PaymentsAnalyticsService } from './payments-analytics.service';
import { RequestContextService } from '@common/context/request-context.service';

type Mock = {
  store_settings: { findFirst: jest.Mock };
  $queryRaw: jest.Mock;
  withoutScope: jest.Mock;
};

describe('PaymentsAnalyticsService', () => {
  let service: PaymentsAnalyticsService;
  let prisma: Mock;

  const QUERY = { date_from: '2026-07-01', date_to: '2026-07-31' } as any;

  /**
   * Consultas $queryRaw capturadas. Re-armadas con `Prisma.sql(strings, ...values)`,
   * que aplana los fragmentos anidados (`.sql` usa `?` como placeholder).
   */
  const capturedSql = (): Array<{ text: string; values: unknown[] }> =>
    prisma.$queryRaw.mock.calls.map((call) => {
      const sql = Prisma.sql(call[0] as TemplateStringsArray, ...call.slice(1));
      return { text: sql.sql, values: sql.values };
    });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      withoutScope: jest.fn(),
    };
    prisma.withoutScope.mockReturnValue({ $queryRaw: prisma.$queryRaw });
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 7, is_super_admin: false, is_owner: false });
    service = new PaymentsAnalyticsService(prisma as any);
  });

  describe('scope y filtros', () => {
    it('fija store_id del contexto en el SQL crudo', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ total: 0 }]);
      await service.getPayments(QUERY);
      const [count] = capturedSql();
      expect(count.text).toContain('o.store_id = ?');
      expect(count.values).toContain(7);
    });

    it('traduce multi-estado a IN con un parámetro tipado por estado', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ total: 0 }]);
      await service.getPayments({
        ...QUERY,
        state: ['succeeded', 'pending'],
      });
      const [count] = capturedSql();
      expect(count.text).toMatch(
        /p\.state IN \(\?::payments_state_enum,\?::payments_state_enum\)/,
      );
      expect(count.values).toEqual(
        expect.arrayContaining(['succeeded', 'pending']),
      );
    });

    it('sin state no agrega filtro de estado (todos los estados)', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ total: 0 }]);
      await service.getPayments(QUERY);
      const [count] = capturedSql();
      expect(count.text).not.toContain('payments_state_enum');
    });

    it('filtra método por store_payment_method_id (multi)', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ total: 0 }]);
      await service.getPayments({ ...QUERY, payment_method_id: [3, 9] });
      const [count] = capturedSql();
      expect(count.text).toMatch(
        /p\.store_payment_method_id IN \(\?,\?\)/,
      );
      expect(count.values).toEqual(expect.arrayContaining([3, 9]));
    });

    it('escapa comodidades LIKE del search y lo parametriza', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ total: 0 }]);
      await service.getPayments({ ...QUERY, search: '50%_x' });
      const [count] = capturedSql();
      expect(count.values).toContain('%50\\%\\_x%');
      expect(count.text).not.toContain('50%');
    });

    it('lanza si no hay store en el contexto', async () => {
      (RequestContextService.getContext as jest.Mock).mockReturnValue({});
      await expect(service.getSummary(QUERY)).rejects.toBeDefined();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('getPayments', () => {
    it('mapea la fila: neto = monto - reembolsado y cliente/método/caja', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ total: 1 }]).mockResolvedValueOnce([
        {
          id: 11,
          effective_at: new Date('2026-07-05T15:00:00.000Z'),
          paid_at: null,
          created_at: new Date('2026-07-05T15:00:00.000Z'),
          state: 'partially_refunded',
          amount: '100.50',
          refunded_amount: '30.25',
          currency: 'COP',
          transaction_id: 'tx-1',
          gateway_reference: null,
          has_receipt: true,
          order_id: 5,
          order_number: 'ORD-5',
          order_state: 'finished',
          order_channel: 'pos',
          customer_alias: null,
          customer_id: 2,
          customer_first_name: 'Ana',
          customer_last_name: 'Gómez',
          customer_document: '123',
          customer_email: 'a@x.co',
          method_id: 4,
          method_name: 'Datáfono',
          method_type: 'card',
          bank_account_id: null,
          bank_account_name: null,
          cash_session_id: 8,
          cash_register_name: 'Caja 1',
        },
      ]);
      const res = await service.getPayments({ ...QUERY, page: 1, limit: 10 });
      expect(res.total).toBe(1);
      expect(res.page).toBe(1);
      expect(res.data[0]).toMatchObject({
        id: 11,
        effective_date: '2026-07-05T15:00:00.000Z',
        paid_at: null,
        amount: 100.5,
        refunded_amount: 30.25,
        net_amount: 70.25,
        customer: { id: 2, name: 'Ana Gómez', document: '123' },
        payment_method: { id: 4, display_name: 'Datáfono', type: 'card' },
        bank_account: null,
        cash_register: { session_id: 8, register_name: 'Caja 1' },
        has_receipt: true,
        order: { id: 5, order_number: 'ORD-5', channel: 'pos' },
      });
    });

    it('usa lista blanca de orden: sort_by desconocido cae a la fecha efectiva', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
      await service.getPayments({
        ...QUERY,
        sort_by: 'amount; DROP TABLE payments',
        sort_order: 'asc',
      });
      const rows = capturedSql()[1];
      expect(rows.text).toContain('ORDER BY COALESCE(p.paid_at, p.created_at) ASC');
      expect(rows.text).not.toContain('DROP TABLE');
    });
  });

  describe('getSummary', () => {
    const totals = (over: Record<string, unknown> = {}) => ({
      total_collected: '1000',
      collected_count: 4,
      total_amount: '1500',
      payments_count: 6,
      pending_amount: '300',
      failed_count: 1,
      total_refunded: '100',
      ...over,
    });

    it('calcula KPIs, promedio, neto y crecimiento contra el período previo', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([totals()])
        .mockResolvedValueOnce([{ total_collected: '800' }])
        .mockResolvedValueOnce([
          { method_id: 1, method_name: 'Efectivo', method_type: 'cash', collected_count: 3, collected_amount: '750' },
          { method_id: 2, method_name: 'Tarjeta', method_type: 'card', collected_count: 1, collected_amount: '250' },
        ])
        .mockResolvedValueOnce([
          { state: 'succeeded', count: 4, amount: '1000' },
          { state: 'pending', count: 1, amount: '300' },
        ]);
      const s = await service.getSummary(QUERY);
      expect(s.total_collected).toBe(1000);
      expect(s.average_payment).toBe(250);
      expect(s.net_collected).toBe(900);
      expect(s.previous_total_collected).toBe(800);
      expect(s.collected_growth).toBe(25);
      expect(s.by_method.map((m) => m.percentage)).toEqual([75, 25]);
      expect(s.by_state).toEqual([
        { state: 'succeeded', count: 4, amount: 1000 },
        { state: 'pending', count: 1, amount: 300 },
      ]);
    });

    it('collected_growth es null cuando el período previo no tiene base', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([totals()])
        .mockResolvedValueOnce([{ total_collected: '0' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      const s = await service.getSummary(QUERY);
      expect(s.previous_total_collected).toBe(0);
      expect(s.collected_growth).toBeNull();
    });

    it('percentage es 0 (no NaN) y average 0 cuando no hay recaudo', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([
          totals({ total_collected: '0', collected_count: 0, total_refunded: '0' }),
        ])
        .mockResolvedValueOnce([{ total_collected: '50' }])
        .mockResolvedValueOnce([
          { method_id: null, method_name: null, method_type: null, collected_count: 0, collected_amount: '0' },
        ])
        .mockResolvedValueOnce([]);
      const s = await service.getSummary(QUERY);
      expect(s.average_payment).toBe(0);
      expect(s.by_method[0]).toMatchObject({
        payment_method_id: null,
        display_name: 'Sin método',
        percentage: 0,
      });
      expect(s.collected_growth).toBe(-100);
    });

    it('las 4 consultas van con store_id explícito', async () => {
      await service.getSummary(QUERY);
      const all = capturedSql();
      expect(all).toHaveLength(4);
      for (const q of all) {
        expect(q.text).toContain('o.store_id = ?');
        expect(q.values).toContain(7);
      }
    });
  });

  describe('getTrends', () => {
    it('rellena con ceros los períodos sin pagos (zero-fill)', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { period: '2026-07-02', collected_amount: '500', payments_count: 2 },
      ]);
      const out = await service.getTrends({
        date_from: '2026-07-01',
        date_to: '2026-07-03',
        granularity: 'day',
      } as any);
      expect(out).toEqual([
        { period: '2026-07-01', collected_amount: 0, payments_count: 0 },
        { period: '2026-07-02', collected_amount: 500, payments_count: 2 },
        { period: '2026-07-03', collected_amount: 0, payments_count: 0 },
      ]);
    });
  });
});
