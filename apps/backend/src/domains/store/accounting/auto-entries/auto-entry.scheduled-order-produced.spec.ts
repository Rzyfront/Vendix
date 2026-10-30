import { AutoEntryService } from './auto-entry.service';

/**
 * Pedidos programados (S4): el costo de venta se reconoce al iniciar
 * producción con el mismo asiento del disparo a cocina (DR costo / CR
 * inventario), bajo su propio source_type.
 */
describe('AutoEntryService.onScheduledOrderProduced', () => {
  const build = () => {
    const mapping = {
      getMapping: jest.fn(async (_o: number, key: string) => ({ account_code: key, source: 'default' })),
    };
    const service = new AutoEntryService(
      { withoutScope: jest.fn() } as any,
      mapping as any,
      { resolveAccountingEntityForFiscal: jest.fn() } as any,
      { isAreaEnabled: jest.fn().mockResolvedValue(true), isSubflowEnabled: jest.fn().mockResolvedValue(true) } as any,
      { recordFailure: jest.fn(), recordSkip: jest.fn() } as any,
    );
    const create = jest.spyOn(service, 'createAutoEntry').mockResolvedValue({ id: 1 } as any);
    return { service, create };
  };

  const event = { schedule_id: 7, order_id: 40, organization_id: 1, store_id: 2, consumed_line_count: 3 };

  it('DR kitchen.fired.cogs / CR kitchen.fired.inventory por el costo consumido', async () => {
    const { service, create } = build();
    await service.onScheduledOrderProduced({ ...event, total_cost: 1234.5 });
    const arg = create.mock.calls[0][0];
    expect(arg).toEqual(expect.objectContaining({ source_type: 'scheduled_order.produced', source_id: 7 }));
    const lines = arg.lines.filter(Boolean) as any[];
    expect(lines.map((l) => [l.account_code, l.debit_amount, l.credit_amount])).toEqual([
      ['kitchen.fired.cogs', 1234.5, 0],
      ['kitchen.fired.inventory', 0, 1234.5],
    ]);
  });

  it('sin costo no crea asiento', async () => {
    const { service, create } = build();
    expect(await service.onScheduledOrderProduced({ ...event, total_cost: 0 })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
