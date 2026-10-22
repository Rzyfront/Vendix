import { BadRequestException } from '@nestjs/common';
import { OrgDianConfigService } from './dian-config.service';
import { OrgDianConfigController } from './dian-config.controller';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';

/**
 * Guarda multi-tenant de los endpoints de organización que delegan en los
 * servicios de tienda: scope ORGANIZATION obligatorio y config propia
 * (misma org, store_id NULL) antes de delegar.
 */
describe('OrgDianConfigService — guardas de delegación', () => {
  const build = (scope: 'STORE' | 'ORGANIZATION', row: any) => {
    const prisma = {
      withoutScope: () => ({
        dian_configurations: { findFirst: jest.fn().mockResolvedValue(row) },
      }),
    };
    const fiscalScope = {
      requireFiscalScope: jest.fn().mockResolvedValue(scope),
    };
    const service = new OrgDianConfigService(
      prisma as any,
      {} as any,
      fiscalScope as any,
    );
    return { service, fiscalScope };
  };

  const inCtx = <T>(fn: () => Promise<T>) =>
    RequestContextService.run(
      { organization_id: 10, is_super_admin: false, is_owner: true } as any,
      fn,
    );

  it('(a) scope STORE → rechaza', async () => {
    const { service } = build('STORE', { id: 1, store_id: null });
    await expect(
      inCtx(() => service.assertOrgOwnedConfig(1)),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      inCtx(() => service.assertOrganizationFiscalScope()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('(b) config de otra org (no encontrada) → rechaza con 404', async () => {
    const { service } = build('ORGANIZATION', null);
    await expect(
      inCtx(() => service.assertOrgOwnedConfig(99)),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('(b) config anclada a una tienda → rechaza', async () => {
    const { service } = build('ORGANIZATION', { id: 2, store_id: 5 });
    await expect(
      inCtx(() => service.assertOrgOwnedConfig(2)),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('(c) ORGANIZATION + config propia → pasa', async () => {
    const { service } = build('ORGANIZATION', { id: 3, store_id: null });
    await expect(
      inCtx(() => service.assertOrgOwnedConfig(3)),
    ).resolves.toBeUndefined();
  });
});

describe('OrgDianConfigController — delegación tras la guarda', () => {
  const build = (guardError?: Error) => {
    const org = {
      assertOrganizationFiscalScope: jest.fn(),
      assertOrgOwnedConfig: jest.fn(),
    };
    if (guardError) {
      org.assertOrganizationFiscalScope.mockRejectedValue(guardError);
      org.assertOrgOwnedConfig.mockRejectedValue(guardError);
    }
    const store = {
      getFiscalReadiness: jest.fn().mockResolvedValue({ ok: 1 }),
      getProductionReadiness: jest.fn().mockResolvedValue({ ready: true }),
      promoteToProduction: jest.fn().mockResolvedValue({ promoted: true }),
    };
    const ranges = {
      queryRanges: jest.fn().mockResolvedValue([]),
      applyRanges: jest.fn().mockResolvedValue({ applied: 0 }),
    };
    const test = { getTestResults: jest.fn().mockResolvedValue({}) };
    const response = {
      success: jest.fn((d) => d),
      updated: jest.fn((d) => d),
    };
    const controller = new OrgDianConfigController(
      org as any,
      test as any,
      {} as any,
      response as any,
      {} as any,
      {} as any,
      {} as any,
      store as any,
      ranges as any,
    );
    return { controller, org, store, ranges, test };
  };

  it('delega en los servicios de tienda cuando la guarda pasa', async () => {
    const { controller, org, store, ranges, test } = build();
    await controller.getFiscalReadiness();
    await controller.getTestResults(7);
    await controller.getNumberingRanges(7, { environment: 'production' } as any);
    await controller.applyNumberingRanges(7, { ranges: [] } as any);
    await controller.getProductionReadiness(7);
    await controller.promoteToProduction(7);
    expect(org.assertOrganizationFiscalScope).toHaveBeenCalledTimes(1);
    expect(org.assertOrgOwnedConfig).toHaveBeenCalledTimes(5);
    expect(store.getFiscalReadiness).toHaveBeenCalled();
    expect(test.getTestResults).toHaveBeenCalledWith(7);
    expect(ranges.queryRanges).toHaveBeenCalledWith(7, 'production');
    expect(ranges.applyRanges).toHaveBeenCalledWith(7, { ranges: [] });
    expect(store.getProductionReadiness).toHaveBeenCalledWith(7);
    expect(store.promoteToProduction).toHaveBeenCalledWith(7);
  });

  it('NO delega si la guarda rechaza', async () => {
    const { controller, store, ranges, test } = build(
      new BadRequestException('x'),
    );
    await expect(controller.getFiscalReadiness()).rejects.toThrow();
    await expect(controller.getTestResults(7)).rejects.toThrow();
    await expect(controller.applyNumberingRanges(7, {} as any)).rejects.toThrow();
    await expect(controller.promoteToProduction(7)).rejects.toThrow();
    expect(store.getFiscalReadiness).not.toHaveBeenCalled();
    expect(store.promoteToProduction).not.toHaveBeenCalled();
    expect(ranges.applyRanges).not.toHaveBeenCalled();
    expect(test.getTestResults).not.toHaveBeenCalled();
  });
});
