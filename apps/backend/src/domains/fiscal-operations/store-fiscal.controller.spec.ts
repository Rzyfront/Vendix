import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { OrganizationFiscalController } from './organization-fiscal.controller';
import { StoreFiscalController } from './store-fiscal.controller';
import { FiscalAuditService } from './services/fiscal-audit.service';
import { FiscalOperationsContext } from './services/fiscal-context-resolver.service';

describe('Fiscal history store isolation', () => {
  const events = {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };
  const audit = new FiscalAuditService({
    fiscal_operation_events: events,
  } as any);
  const fiscalContext = {
    organization_id: 10,
    store_id: null,
    accounting_entity_id: 77,
    fiscal_scope: 'ORGANIZATION',
    operating_scope: 'ORGANIZATION',
  } as FiscalOperationsContext;
  const contextResolver = {
    resolveForStore: jest.fn().mockResolvedValue(fiscalContext),
    resolveManyForOrganization: jest.fn().mockResolvedValue([fiscalContext]),
  };
  const response = {
    paginated: jest.fn((data, total, page, limit) => ({
      data,
      meta: { total, page, limit },
    })),
  };
  const controller = new StoreFiscalController(
    contextResolver as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    audit,
    {} as any,
    response as any,
  );
  const organizationController = new OrganizationFiscalController(
    contextResolver as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    audit,
    {} as any,
    response as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it.each([
    { currentStore: 20, queryStore: 21 },
    { currentStore: 21, queryStore: 20 },
    { currentStore: 20, queryStore: undefined },
  ])(
    'limits store $currentStore to its own events despite store_id=$queryStore',
    async ({ currentStore, queryStore }) => {
      await RequestContextService.runIsolated(
        {
          user_id: 9,
          organization_id: 10,
          store_id: currentStore,
          is_super_admin: false,
          is_owner: true,
        },
        () =>
          controller.listHistory({
            event_type: 'pos_sale_without_fiscal_document',
            store_id: queryStore,
          }),
      );

      const where = {
        AND: [
          { organization_id: 10, accounting_entity_id: 77 },
          { event_type: 'pos_sale_without_fiscal_document' },
          { store_id: currentStore },
        ],
      };
      expect(events.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where }),
      );
      expect(events.count).toHaveBeenCalledWith({ where });
    },
  );

  it.each([
    {
      query: { event_type: 'fiscal_obligation_created' },
      eventFilter: { event_type: 'fiscal_obligation_created' },
    },
    {
      query: { event_type: 'fiscal_obligation_created', store_id: 21 },
      eventFilter: { event_type: 'fiscal_obligation_created' },
    },
    { query: { store_id: 21 }, eventFilter: {} },
    { query: {}, eventFilter: {} },
  ])(
    'includes organization-wide events but excludes sibling store events',
    async ({ query, eventFilter }) => {
      await RequestContextService.runIsolated(
        {
          user_id: 9,
          organization_id: 10,
          store_id: 20,
          is_super_admin: false,
          is_owner: true,
        },
        () => controller.listHistory(query),
      );

      const where = {
        AND: [
          { organization_id: 10, accounting_entity_id: 77 },
          eventFilter,
          { OR: [{ store_id: 20 }, { store_id: null }] },
        ],
      };
      expect(events.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where }),
      );
      expect(events.count).toHaveBeenCalledWith({ where });
    },
  );

  it('fails closed with a typed context error when the authenticated store is missing', async () => {
    await expect(
      RequestContextService.runIsolated(
        {
          user_id: 9,
          organization_id: 10,
          is_super_admin: false,
          is_owner: true,
        },
        () => controller.listHistory({}),
      ),
    ).rejects.toMatchObject({
      constructor: VendixHttpException,
      response: expect.objectContaining({
        error_code: ErrorCodes.STORE_CONTEXT_001.code,
      }),
    });
    expect(events.findMany).not.toHaveBeenCalled();
  });

  it('preserves organization history across stores in the consolidated entity', async () => {
    await organizationController.listHistory({
      event_type: 'pos_sale_without_fiscal_document',
    });

    const where = {
      AND: [
        { organization_id: 10, accounting_entity_id: 77 },
        { event_type: 'pos_sale_without_fiscal_document' },
      ],
    };
    expect(contextResolver.resolveManyForOrganization).toHaveBeenCalled();
    expect(events.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where }),
    );
    expect(events.count).toHaveBeenCalledWith({ where });
  });
});
