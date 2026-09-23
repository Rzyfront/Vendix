import { OrganizationsService } from '../organizations.service';
import { OPERATING_REVENUE_SQL } from '../../../store/analytics/analytics-metrics.contract';

/**
 * Ganancia de órdenes de la organización (`calculateOrderProfit`).
 *
 * El ingreso debe salir del contrato de analítica (`OPERATING_REVENUE_SQL`:
 * subtotal − descuentos + base del envío), nunca de `grand_total`, que carga el
 * IVA/INC de las líneas y el impuesto del envío como si fueran ganancia.
 */
describe('OrganizationsService.calculateOrderProfit', () => {
  function build(queryRaw: jest.Mock) {
    const prisma = { withoutScope: () => ({ $queryRaw: queryRaw }) };
    return new OrganizationsService(
      prisma as any,
      {} as any,
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
});
