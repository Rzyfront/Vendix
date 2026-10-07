import { BadRequestException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { FiscalTaxCreditAvailabilityQueryDto } from './dto/fiscal-tax-credit-availability.dto';
import { StoreFiscalTaxCreditAvailabilityController } from './store-fiscal-tax-credit-availability.controller';
import { OrganizationFiscalTaxCreditAvailabilityController } from './organization-fiscal-tax-credit-availability.controller';

const context = { organization_id: 12, store_id: 8, accounting_entity_id: 44 };
const query: FiscalTaxCreditAvailabilityQueryDto = {
  tax_type: 'vat' as any,
  jurisdiction_key: 'CO-DIAN',
  as_of: '2026-04-30',
};
const result = { credits: [], available_total: '0', complete: true };

function makeStore() {
  const resolver = { resolveForStore: jest.fn().mockResolvedValue(context) };
  const service = { list: jest.fn().mockResolvedValue(result) };
  const response = { success: jest.fn((data: unknown) => ({ data })) };
  return { controller: new StoreFiscalTaxCreditAvailabilityController(resolver as any, service as any, response as any), resolver, service, response };
}
function makeOrganization() {
  const resolver = { resolveForOrganization: jest.fn().mockResolvedValue(context) };
  const service = { list: jest.fn().mockResolvedValue(result) };
  const response = { success: jest.fn((data: unknown) => ({ data })) };
  return { controller: new OrganizationFiscalTaxCreditAvailabilityController(resolver as any, service as any, response as any), resolver, service, response };
}

describe('GET fiscal tax-credit availability transport', () => {
  it('resolves store fiscal context, passes exact filters and wraps diagnostic response', async () => {
    const { controller, resolver, service, response } = makeStore();
    await expect(controller.getAvailability(query)).resolves.toEqual({ data: result });
    expect(resolver.resolveForStore).toHaveBeenCalledTimes(1);
    expect(service.list).toHaveBeenCalledWith(context, 'vat', 'CO-DIAN', new Date('2026-04-30T00:00:00.000Z'));
    expect(response.success).toHaveBeenCalledWith(result);
  });

  it('rejects store_id override before resolving fiscal context', async () => {
    const { controller, resolver, service } = makeStore();
    await expect(controller.getAvailability({ ...query, store_id: 9 })).rejects.toThrow(BadRequestException);
    expect(resolver.resolveForStore).not.toHaveBeenCalled();
    expect(service.list).not.toHaveBeenCalled();
  });

  it('resolves one organization entity for an optional store and propagates foreign-context errors', async () => {
    const { controller, resolver, service } = makeOrganization();
    await controller.getAvailability({ ...query, store_id: 8 });
    expect(resolver.resolveForOrganization).toHaveBeenCalledWith({ store_id: 8, require_single_entity: true });
    expect(service.list).toHaveBeenCalledWith(context, 'vat', 'CO-DIAN', new Date('2026-04-30T00:00:00.000Z'));

    const foreignError = new Error('store is outside organization');
    resolver.resolveForOrganization.mockRejectedValueOnce(foreignError);
    await expect(controller.getAvailability({ ...query, store_id: 999 })).rejects.toBe(foreignError);
    expect(service.list).toHaveBeenCalledTimes(1);
  });

  it('declares narrow GET routes and dashboard read permissions', () => {
    for (const [controller, permission] of [
      [StoreFiscalTaxCreditAvailabilityController, 'store:fiscal:dashboard:read'],
      [OrganizationFiscalTaxCreditAvailabilityController, 'organization:fiscal:dashboard:read'],
    ] as const) {
      const handler = controller.prototype.getAvailability;
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('tax-credits/availability');
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([permission]);
      expect(Reflect.getMetadata(PATH_METADATA, controller)).toMatch(/fiscal$/);
    }
  });

  it('requires strict query values and rejects impossible calendar dates', () => {
    const valid = plainToInstance(FiscalTaxCreditAvailabilityQueryDto, {
      tax_type: 'vat', jurisdiction_key: 'CO-DIAN', as_of: '2024-02-29', store_id: '8',
    });
    expect(validateSync(valid, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(valid.store_id).toBe(8);
    for (const invalidFields of [
      { tax_type: 'unknown' },
      { jurisdiction_key: '   ' },
      { jurisdiction_key: 'x'.repeat(101) },
      { as_of: '2026-02-30' },
      { as_of: '2026-2-03' },
      { store_id: '0' },
    ]) {
      const invalid = plainToInstance(FiscalTaxCreditAvailabilityQueryDto, {
        tax_type: 'vat', jurisdiction_key: 'CO-DIAN', as_of: '2026-04-30', ...invalidFields,
      });
      expect(validateSync(invalid).length).toBeGreaterThan(0);
    }
  });
});
