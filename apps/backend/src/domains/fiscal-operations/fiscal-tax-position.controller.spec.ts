import { BadRequestException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { FiscalTaxPositionQueryDto } from './dto/fiscal-tax-position.dto';
import { OrganizationFiscalController } from './organization-fiscal.controller';
import { StoreFiscalController } from './store-fiscal.controller';

describe('GET fiscal tax-position transport', () => {
  const context = {
    organization_id: 12,
    store_id: 8,
    accounting_entity_id: 44,
  };
  const query: FiscalTaxPositionQueryDto = {
    declaration_type: 'vat',
    period_year: 2026,
    period_month: 4,
    periodicity: 'bimonthly',
  };
  const estimate = { is_estimate: true, label: 'Preliminary estimate' };

  const makeStoreController = () => {
    const contextResolver = { resolveForStore: jest.fn().mockResolvedValue(context) };
    const declarations = { preview: jest.fn().mockResolvedValue(estimate) };
    const response = { success: jest.fn((data: unknown) => ({ data })) };
    const controller = new StoreFiscalController(
      contextResolver as any,
      {} as any,
      {} as any,
      declarations as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      response as any,
    );
    return { controller, contextResolver, declarations, response };
  };

  const makeOrganizationController = () => {
    const contextResolver = {
      resolveForOrganization: jest.fn().mockResolvedValue(context),
      resolveManyForOrganization: jest.fn(),
    };
    const declarations = { preview: jest.fn().mockResolvedValue(estimate) };
    const response = { success: jest.fn((data: unknown) => ({ data })) };
    const controller = new OrganizationFiscalController(
      contextResolver as any,
      {} as any,
      {} as any,
      declarations as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      response as any,
    );
    return { controller, contextResolver, declarations, response };
  };

  it('delegates store context to preview and wraps the result in success', async () => {
    const { controller, contextResolver, declarations, response } =
      makeStoreController();

    await expect(controller.getTaxPosition(query)).resolves.toEqual({
      data: estimate,
    });
    expect(contextResolver.resolveForStore).toHaveBeenCalledTimes(1);
    expect(declarations.preview).toHaveBeenCalledWith(context, query);
    expect(response.success).toHaveBeenCalledWith(estimate);
  });

  it('rejects a store_id selector instead of allowing fiscal mass assignment', async () => {
    const { controller, contextResolver, declarations } = makeStoreController();

    await expect(
      controller.getTaxPosition({ ...query, store_id: 99 }),
    ).rejects.toThrow(BadRequestException);
    expect(contextResolver.resolveForStore).not.toHaveBeenCalled();
    expect(declarations.preview).not.toHaveBeenCalled();
  });

  it('resolves exactly one organization fiscal entity for an optional store selector', async () => {
    const { controller, contextResolver, declarations, response } =
      makeOrganizationController();
    const selectedQuery = { ...query, store_id: 8 };

    await expect(controller.getTaxPosition(selectedQuery)).resolves.toEqual({
      data: estimate,
    });
    expect(contextResolver.resolveForOrganization).toHaveBeenCalledWith({
      store_id: 8,
      require_single_entity: true,
    });
    expect(contextResolver.resolveForOrganization).toHaveBeenCalledTimes(1);
    expect(contextResolver.resolveManyForOrganization).not.toHaveBeenCalled();
    expect(declarations.preview).toHaveBeenCalledWith(context, selectedQuery);
    expect(response.success).toHaveBeenCalledWith(estimate);
  });

  it('declares read permissions and a GET tax-position route for both surfaces', () => {
    for (const [controller, permission] of [
      [StoreFiscalController, 'store:fiscal:dashboard:read'],
      [OrganizationFiscalController, 'organization:fiscal:dashboard:read'],
    ] as const) {
      const handler = controller.prototype.getTaxPosition;
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('tax-position');
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
        RequestMethod.GET,
      );
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([
        permission,
      ]);
    }
  });

  it('validates period/type/store/obligation query fields and forbids entity selectors', () => {
    const valid = plainToInstance(FiscalTaxPositionQueryDto, {
      declaration_type: 'vat',
      period_year: '2026',
      period_month: '4',
      periodicity: 'bimonthly',
      store_id: '8',
      obligation_id: '77',
    });
    expect(validateSync(valid, { whitelist: true, forbidNonWhitelisted: true })).toEqual(
      [],
    );
    expect(valid.store_id).toBe(8);
    expect(valid.obligation_id).toBe(77);

    const invalidCases = [
      { period_year: 'not-a-year' },
      { period_month: 13 },
      { declaration_type: 'unknown-tax' },
      { store_id: 0 },
      { obligation_id: -1 },
    ];
    for (const invalidFields of invalidCases) {
      const invalid = plainToInstance(FiscalTaxPositionQueryDto, {
        declaration_type: 'vat',
        period_year: 2026,
        ...invalidFields,
      });
      expect(
        validateSync(invalid, {
          whitelist: true,
          forbidNonWhitelisted: true,
        }).length,
      ).toBeGreaterThan(0);
    }

    const withEntitySelector = plainToInstance(FiscalTaxPositionQueryDto, {
      declaration_type: 'vat',
      period_year: 2026,
      accounting_entity_id: 44,
      organization_id: 12,
      status: 'ready',
    });
    expect(
      validateSync(withEntitySelector, {
        whitelist: true,
        forbidNonWhitelisted: true,
      }).map((error) => error.property),
    ).toEqual(
      expect.arrayContaining(['accounting_entity_id', 'organization_id', 'status']),
    );
  });
});
