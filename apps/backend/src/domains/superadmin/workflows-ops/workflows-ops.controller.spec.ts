import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { VendixHttpException } from '../../../common/errors';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { WorkflowsOpsController } from './workflows-ops.controller';

const contextFor = (handler: (...args: never[]) => unknown, roles: string[]): ExecutionContext =>
  ({
    getHandler: () => handler,
    getClass: () => WorkflowsOpsController,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 9, roles } }) }),
  }) as unknown as ExecutionContext;

describe('WorkflowsOpsController', () => {
  const guard = new RolesGuard(new Reflector());
  const handlers = [
    WorkflowsOpsController.prototype.getMetrics,
    WorkflowsOpsController.prototype.getAlerts,
  ];

  it.each(handlers.map((h) => [h.name, h] as const))(
    '%s is closed to store users (403)',
    (_name, handler) => {
      for (const role of ['owner', 'admin', 'manager']) {
        try {
          guard.canActivate(contextFor(handler, [role]));
          fail('a store role must not reach the platform-wide screen');
        } catch (e) {
          expect(e).toBeInstanceOf(VendixHttpException);
          expect((e as VendixHttpException).getStatus()).toBe(403);
        }
      }
    },
  );

  it.each(handlers.map((h) => [h.name, h] as const))('%s admits SUPER_ADMIN', (_name, handler) => {
    expect(guard.canActivate(contextFor(handler, ['super_admin']))).toBe(true);
  });

  it('paginates the alert history newest first', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 3 }]);
    const count = jest.fn().mockResolvedValue(41);
    const paginated = jest.fn().mockReturnValue('page');
    const controller = new WorkflowsOpsController(
      {} as never,
      { withoutScope: () => ({ workflow_ops_alerts: { findMany, count } }) } as never,
      { paginated } as never,
    );
    await expect(controller.getAlerts({ page: 3, limit: 20 })).resolves.toBe('page');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: 40,
        take: 20,
      }),
    );
    expect(paginated).toHaveBeenCalledWith([{ id: 3 }], 41, 3, 20, expect.any(String));
  });
});
