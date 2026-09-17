import { SubscriptionAccessService } from './subscription-access.service';
import { SubscriptionResolverService } from './subscription-resolver.service';

/**
 * F7 — uso tenant + sugerencia de upgrade.
 *
 * - `getAIUsageSnapshot` lee los mismos contadores Redis `ai:quota:*` que el
 *   gate consulta y los empareja con los caps resueltos del plan.
 * - `suggestUpgradeForFeature` devuelve plan actual + siguiente plan que
 *   cubre la feature, solo desde catálogo vendible y sin lanzar por datos
 *   ausentes.
 */
describe('SubscriptionAccessService — F7 usage + upgrade suggestion', () => {
  let service: SubscriptionAccessService;
  let resolverMock: jest.Mocked<
    Pick<SubscriptionResolverService, 'resolveSubscription' | 'invalidate'>
  >;
  let redisMock: any;
  let prismaMock: any;

  function utcPeriod(period: 'daily' | 'monthly'): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    if (period === 'monthly') return `${y}${m}`;
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  beforeEach(() => {
    resolverMock = {
      resolveSubscription: jest.fn(),
      invalidate: jest.fn().mockResolvedValue(undefined),
    };
    redisMock = {
      get: jest.fn().mockResolvedValue(null),
      eval: jest.fn().mockResolvedValue(1),
    };
    prismaMock = {
      subscription_plans: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    service = new SubscriptionAccessService(
      resolverMock as any,
      redisMock,
      prismaMock as any,
    );
  });

  function resolvedActive(overrides: Partial<any> = {}) {
    return {
      found: true,
      storeId: 7,
      state: 'active',
      planId: 1,
      planCode: 'starter',
      paidPlanId: 1,
      pendingPlanId: null,
      partnerOrgId: null,
      overlayActive: false,
      overlayExpiresAt: null,
      features: {
        text_generation: {
          enabled: true,
          monthly_tokens_cap: 10000,
          degradation: 'warn',
        },
        streaming_chat: {
          enabled: true,
          daily_messages_cap: 50,
          degradation: 'warn',
        },
        tool_agents: {
          enabled: true,
          monthly_tool_calls_cap: 100,
          tools_allowed: ['search_products'],
        },
      },
      gracePeriodSoftDays: 5,
      gracePeriodHardDays: 10,
      currentPeriodEnd: null,
      ...overrides,
    };
  }

  describe('getAIUsageSnapshot', () => {
    it('lee el contador Redis con la llave del gate y el cap resuelto', async () => {
      resolverMock.resolveSubscription.mockResolvedValue(
        resolvedActive() as any,
      );
      redisMock.get.mockImplementation(async (key: string) => {
        if (key === `ai:quota:7:streaming_chat:${utcPeriod('daily')}`)
          return '12';
        if (key === `ai:quota:7:text_generation:${utcPeriod('monthly')}`)
          return '500';
        return null;
      });

      const snap = await service.getAIUsageSnapshot(7);

      expect(snap.streaming_chat).toEqual({
        used: 12,
        cap: 50,
        period: 'daily',
      });
      expect(snap.text_generation).toEqual({
        used: 500,
        cap: 10000,
        period: 'monthly',
      });
      expect(snap.tool_agents).toEqual({
        used: 0,
        cap: 100,
        period: 'monthly',
      });
    });

    it('cap ausente o <= 0 se reporta como null (ilimitado)', async () => {
      resolverMock.resolveSubscription.mockResolvedValue(
        resolvedActive({
          features: {
            streaming_chat: { enabled: true, degradation: 'warn' },
          },
        }) as any,
      );

      const snap = await service.getAIUsageSnapshot(7);

      expect(snap.streaming_chat).toEqual({
        used: 0,
        cap: null,
        period: 'daily',
      });
    });

    it('omite features sin cuota numerica y sin config resuelta', async () => {
      resolverMock.resolveSubscription.mockResolvedValue(
        resolvedActive({
          features: {
            conversations: { enabled: true, retention_days: 90 },
          },
        }) as any,
      );

      const snap = await service.getAIUsageSnapshot(7);

      // conversations no tiene entrada en FEATURE_QUOTA_CONFIG.
      expect(snap.conversations).toBeUndefined();
      expect(snap).toEqual({});
    });

    it('sin suscripcion resuelta retorna snapshot vacio', async () => {
      resolverMock.resolveSubscription.mockResolvedValue({
        found: false,
      } as any);

      await expect(service.getAIUsageSnapshot(7)).resolves.toEqual({});
    });

    it('storeId invalido lanza', async () => {
      await expect(service.getAIUsageSnapshot(0)).rejects.toThrow();
    });
  });

  describe('suggestUpgradeForFeature', () => {
    const catalog = [
      {
        id: 1,
        code: 'starter',
        name: 'Starter',
        base_price: { toNumber: () => 49000 },
        ai_feature_flags: {
          streaming_chat: { enabled: true, daily_messages_cap: 50 },
          text_generation: { enabled: false },
        },
      },
      {
        id: 2,
        code: 'pro',
        name: 'Pro',
        base_price: { toNumber: () => 99000 },
        ai_feature_flags: {
          streaming_chat: { enabled: true, daily_messages_cap: 500 },
          text_generation: { enabled: true, monthly_tokens_cap: 200000 },
        },
      },
      {
        id: 3,
        code: 'promo-x',
        name: 'Promo',
        base_price: { toNumber: () => 1000 },
        ai_feature_flags: {
          streaming_chat: { enabled: true, daily_messages_cap: 9999 },
        },
      },
    ];

    beforeEach(() => {
      // El servicio filtra vendibles; el mock devuelve la lista y el
      // servicio ordena/selecciona. Promo queda fuera en datos reales por
      // is_promotional; aquí se incluye para probar que el precio manda.
      prismaMock.subscription_plans.findMany.mockResolvedValue(catalog);
    });

    it('005: feature deshabilitada sugiere el plan mas barato por encima que la habilita', async () => {
      resolverMock.resolveSubscription.mockResolvedValue(
        resolvedActive({
          planId: 1,
          paidPlanId: 1,
          features: {
            text_generation: { enabled: false },
            streaming_chat: {
              enabled: true,
              daily_messages_cap: 50,
              degradation: 'warn',
            },
          },
        }) as any,
      );

      const sug = await service.suggestUpgradeForFeature(
        7,
        'text_generation',
      );

      expect(sug.feature).toBe('text_generation');
      expect(sug.currentPlan).toMatchObject({ id: 1, code: 'starter' });
      expect(sug.suggestedPlan).toMatchObject({
        id: 2,
        code: 'pro',
        cta: '/admin/subscription/picker',
      });
    });

    it('006: cuota agotada exige cap mayor o ilimitado', async () => {
      resolverMock.resolveSubscription.mockResolvedValue(
        resolvedActive() as any,
      );

      const sug = await service.suggestUpgradeForFeature(
        7,
        'streaming_chat',
      );

      // Promo (id 3) cubre pero es más barato que el actual: no es upgrade.
      expect(sug.suggestedPlan).toMatchObject({ id: 2, code: 'pro' });
    });

    it('sin candidato por encima retorna suggestedPlan null', async () => {
      prismaMock.subscription_plans.findMany.mockResolvedValue([catalog[0]]);
      resolverMock.resolveSubscription.mockResolvedValue(
        resolvedActive() as any,
      );

      const sug = await service.suggestUpgradeForFeature(
        7,
        'streaming_chat',
      );

      expect(sug.currentPlan).toMatchObject({ id: 1 });
      expect(sug.suggestedPlan).toBeNull();
    });

    it('sin suscripcion o store invalido retorna planes en null sin lanzar', async () => {
      resolverMock.resolveSubscription.mockResolvedValue({
        found: false,
      } as any);

      await expect(
        service.suggestUpgradeForFeature(7, 'streaming_chat'),
      ).resolves.toEqual({
        feature: 'streaming_chat',
        currentPlan: null,
        suggestedPlan: null,
      });
      await expect(
        service.suggestUpgradeForFeature(-1, 'streaming_chat'),
      ).resolves.toEqual({
        feature: 'streaming_chat',
        currentPlan: null,
        suggestedPlan: null,
      });
    });

    it('reporta includes del plan actual con keys habilitadas', async () => {
      resolverMock.resolveSubscription.mockResolvedValue(
        resolvedActive() as any,
      );

      const sug = await service.suggestUpgradeForFeature(
        7,
        'streaming_chat',
      );

      expect(sug.currentPlan?.includes).toContain('streaming_chat');
      expect(sug.currentPlan?.includes).not.toContain('text_generation');
    });
  });
});
