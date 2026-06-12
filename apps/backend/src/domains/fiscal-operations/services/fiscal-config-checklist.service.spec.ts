import { FiscalConfigChecklistService } from './fiscal-config-checklist.service';

describe('FiscalConfigChecklistService', () => {
  const context = {
    organization_id: 1,
    store_id: 10,
    fiscal_scope: 'STORE' as const,
    operating_scope: 'STORE' as const,
    accounting_entity_id: 77,
    accounting_entity: {},
  };

  const completePrefill = {
    organization_id: 1,
    store_id: 10,
    fiscal_scope: 'STORE',
    legal_data: { nit: '900123456', nit_dv: '7', fiscal_regime: 'ordinario' },
    dian_config: {
      has_certificate: true,
      certificate_expiry: new Date(Date.now() + 86_400_000).toISOString(),
    },
    puc: { exists: true, total_accounts: 120, postable_accounts: 98 },
    accounting_period: { id: 1, name: 'FY2026' },
    default_taxes: { total_categories: 2, total_rates: 4, categories: [] },
    accounting_mappings: { total: 12, mapped_keys: [] },
    initial_inventory: null,
    payroll_config: { enabled: false, has_minimal: true },
    satisfied_steps: [],
  };

  const activeStatus = {
    organization_id: 1,
    store_id: 10,
    fiscal_scope: 'STORE',
    fiscal_status: {
      invoicing: { state: 'ACTIVE' },
      accounting: { state: 'ACTIVE' },
      payroll: { state: 'ACTIVE' },
    },
  };

  const createService = (overrides: any = {}) => {
    const unscoped = {
      withholding_concepts: {
        count: jest.fn().mockResolvedValue(3),
      },
      invoice_resolutions: {
        count: jest.fn().mockResolvedValue(1),
      },
      uvt_values: {
        findFirst: jest.fn().mockResolvedValue({ id: 1, value_cop: '49799' }),
      },
      ...overrides.unscoped,
    };
    const prisma = { withoutScope: jest.fn(() => unscoped) };
    const fiscalStatus = {
      buildWizardPrefill: jest
        .fn()
        .mockResolvedValue(overrides.prefill ?? completePrefill),
      read: jest.fn().mockResolvedValue(overrides.status ?? activeStatus),
    };

    return {
      service: new FiscalConfigChecklistService(
        prisma as any,
        fiscalStatus as any,
      ),
      prisma,
      unscoped,
      fiscalStatus,
    };
  };

  it('returns the 10 checklist items with 100% completion when everything is configured', async () => {
    const { service } = createService();

    const result = await service.build(context as any);

    expect(result.items.map((item) => item.key)).toEqual([
      'fiscal_identity',
      'dian_config',
      'puc',
      'accounting_period',
      'default_taxes',
      'accounting_mappings',
      'withholding_concepts',
      'invoice_resolution',
      'uvt_current_year',
      'payroll_config',
    ]);
    expect(result.items.every((item) => item.complete)).toBe(true);
    expect(result.completion_pct).toBe(100);
    for (const item of result.items) {
      expect(item.label).toBeTruthy();
      expect(item.detail).toBeTruthy();
      expect(item.link_hint).toBeTruthy();
    }
  });

  it('computes a partial percentage when sources are missing', async () => {
    const { service } = createService({
      prefill: {
        ...completePrefill,
        legal_data: { nit: '900123456', nit_dv: null, fiscal_regime: null },
        dian_config: null,
        accounting_mappings: { total: 0, mapped_keys: [] },
      },
      unscoped: {
        uvt_values: { findFirst: jest.fn().mockResolvedValue(null) },
      },
    });

    const result = await service.build(context as any);
    const byKey = Object.fromEntries(
      result.items.map((item) => [item.key, item]),
    );

    expect(byKey.fiscal_identity.complete).toBe(false);
    expect(byKey.dian_config.complete).toBe(false);
    expect(byKey.accounting_mappings.complete).toBe(false);
    expect(byKey.uvt_current_year.complete).toBe(false);
    // 6 of 10 complete
    expect(result.completion_pct).toBe(60);
  });

  it('marks payroll and withholding as not-applicable (complete) when their areas are INACTIVE', async () => {
    const { service, unscoped } = createService({
      prefill: {
        ...completePrefill,
        payroll_config: null,
      },
      status: {
        ...activeStatus,
        fiscal_status: {
          invoicing: { state: 'ACTIVE' },
          accounting: { state: 'INACTIVE' },
          payroll: { state: 'INACTIVE' },
        },
      },
      unscoped: {
        withholding_concepts: { count: jest.fn().mockResolvedValue(0) },
      },
    });

    const result = await service.build(context as any);
    const byKey = Object.fromEntries(
      result.items.map((item) => [item.key, item]),
    );

    expect(byKey.payroll_config.complete).toBe(true);
    expect(byKey.payroll_config.detail).toContain('No aplica');
    expect(byKey.withholding_concepts.complete).toBe(true);
    expect(byKey.withholding_concepts.detail).toContain('No aplica');
    expect(unscoped.withholding_concepts.count).toHaveBeenCalled();
  });

  it('marks an expired DIAN certificate as incomplete', async () => {
    const { service } = createService({
      prefill: {
        ...completePrefill,
        dian_config: {
          has_certificate: true,
          certificate_expiry: new Date(Date.now() - 86_400_000).toISOString(),
        },
      },
    });

    const result = await service.build(context as any);
    const dian = result.items.find((item) => item.key === 'dian_config');

    expect(dian?.complete).toBe(false);
    expect(dian?.detail).toContain('vencido');
  });
});
