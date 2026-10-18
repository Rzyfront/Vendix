import {
  RequestContext,
  RequestContextService,
} from '../../../common/context/request-context.service';
import { createApiBridgeTools } from '../../../ai-engine/tools/bridge/api-bridge.tools';
import { CatalogEntry } from '../../../ai-engine/tools/bridge/api-catalog.service';
import { VexiVoiceAuthorityService } from './vexi-voice-authority.service';

describe('VexiVoiceAuthorityService scoped execution authority', () => {
  const owner: RequestContext = {
    user_id: 7,
    organization_id: 3,
    store_id: 5,
    roles: ['owner'],
    permissions: ['products:update', 'orders:update'],
    is_owner: true,
    is_super_admin: false,
  };
  const definition = (name: string) => ({
    type: 'function' as const,
    function: { name, description: name, parameters: { type: 'object' } },
  });
  let objective: Record<string, unknown>;
  let prisma: { ai_conversations: { findFirst: jest.Mock } };
  let globalPrisma: {
    ai_agents: { findUnique: jest.Mock };
    store_settings: { findUnique: jest.Mock };
  };
  let agent: { resolveToolAuthority: jest.Mock };
  let access: { canUseAIFeature: jest.Mock; canUseModule: jest.Mock };
  let plans: { get: jest.Mock; createHook: jest.Mock };
  let objectives: { getForConversation: jest.Mock; get: jest.Mock };
  let service: VexiVoiceAuthorityService;
  let previousFlag: string | undefined;

  const asOwner = <T>(fn: () => T): T =>
    RequestContextService.runIsolated(owner, fn);
  beforeEach(() => {
    objective = {
      id: '11111111-1111-4111-8111-111111111111',
      conversation_id: 8,
      user_id: 7,
      organization_id: 3,
      store_id: 5,
      authority_snapshot: ['products:update'],
      expires_at: new Date(Date.now() + 60_000),
      semantic_status: 'active',
      goal: 'QA',
    };
    prisma = {
      ai_conversations: {
        findFirst: jest.fn().mockResolvedValue({
          id: 8,
          metadata: { agent_key: 'vexi' },
          status: 'active',
        }),
      },
    };
    globalPrisma = {
      ai_agents: {
        findUnique: jest.fn().mockResolvedValue({
          is_active: true,
          allowed_tools: ['*'],
          denied_tools: [],
        }),
      },
      store_settings: {
        findUnique: jest.fn().mockResolvedValue({
          settings: { vexi: { enabled: true }, vex: { enabled: true } },
        }),
      },
    };
    agent = {
      resolveToolAuthority: jest.fn(async () => [
        definition('write_endpoint'),
        definition('agent_plan_resume'),
      ]),
    };
    access = {
      canUseAIFeature: jest.fn().mockResolvedValue({ allowed: true }),
      canUseModule: jest.fn().mockResolvedValue({ mode: 'allow' }),
    };
    plans = { get: jest.fn().mockResolvedValue(null), createHook: jest.fn() };
    objectives = {
      getForConversation: jest.fn(async () => objective),
      get: jest.fn(async () => objective),
    };
    service = new VexiVoiceAuthorityService(
      prisma as never,
      globalPrisma as never,
      agent as never,
      access as never,
      plans as never,
      objectives as never,
    );
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retains current intersect snapshot throughout awaited callback and restores original ALS', () =>
    asOwner(async () => {
      const authority = await service.resolveAuthority(8, 'vexi');
      await service.runAuthorized(authority, async (fresh) => {
        await Promise.resolve();
        expect(fresh.objective_id).toBe(objective.id);
        expect(
          RequestContextService.asyncLocalStorage.getStore()?.permissions,
        ).toEqual(['products:update']);
        expect(
          RequestContextService.asyncLocalStorage.getStore()?.roles,
        ).toEqual([]);
        expect((await service.resolveAuthority(8, 'vexi')).objective_id).toBe(
          objective.id,
        );
      });
      expect(
        RequestContextService.asyncLocalStorage.getStore()?.permissions,
      ).toEqual(owner.permissions);
      expect(RequestContextService.asyncLocalStorage.getStore()?.roles).toEqual(
        ['owner'],
      );
    }));

  it('same generic bridge tool cannot preview an endpoint permission gained after objective creation', () =>
    asOwner(async () => {
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('must not fetch'));
      const entry = {
        path: 'store/orders',
        method: 'POST',
        area: 'store',
        domain: 'orders',
        controller: 'Orders',
        handler: 'create',
        requiredPermissions: ['orders:update'],
        summary: 'Crear pedido',
      } as CatalogEntry;
      const catalog = {
        find: jest.fn().mockReturnValue(entry),
        methodsFor: jest.fn().mockReturnValue(['POST']),
      };
      const bridge = createApiBridgeTools({
        catalog: catalog as never,
        attachments: {} as never,
      }).find((tool) => tool.name === 'write_endpoint')!;
      const authority = await service.resolveAuthority(8, 'vexi');
      expect(
        authority.authorizedDefinitions.some(
          (item) => item.function.name === 'write_endpoint',
        ),
      ).toBe(true);
      const preview = await service.runAuthorized(authority, () =>
        bridge.preview!(
          { path: 'store/orders', method: 'POST', body: { name: 'QA' } },
          {},
        ),
      );
      expect(preview.status).toBe('error');
      expect(preview.message).toContain('orders:update');
      expect(fetchSpy).not.toHaveBeenCalled();
    }));

  it('same real generic bridge still permits an endpoint inside both authorities', () =>
    asOwner(async () => {
      const entry = {
        path: 'store/products',
        method: 'POST',
        area: 'store',
        domain: 'products',
        controller: 'Products',
        handler: 'create',
        requiredPermissions: ['products:update'],
        summary: 'Crear producto',
      } as CatalogEntry;
      const catalog = {
        find: jest.fn().mockReturnValue(entry),
        methodsFor: jest.fn().mockReturnValue(['POST']),
      };
      const bridge = createApiBridgeTools({
        catalog: catalog as never,
        attachments: {} as never,
      }).find((tool) => tool.name === 'write_endpoint')!;
      const authority = await service.resolveAuthority(8, 'vexi');
      const preview = await service.runAuthorized(authority, () =>
        bridge.preview!(
          { path: 'store/products', method: 'POST', body: { name: 'QA' } },
          {},
        ),
      );
      expect(preview.status).toBe('ok');
    }));

  it('empty intersection never falls back to owner role and still allows safe nested policy resolution', () =>
    asOwner(async () => {
      objective.authority_snapshot = [];
      const authority = await service.resolveAuthority(8, 'vexi');
      await service.runAuthorized(authority, async () => {
        expect(
          RequestContextService.asyncLocalStorage.getStore()?.permissions,
        ).toEqual([]);
        expect(
          RequestContextService.asyncLocalStorage.getStore()?.roles,
        ).toEqual([]);
        await service.assertWritable(authority);
        await service.runAuthorized(authority, async () => {
          expect(
            RequestContextService.asyncLocalStorage.getStore()?.permissions,
          ).toEqual([]);
        });
      });
    }));

  it('does not leak the private owner/admin role proof into another principal', () =>
    asOwner(async () => {
      const authority = await service.resolveAuthority(8, 'vexi');
      await service.runAuthorized(authority, async () => {
        await RequestContextService.runIsolated(
          { ...owner, user_id: 9, roles: [] },
          async () => {
            await expect(service.resolveAuthority(8, 'vexi')).rejects.toThrow();
          },
        );
      });
    }));

  it('supports an authenticated admin without preserving its role as a permission fallback', () =>
    RequestContextService.runIsolated(
      { ...owner, is_owner: false, roles: ['admin'] },
      async () => {
        const authority = await service.resolveAuthority(8, 'vexi');
        await service.runAuthorized(authority, async () => {
          expect(
            RequestContextService.asyncLocalStorage.getStore()?.roles,
          ).toEqual([]);
          expect(
            (await service.resolveAuthority(8, 'vexi')).conversation_id,
          ).toBe(8);
        });
      },
    ));

  it('revoked current permission stays absent even if the snapshot once allowed it', () =>
    asOwner(async () => {
      const authority = await service.resolveAuthority(8, 'vexi');
      await RequestContextService.runIsolated(
        { ...owner, permissions: ['orders:update'] },
        async () => {
          await service.runAuthorized(authority, async () => {
            expect(
              RequestContextService.asyncLocalStorage.getStore()?.permissions,
            ).toEqual([]);
          });
        },
      );
    }));

  it.each(['unknown_effect', 'cancelled', 'completed_verified', 'expired'])(
    'rejects noncontinuable objective %s before callback',
    (status) =>
      asOwner(async () => {
        const authority = await service.resolveAuthority(8, 'vexi');
        objective.semantic_status = status;
        const callback = jest.fn();
        await expect(
          service.runAuthorized(authority, callback),
        ).rejects.toThrow();
        expect(callback).not.toHaveBeenCalled();
      }),
  );

  it('rejects objective replacement instead of adopting new authority', () =>
    asOwner(async () => {
      const authority = await service.resolveAuthority(8, 'vexi');
      objective.id = '22222222-2222-4222-8222-222222222222';
      const callback = jest.fn();
      await expect(
        service.runAuthorized(authority, callback),
      ).rejects.toThrow();
      expect(callback).not.toHaveBeenCalled();
    }));

  it('rejects plan/feature revocation and terminal store operations', () =>
    asOwner(async () => {
      const authority = await service.resolveAuthority(8, 'vexi');
      access.canUseAIFeature.mockResolvedValue({ allowed: false });
      await expect(
        service.runAuthorized(authority, jest.fn()),
      ).rejects.toThrow();
      access.canUseAIFeature.mockResolvedValue({ allowed: true });
      access.canUseModule.mockResolvedValue({ mode: 'block' });
      await expect(service.assertWritable(authority)).rejects.toThrow();
    }));

  it('does not read a process-global fallback without an authenticated ALS context', async () => {
    RequestContextService.run(owner, () => undefined);
    await expect(service.resolveAuthority(8, 'vexi')).rejects.toThrow();
    expect(prisma.ai_conversations.findFirst).not.toHaveBeenCalled();
  });
  it('first attachment uses the repository ensure rather than replacing a goal', () =>
    asOwner(async () => {
      const ensureForConversation = jest.fn(async () => {
        objective = {
          ...objective,
          id: '22222222-2222-4222-8222-222222222222',
        };
      });
      Object.assign(objectives, { ensureForConversation });
      objectives.getForConversation.mockResolvedValueOnce(null);
      const prepared = await service.prepareAuthority(
        8,
        'vexi',
        'Consulta de voz',
      );
      expect(ensureForConversation).toHaveBeenCalledWith(
        8,
        'vexi',
        'Consulta de voz',
      );
      expect(prepared.objective_id).toBe(objective.id);
    }));
  it('G successful reads reuse the paid successful-tool unit while proposals do not', () =>
    asOwner(async () => {
      const consumeAIQuota = jest.fn();
      Object.assign(access, { consumeAIQuota });
      const current = await service.resolveAuthority(8, 'vexi');

      await service.recordResult(
        { ...current, objective_id: null },
        'get_product',
        { id: 7 },
        '{"id":7}',
        'call-read',
      );
      expect(consumeAIQuota).toHaveBeenCalledWith(
        5,
        'tool_agents',
        1,
        expect.stringContaining(':tool:call-read'),
      );
      await service.recordResult(
        { ...current, objective_id: null },
        'change_product',
        { id: 7 },
        '{"requires_confirmation":true}',
        'call-proposal',
      );
      expect(consumeAIQuota).toHaveBeenCalledTimes(1);
    }));
});
