import { FiscalScopeMigrationService } from './fiscal-scope-migration.service';

describe('FiscalScopeMigrationService', () => {
  const createService = (client: any) =>
    new FiscalScopeMigrationService(
      { withoutScope: () => client } as any,
      { invalidateFiscalScopeCache: jest.fn() } as any,
      { log: jest.fn() } as any,
    );

  it('blocks fiscal ORGANIZATION when operating scope is STORE', async () => {
    const client = {
      organizations: {
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          fiscal_scope: 'STORE',
          operating_scope: 'STORE',
          account_type: 'SINGLE_STORE',
        }),
      },
      dian_configurations: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = createService(client);

    const preview = await service.proposeChange(1, 'ORGANIZATION', 10);

    expect(preview.can_apply).toBe(false);
    expect(preview.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'FISCAL_SCOPE_INVALID_COMBINATION',
        }),
      ]),
    );
  });

  it('returns DIAN and period blockers when separating consolidated fiscal scope', async () => {
    const count = jest
      .fn()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    const client = {
      organizations: {
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          fiscal_scope: 'ORGANIZATION',
          operating_scope: 'ORGANIZATION',
          account_type: 'MULTI_STORE_ORG',
        }),
      },
      invoices: { count },
      fiscal_periods: { count: jest.fn().mockResolvedValue(1) },
      stores: {
        findMany: jest.fn().mockResolvedValue([
          { id: 10, name: 'A' },
          { id: 20, name: 'B' },
        ]),
      },
      dian_configurations: {
        findMany: jest.fn().mockResolvedValue([{ store_id: 10 }]),
      },
      accounting_entities: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ store_id: 10, tax_id: '900123456' }]),
      },
      consolidation_sessions: { count: jest.fn().mockResolvedValue(0) },
      intercompany_transactions: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = createService(client);

    const preview = await service.proposeChange(1, 'STORE', 10);

    expect(preview.can_apply).toBe(false);
    expect(preview.blockers.map((b) => b.code)).toEqual(
      expect.arrayContaining([
        'FISCAL_SCOPE_PENDING_INVOICES',
        'FISCAL_SCOPE_PENDING_DIAN_RESPONSE',
        'FISCAL_SCOPE_OPEN_PERIODS',
        'FISCAL_SCOPE_MISSING_DIAN_CONFIG',
        'FISCAL_SCOPE_MISSING_TAX_ID',
      ]),
    );
  });
});
