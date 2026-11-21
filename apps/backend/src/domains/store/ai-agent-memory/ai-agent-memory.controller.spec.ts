import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ExecutionContext } from '@nestjs/common';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { VexEnabledGuard } from '../vex/guards/vex-enabled.guard';
import { AiAgentMemoryController } from './ai-agent-memory.controller';

function httpContext(storeId: number): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { store_id: storeId } }) }),
  } as unknown as ExecutionContext;
}

describe('AiAgentMemoryController guards (H5)', () => {
  it('shares the Vex gate: owner/admin roles and the store Vex switch', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AiAgentMemoryController);
    expect(guards).toEqual([RolesGuard, VexEnabledGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, AiAgentMemoryController)).toEqual([
      UserRole.OWNER,
      UserRole.ADMIN,
    ]);
  });

  it('a store with Vex switched off cannot reach the memory endpoints', async () => {
    const settingsOf = (enabled: boolean | undefined) => ({
      store_settings: {
        findUnique: jest.fn(async () => ({ settings: { vex: { enabled } } })),
      },
    });
    const off = new VexEnabledGuard(settingsOf(false) as never);
    await expect(off.canActivate(httpContext(1))).rejects.toMatchObject({
      errorCode: 'AI_AGENT_004',
    });
    const on = new VexEnabledGuard(settingsOf(true) as never);
    await expect(on.canActivate(httpContext(1))).resolves.toBe(true);
  });
});
