import { OrganizationsService } from '../organizations.service';
import { OPERATING_REVENUE_SQL } from '../../../store/analytics/analytics-metrics.contract';

/** Texto plano de una llamada a `$queryRaw` como tagged template. */
function sqlText(call: any[]): string {
  const [strings, ...values] = call;
  return (strings as string[]).reduce((acc, str, i) => {
    const v = values[i];
    const rendered =
      i < values.length
        ? v && Array.isArray(v.strings)
          ? v.strings.join('?')
          : '$'
        : '';
    return acc + str + rendered;
  }, '');
}

/**
 * Ganancia de órdenes de la organización (`calculateOrderProfit`).
 *
 * El ingreso debe salir del contrato de analítica (`OPERATING_REVENUE_SQL`:
 * subtotal − descuentos + base del envío), nunca de `grand_total`, que carga el
 * IVA/INC de las líneas y el impuesto del envío como si fueran ganancia.
 */
describe('OrganizationsService.calculateOrderProfit', () => {
  function build(queryRaw: jest.Mock, extra: Record<string, any> = {}, global: any = {}) {
    const prisma = { withoutScope: () => ({ $queryRaw: queryRaw, ...extra }), ...extra };
    return new OrganizationsService(
      prisma as any,
      global,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  }

  it('usa el ingreso operativo del contrato y resta COGS y costo de transporte', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ revenue: 14888.89, cogs: 400 }])
      .mockResolvedValueOnce([{ transport_cost: 100 }]);
    const service = build(queryRaw);

    const result = await (service as any).calculateOrderProfit(
      1,
      new Date('2026-09-01T05:00:00.000Z'),
    );

    // Consulta de ingresos: interpola el fragmento del contrato y ya no lee
    // grand_total ni shipping_cost por su cuenta.
    const [strings, ...values] = queryRaw.mock.calls[0];
    const text = (strings as string[]).join('');
    expect(values).toContain(OPERATING_REVENUE_SQL);
    expect(text).not.toContain('grand_total');
    expect(text).not.toContain('shipping_cost');

    expect(result._sum.profit).toBeCloseTo(14888.89 - 400 - 100, 2);
  });

  it('filtra la CxP de transporte al mismo rango del período y por tienda con su propio alias', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ revenue: 1000, cogs: 0 }])
      .mockResolvedValueOnce([{ transport_cost: 100 }]);
    const service = build(queryRaw);
    const start = new Date('2026-08-01T05:00:00.000Z');
    const end = new Date('2026-09-01T04:59:59.999Z');

    await (service as any).calculateOrderProfit(1, start, end, 7);

    const apCall = queryRaw.mock.calls[1];
    const apText = sqlText(apCall);
    expect(apText).toContain('ap.created_at >=');
    expect(apText).toContain('ap.created_at <=');
    expect(apText).toContain('ap.store_id =');
    // El filtro de tienda de órdenes (alias `o.`) no puede colarse en la CxP.
    expect(apText).not.toContain('o.store_id');
    const flat = (vals: any[]): any[] =>
      vals.flatMap((v) => (v && Array.isArray(v.values) ? flat(v.values) : [v]));
    expect(flat(apCall.slice(1))).toEqual(
      expect.arrayContaining([start, end, 7]),
    );
  });

  it('cuenta ventas con COMPLETED_SALE_STATES (delivered + finished), nunca solo finished', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ revenue: 0, cogs: 0 }])
      .mockResolvedValueOnce([{ transport_cost: 0 }]);
    const service = build(queryRaw);

    await (service as any).calculateOrderProfit(1, new Date());

    const text = sqlText(queryRaw.mock.calls[0]);
    expect(text).toContain("o.state IN ('delivered', 'finished')");
    expect(text).not.toContain("o.state = 'finished'");
  });

  it('tendencia y distribución por tipo de tienda usan el ingreso operativo y los estados del contrato', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    queryRaw.mockImplementation((...call: any[]) => {
      const text = sqlText(call);
      if (text.includes('transport_cost')) return Promise.resolve([{ transport_cost: 0 }]);
      if (text.includes('order_totals')) return Promise.resolve([{ revenue: 0, cogs: 0 }]);
      if (text.includes('s.store_type')) return Promise.resolve([{ type: 'online', revenue: 500 }]);
      return Promise.resolve([]);
    });
    const count = jest.fn().mockResolvedValue(0);
    const extra = {
      stores: { count },
      users: { count },
      orders: { count },
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = build(queryRaw, extra, { user_sessions: { count } });

    const result = await (service as any).computeOrganizationStats(1, {});

    const calls = queryRaw.mock.calls;
    const trend = calls.find((c) => sqlText(c).includes('monthly_orders'))!;
    const dist = calls.find((c) => sqlText(c).includes('s.store_type'))!;
    for (const call of [trend, dist]) {
      expect(call.slice(1)).toContain(OPERATING_REVENUE_SQL);
      const text = sqlText(call);
      expect(text).not.toContain('grand_total');
      expect(text).toContain("o.state IN ('delivered', 'finished')");
    }
    // Conteos de órdenes del panel: mismos estados de venta consumada.
    const orderCountWhere = count.mock.calls
      .map((c) => c[0]?.where)
      .filter((w) => w && 'stores' in w);
    expect(orderCountWhere.length).toBe(2);
    for (const w of orderCountWhere) {
      expect(w.state).toEqual({ in: ['delivered', 'finished'] });
    }
    expect(result.store_distribution).toEqual([
      { type: 'online', count: 0, revenue: 500 },
    ]);
  });
});
