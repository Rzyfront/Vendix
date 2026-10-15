import { Reflector } from '@nestjs/core';
import {
  InvoiceHolderChangesController,
  HolderChangeCustomerDto,
} from './invoice-holder-changes.controller';
import { ValidationPipe } from '@nestjs/common';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';

describe('holder admin endpoint authorization', () => {
  const reflector = new Reflector();
  it.each(['status', 'context'])(
    'protects %s with explicit invoicing read permission',
    (method) => {
      expect(
        reflector.get(
          PERMISSIONS_KEY,
          (InvoiceHolderChangesController.prototype as any)[method],
        ),
      ).toEqual(['invoicing:read']);
    },
  );
  it.each(['customer', 'resume', 'release', 'remake'])(
    'protects %s with explicit invoicing write permission',
    (method) => {
      expect(
        reflector.get(
          PERMISSIONS_KEY,
          (InvoiceHolderChangesController.prototype as any)[method],
        ),
      ).toEqual(['invoicing:write']);
    },
  );
  it('rejects authenticated staff with no write permission even if a button is forged', () => {
    const guard = new PermissionsGuard(reflector);
    const context: any = {
      getHandler: () => InvoiceHolderChangesController.prototype.remake,
      getClass: () => InvoiceHolderChangesController,
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          route: { path: '/api/store/invoicing/:id/remake' },
          user: { roles: ['staff'], permissions: [] },
        }),
      }),
    };
    expect(() => guard.canActivate(context)).toThrow();
  });
  it('customer creation separately requires customer permission (invoicing write is not enough)', async () => {
    const changes: any = { setCustomer: jest.fn() };
    const controller = new InvoiceHolderChangesController(changes);
    await expect(
      controller.customer(
        21,
        { snapshot: {} as any },
        {
          user: {
            roles: ['staff'],
            permissions: [{ name: 'invoicing:write', status: 'active' }],
          },
        },
      ),
    ).rejects.toBeDefined();
    expect(changes.setCustomer).not.toHaveBeenCalled();
  });
  it('update-only customer access does not authorize creating a customer from a snapshot', async () => {
    const changes: any = { setCustomer: jest.fn() };
    const controller = new InvoiceHolderChangesController(changes);
    await expect(
      controller.customer(
        21,
        { snapshot: {} as any },
        {
          user: {
            roles: ['staff'],
            permissions: [{ name: 'store:customers:update', status: 'active' }],
          },
        },
      ),
    ).rejects.toMatchObject({ errorCode: 'AUTH_PERM_001' });
    expect(changes.setCustomer).not.toHaveBeenCalled();
  });
  it('validates nested capture and rejects ownership/status mass assignment before service writes', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const snapshot = {
      person_type: 'NATURAL',
      document_type: 'CC',
      document_number: '10852746',
      first_name: 'Rafael',
      last_name: 'Perez',
      email: 'qa@example.invalid',
      tax_regime: 'COMUN',
      fiscal_responsibilities: ['R-99-PN'],
      address: {
        address_line1: 'Carrera 1',
        city: 'Bogotá',
        state_province: 'Bogotá',
        country_code: 'CO',
        municipality_code: '11001',
      },
    };
    const metadata = {
      type: 'body' as const,
      metatype: HolderChangeCustomerDto,
    };
    await expect(pipe.transform({ snapshot }, metadata)).resolves.toMatchObject(
      { snapshot: { tax_regime: 'COMUN' } },
    );
    for (const payload of [
      { snapshot: { ...snapshot, phase: 'completed' } },
      {
        snapshot: {
          ...snapshot,
          address: { ...snapshot.address, store_id: 3 },
        },
      },
      { snapshot: { ...snapshot, email: '' } },
    ])
      await expect(pipe.transform(payload, metadata)).rejects.toThrow();
  });
});
