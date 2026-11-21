import { RequestContextService } from '../../../common/context/request-context.service';
import { VexiContextService } from './vexi-context.service';

const ctx = {
  store_id: 1,
  organization_id: 2,
  user_id: 3,
  is_super_admin: false,
  is_owner: true,
};

function build(memoryBlock: string) {
  // Every business section fails (empty stubs): sections are failure-isolated.
  const agentMemory = { buildSnapshotBlock: jest.fn(async () => memoryBlock) };
  const service = new VexiContextService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    agentMemory as never,
  );
  return { service, agentMemory };
}

describe('VexiContextService store memory', () => {
  it('injects the "Memoria de la tienda" block into the Vex snapshot for the session store only', async () => {
    const { service, agentMemory } = build(
      'Memoria de la tienda (x):\n- learning.format: video',
    );
    const snapshot = await RequestContextService.runIsolated(ctx, () =>
      service.buildVexSnapshot(),
    );
    expect(snapshot.store_memory).toContain('- learning.format: video');
    expect(agentMemory.buildSnapshotBlock).toHaveBeenCalledWith(1);
  });

  it('tells Vex there is no memory yet when the store has none', async () => {
    const { service } = build('');
    const snapshot = await RequestContextService.runIsolated(ctx, () =>
      service.buildVexSnapshot(),
    );
    expect(snapshot.store_memory).toContain('todavía no hay recuerdos');
  });

  it('keeps the Vexi snapshot unchanged: no store_memory key and no memory read', async () => {
    const { service, agentMemory } = build('Memoria de la tienda (x):\n- a: b');
    const snapshot = await RequestContextService.runIsolated(ctx, () =>
      service.buildSnapshot(),
    );
    expect(Object.keys(snapshot).sort()).toEqual(
      [
        'store_profile',
        'business_metrics',
        'active_modules',
        'subscription_state',
        'user_identity',
        'current_datetime',
        'ui_context',
        'turn_attachments',
      ].sort(),
    );
    expect(agentMemory.buildSnapshotBlock).not.toHaveBeenCalled();
  });
});
