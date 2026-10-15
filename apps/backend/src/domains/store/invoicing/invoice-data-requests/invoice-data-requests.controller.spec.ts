import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { InvoiceDataRequestsController } from './invoice-data-requests.controller';

describe('Invoice demand API requires real invoicing permission', () => {
  const guard = new PermissionsGuard(new Reflector());
  const context = (handler: Function, permissions: unknown[]) =>
    ({
      getHandler: () => handler,
      getClass: () => InvoiceDataRequestsController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 7, permissions },
          method:
            handler === InvoiceDataRequestsController.prototype.process
              ? 'POST'
              : 'GET',
          route: { path: '/store/invoice-data-requests/:id/process' },
        }),
      }),
    }) as any;
  it('staff read permission does not authorize processing', () => {
    expect(() =>
      guard.canActivate(
        context(InvoiceDataRequestsController.prototype.process, [
          { name: 'invoicing:read', status: 'active' },
        ]),
      ),
    ).toThrow(expect.objectContaining({ errorCode: 'AUTH_PERM_001' }));
  });
  it('staff write authorizes retry while read authorizes listing', () => {
    expect(
      guard.canActivate(
        context(InvoiceDataRequestsController.prototype.process, [
          { name: 'invoicing:write', status: 'active' },
        ]),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        context(InvoiceDataRequestsController.prototype.findAll, [
          { name: 'invoicing:read', status: 'active' },
        ]),
      ),
    ).toBe(true);
  });
  it('missing or inactive permissions deny listing', () => {
    expect(() =>
      guard.canActivate(
        context(InvoiceDataRequestsController.prototype.findAll, []),
      ),
    ).toThrow();
    expect(() =>
      guard.canActivate(
        context(InvoiceDataRequestsController.prototype.summary, [
          { name: 'invoicing:read', status: 'inactive' },
        ]),
      ),
    ).toThrow();
  });
});
