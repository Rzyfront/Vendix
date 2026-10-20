import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { VexiObjectiveResultsController } from './vexi-objective-results.controller';
import { VexiController } from './vexi.controller';
import { VexiSurfaceEnabledGuard } from './guards/vexi-surface-enabled.guard';

const ID = '5c675771-8303-48db-9858-815ae11bc501';
const RESULT = '9f1d2c3b-4a5e-4f60-8a7b-1c2d3e4f5a6b';

function guardContext(
  handler: (...args: any[]) => unknown,
  user: Record<string, unknown>,
) {
  return {
    getHandler: () => handler,
    getClass: () => VexiObjectiveResultsController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('VexiObjectiveResultsController (E2E g14)', () => {
  const reflector = new Reflector();
  const proto = VexiObjectiveResultsController.prototype;
  const readers = [proto.getObjectiveResults, proto.getObjectiveResult];

  it('los dos lectores no exigen rol: RolesGuard no tiene nada que imponer', () => {
    for (const handler of readers)
      expect(
        reflector.getAllAndOverride(ROLES_KEY, [
          handler,
          VexiObjectiveResultsController,
        ]),
      ).toBeUndefined();
  });

  it('un cajero (rol personalizado fuera del enum) pasa el guard de roles', () => {
    const guard = new RolesGuard(reflector);
    for (const handler of readers)
      expect(
        guard.canActivate(guardContext(handler, { roles: ['cashier'] })),
      ).toBe(true);
  });

  it('conserva el interruptor de la superficie Vexi y NO hereda RolesGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      VexiObjectiveResultsController,
    );
    expect(guards).toContain(VexiSurfaceEnabledGuard);
    expect(guards).not.toContain(RolesGuard);
  });

  it('las rutas ya no viven bajo el @Roles(OWNER, ADMIN) de VexiController', () => {
    const vexi = VexiController.prototype as unknown as Record<string, unknown>;
    expect(vexi.getObjectiveResults).toBeUndefined();
    expect(vexi.getObjectiveResult).toBeUndefined();
  });

  it('delega en planState, que impone la propiedad por ALS', async () => {
    const planState = {
      listObjectiveResults: jest.fn().mockResolvedValue({ items: [] }),
      getObjectiveArtifact: jest.fn().mockResolvedValue({ id: RESULT }),
    };
    const controller = new VexiObjectiveResultsController(
      { success: (data: unknown) => data } as any,
      planState as any,
    );
    expect(await controller.getObjectiveResults(ID, { limit: 2 })).toEqual({
      items: [],
    });
    expect(planState.listObjectiveResults).toHaveBeenCalledWith(ID, {
      limit: 2,
    });
    expect(
      await controller.getObjectiveResult(ID, RESULT, { offset: 1 }),
    ).toEqual({ id: RESULT });
    expect(planState.getObjectiveArtifact).toHaveBeenCalledWith(ID, RESULT, {
      offset: 1,
    });
  });
});
