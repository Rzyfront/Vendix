import { FiscalAuditService } from './fiscal-audit.service';
import { FiscalOperationsContext } from './fiscal-context-resolver.service';

describe('FiscalAuditService.list', () => {
  const events = {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };
  const service = new FiscalAuditService({ fiscal_operation_events: events } as any);
  const storeContext = {
    organization_id: 10,
    store_id: 20,
    accounting_entity_id: 77,
  } as FiscalOperationsContext;

  beforeEach(() => jest.clearAllMocks());

  it('combines the uncovered-sale filter with fiscal entity and store, including the count', async () => {
    await service.list([storeContext], {
      event_type: 'pos_sale_without_fiscal_document',
      page: 2,
      limit: 25,
    });

    const expectedWhere = {
      AND: [
        { organization_id: 10, accounting_entity_id: 77, store_id: 20 },
        { event_type: 'pos_sale_without_fiscal_document' },
      ],
    };
    expect(events.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere, skip: 25, take: 25 }),
    );
    expect(events.count).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it('cannot escape the store or fiscal entity through query parameters', async () => {
    await service.list([storeContext], {
      event_type: 'pos_sale_without_fiscal_document',
      store_id: 21,
      accounting_entity_id: 78,
    });

    expect(events.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { organization_id: 10, accounting_entity_id: 77, store_id: 20 },
            {
              event_type: 'pos_sale_without_fiscal_document',
              store_id: 21,
              accounting_entity_id: 78,
            },
          ],
        },
      }),
    );
  });

  it('keeps organization-wide consolidated reads across stores', async () => {
    await service.list([{ ...storeContext, store_id: null }], {});
    expect(events.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ organization_id: 10, accounting_entity_id: 77 }, {}],
        },
      }),
    );
  });

  it('returns an empty page when no fiscal entities are accessible', async () => {
    expect(await service.list([], {})).toEqual({
      data: [], total: 0, page: 1, limit: 50,
    });
    expect(events.findMany).not.toHaveBeenCalled();
  });
});
