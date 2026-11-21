import { AgentQuotaService } from '../domains/store/subscriptions/services/agent-quota.service';
import { AgentRuntimeConfigService } from './agent-runtime-config.service';

describe('AgentRuntimeConfigService.getAgentStatuses', () => {
  const row = (
    agent_key: string,
    enabled: boolean,
    on_limit: 'block' | 'warn' = 'block',
  ) => ({
    agent_key,
    capability_key: 'agent',
    enabled,
    cap_value: null,
    on_limit,
  });
  let resolve: jest.Mock;
  let findSettings: jest.Mock;
  let service: AgentRuntimeConfigService;

  beforeEach(() => {
    resolve = jest.fn();
    findSettings = jest.fn();
    service = new AgentRuntimeConfigService(
      { store_settings: { findUnique: findSettings } } as any,
      {} as any,
      {} as any,
      { resolveEffectiveEntitlements: resolve } as any,
    );
  });

  const setup = (
    found: boolean,
    hasPlan: boolean,
    rows: any[],
    settings: any,
    state: string = 'active',
  ) => {
    resolve.mockResolvedValue({ found, hasPlan, rows, state });
    findSettings.mockResolvedValue({ settings });
  };

  it('on when plan includes and store enabled', async () => {
    setup(true, true, [row('vex', true), row('vexi', true)], {
      vex: { enabled: true },
      vexi: { enabled: true },
    });
    const [vex, vexi] = await service.getAgentStatuses(5);
    expect(vex).toEqual({
      agent_key: 'vex',
      label: 'Vex',
      state: 'on',
      plan_includes: true,
      store_enabled: true,
      reason: null,
    });
    expect(vexi.state).toBe('on');
  });

  it('off_by_plan with the exact text', async () => {
    setup(true, true, [row('vex', false), row('vexi', true)], {
      vex: { enabled: true },
    });
    const [vex, vexi] = await service.getAgentStatuses(5);
    expect(vex.state).toBe('off_by_plan');
    expect(vex.reason).toBe('El plan de la tienda no incluye Vex.');
    expect(vexi.state).toBe('off_by_store');
    expect(vexi.reason).toBe(
      'La tienda apagó Vexi en Ajustes → Agentes IA.',
    );
  });

  it('plan precedence over store switch', async () => {
    setup(true, true, [row('vex', false), row('vexi', false)], {
      vex: { enabled: false },
    });
    const [vex] = await service.getAgentStatuses(5);
    expect(vex.state).toBe('off_by_plan');
  });

  it('no_subscription beats everything', async () => {
    setup(false, false, [row('vex', true)], { vex: { enabled: true } });
    const [vex, vexi] = await service.getAgentStatuses(5);
    expect(vex.state).toBe('no_subscription');
    expect(vexi.reason).toBe('La tienda no tiene una suscripción activa.');
    setup(true, false, [row('vex', true)], { vex: { enabled: true } });
    expect((await service.getAgentStatuses(5))[0].state).toBe(
      'no_subscription',
    );
  });

  const bothOn = { vex: { enabled: true }, vexi: { enabled: true } };

  it('a suspended or blocked subscription is not «on»: the gate blocks it first', async () => {
    setup(true, true, [row('vex', true), row('vexi', true)], bothOn, 'suspended');
    const [vex, vexi] = await service.getAgentStatuses(5);
    expect(vex.state).toBe('subscription_blocked');
    expect(vex.reason).toBe(
      'La suscripción de la tienda está suspendida; Vex no responde hasta que vuelva a estar activa.',
    );
    expect(vexi.state).toBe('subscription_blocked');

    setup(true, true, [row('vex', true), row('vexi', true)], bothOn, 'blocked');
    expect((await service.getAgentStatuses(5))[0].reason).toBe(
      'La suscripción de la tienda está bloqueada; Vex no responde hasta que vuelva a estar activa.',
    );
  });

  it('the subscription block wins over the plan and the store switch, like the gate', async () => {
    setup(true, true, [row('vex', false), row('vexi', true)], {}, 'cancelled');
    const [vex, vexi] = await service.getAgentStatuses(5);
    expect(vex.state).toBe('subscription_blocked');
    expect(vexi.state).toBe('subscription_blocked');
    expect(vex.plan_includes).toBe(false);
  });

  it('grace_hard blocks only the agent whose plan degrades to block', async () => {
    setup(
      true,
      true,
      [row('vex', true, 'block'), row('vexi', true, 'warn')],
      bothOn,
      'grace_hard',
    );
    const [vex, vexi] = await service.getAgentStatuses(5);
    expect(vex.state).toBe('subscription_blocked');
    expect(vexi.state).toBe('on');
  });

  it('states the gate lets through keep the agent on', async () => {
    for (const state of ['active', 'trial', 'grace_soft', 'pending_payment']) {
      setup(true, true, [row('vex', true), row('vexi', true)], bothOn, state);
      expect((await service.getAgentStatuses(5))[0].state).toBe('on');
    }
  });

  it('a draft or plan-less subscription reads as no active subscription', async () => {
    for (const state of ['draft', 'no_plan']) {
      setup(true, true, [row('vex', true)], bothOn, state);
      expect((await service.getAgentStatuses(5))[0].state).toBe('no_subscription');
    }
  });

  it('store without settings row is off_by_store', async () => {
    resolve.mockResolvedValue({
      found: true,
      hasPlan: true,
      rows: [row('vex', true), row('vexi', true)],
    });
    findSettings.mockResolvedValue(null);
    const [vex] = await service.getAgentStatuses(5);
    expect(vex.state).toBe('off_by_store');
  });

  it('queries each store by its own id', async () => {
    setup(true, true, [row('vex', true)], {});
    await service.getAgentStatuses(5);
    await service.getAgentStatuses(9);
    expect(resolve).toHaveBeenNthCalledWith(1, 5);
    expect(resolve).toHaveBeenNthCalledWith(2, 9);
    expect(findSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { store_id: 9 } }),
    );
  });

  it('shadow: the reason follows the legacy JSON the gate decides with, not the table', async () => {
    // Real quota service in shadow mode: legacy JSON turns Vex on while the new
    // table still says off. The gate lets Vex through, so the status must not
    // say "the plan does not include Vex".
    const previous = process.env.AI_ENTITLEMENTS_MODE;
    delete process.env.AI_ENTITLEMENTS_MODE;
    try {
      const quota = new AgentQuotaService(
        {
          resolveSubscription: jest.fn().mockResolvedValue({
            found: true,
            features: { vex_agent: { enabled: true } },
          }),
        } as any,
        {} as any,
        {
          resolveForStore: jest.fn().mockResolvedValue({
            found: true,
            planId: 1,
            rows: [row('vex', false), row('vexi', false)],
          }),
        } as any,
      );
      const real = new AgentRuntimeConfigService(
        { store_settings: { findUnique: findSettings } } as any,
        {} as any,
        {} as any,
        quota,
      );
      findSettings.mockResolvedValue({ settings: { vex: { enabled: true } } });

      const [vex, vexi] = await real.getAgentStatuses(5);

      expect(vex.state).toBe('on');
      expect(vex.plan_includes).toBe(true);
      expect(vexi.state).toBe('off_by_plan');
    } finally {
      if (previous === undefined) delete process.env.AI_ENTITLEMENTS_MODE;
      else process.env.AI_ENTITLEMENTS_MODE = previous;
    }
  });
});
