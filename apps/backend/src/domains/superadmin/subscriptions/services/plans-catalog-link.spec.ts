import { PlansService } from './plans.service';
import { VendixHttpException } from '../../../../common/errors';

/**
 * F6 — el plan enlaza contra el catálogo vivo; guardar con referencias rotas
 * es imposible (400 `SUBSCRIPTION_VALIDATION`, nunca 500 crudo).
 *
 * Cubre: agent_key inexistente (anidado y superior), tool desconocida,
 * categoría desconocida, payload malformado, y el paso feliz con refs vivas.
 */
describe('PlansService F6 catalog link (ai_feature_flags)', () => {
  let service: PlansService;
  let prisma: any;
  let registry: any;

  const KNOWN_TOOLS = new Set(['list_products', 'find_customer']);

  beforeEach(() => {
    const tx = {
      subscription_plans: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockImplementation(({ data }: any) => ({ id: 7, ...data })),
        create: jest.fn(),
        delete: jest.fn(),
      },
      store_subscriptions: { count: jest.fn().mockResolvedValue(0) },
    };
    prisma = {
      subscription_plans: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }: any) => ({ id: 1, ...data })),
        update: jest.fn(),
      },
      ai_agents: {
        findMany: jest.fn().mockImplementation(({ where }: any) => {
          const wanted: string[] = where?.key?.in ?? [];
          return Promise.resolve(
            wanted.filter((key) => key === 'vexi').map((key) => ({ key })),
          );
        }),
      },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    registry = {
      canonicalName: jest.fn((name: string) => name),
      get: jest.fn((name: string) =>
        KNOWN_TOOLS.has(name) ? { name } : undefined,
      ),
    };
    service = new PlansService(prisma, registry);
  });

  function createDto(flags: unknown) {
    return { code: 'f6', name: 'F6', base_price: 0, ai_feature_flags: flags } as any;
  }

  async function expect400(promise: Promise<unknown>, field: string) {
    await expect(promise).rejects.toMatchObject({
      errorCode: 'SUBSCRIPTION_VALIDATION',
    });
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(VendixHttpException);
      expect((error as VendixHttpException).getStatus()).toBe(400);
      const body = (error as VendixHttpException).getResponse() as any;
      expect(body.error_code).toBe('SUBSCRIPTION_VALIDATION');
      expect(body.details?.field).toContain(field);
      return;
    }
    throw new Error('expected rejection did not happen');
  }

  it('rechaza agent_key inexistente anidado en tool_agents con 400', async () => {
    await expect400(
      service.create(
        createDto({
          text_generation: { enabled: true },
          tool_agents: { enabled: true, agents_allowed: ['inexistente'] },
        }),
      ),
      'agents_allowed',
    );
    expect(prisma.subscription_plans.create).not.toHaveBeenCalled();
  });

  it('rechaza agents_allowed superior con agent inexistente', async () => {
    await expect400(
      service.create(
        createDto({
          text_generation: { enabled: true },
          agents_allowed: ['soporte-fantasma'],
        }),
      ),
      'agents_allowed',
    );
  });

  it('rechaza tool desconocida en tools_allowed con 400', async () => {
    await expect400(
      service.create(
        createDto({
          tool_agents: { enabled: true, tools_allowed: ['products.search'] },
        }),
      ),
      'tools_allowed',
    );
  });

  it('rechaza categoria desconocida con 400', async () => {
    await expect400(
      service.create(createDto({ text_generaton: { enabled: true } })),
      'ai_feature_flags',
    );
  });

  it('rechaza allowlist malformada (no arreglo) con 400', async () => {
    await expect400(
      service.create(
        createDto({ tool_agents: { enabled: true, tools_allowed: 'todo' } }),
      ),
      'tools_allowed',
    );
  });

  it('rechaza antes de abrir la transaccion multi-cycle', async () => {
    await expect400(
      service.create({
        code: 'f6',
        name: 'F6',
        base_price: 0,
        pricings: [
          { billing_cycle: 'monthly', price: 0, is_default: true },
          { billing_cycle: 'annual', price: 0, is_default: false },
        ],
        ai_feature_flags: {
          tool_agents: { enabled: true, agents_allowed: ['inexistente'] },
        },
      } as any),
      'agents_allowed',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('acepta refs vivas (agente vexi + tool del registry)', async () => {
    const result = await service.create(
      createDto({
        text_generation: { enabled: true, monthly_tokens_cap: 1000 },
        tool_agents: {
          enabled: true,
          tools_allowed: ['list_products'],
          agents_allowed: ['vexi'],
        },
      }),
    );
    expect((result as any).code).toBe('f6');
    expect(prisma.subscription_plans.create).toHaveBeenCalled();
  });

  it('no valida cuando el payload no trae flags', async () => {
    await service.create({ code: 'f6', name: 'F6', base_price: 0 } as any);
    expect(prisma.ai_agents.findMany).not.toHaveBeenCalled();
    expect(registry.get).not.toHaveBeenCalled();
  });

  it('update valida solo cuando dto trae flags', async () => {
    prisma.subscription_plans.findUnique.mockResolvedValue({ id: 7, code: 'f6' });

    await expect400(
      service.update(7, {
        ai_feature_flags: {
          tool_agents: { enabled: true, agents_allowed: ['inexistente'] },
        },
      } as any),
      'agents_allowed',
    );

    prisma.ai_agents.findMany.mockClear();
    await service.update(7, { name: 'otro nombre' } as any);
    expect(prisma.ai_agents.findMany).not.toHaveBeenCalled();
  });

  it('fail-closed: sin registry, tools declaradas se rechazan', async () => {
    const withoutRegistry = new PlansService(prisma);
    await expect400(
      withoutRegistry.create(
        createDto({ tool_agents: { enabled: true, tools_allowed: ['list_products'] } }),
      ),
      'tools_allowed',
    );
  });
});
