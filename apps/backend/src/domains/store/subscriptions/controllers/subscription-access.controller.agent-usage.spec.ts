import { SubscriptionAccessController } from './subscription-access.controller';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * T14 (N7) — `GET store/subscriptions/usage` agrega el consumo por agente
 * (mensajes, tokens y lectura en voz) sin cambiar lo que ya devolvía.
 */
describe('SubscriptionAccessController.getUsage — agent_usage (T14)', () => {
  const usage = {
    vex: {
      enabled: true,
      meters: [
        {
          capability_key: 'vex.voice_readout',
          kind: 'voice_seconds',
          label: 'Lectura en voz',
          unit: 'seconds',
          period: 'monthly',
          used: 61,
          cap: 3600,
          enabled: true,
        },
      ],
    },
    vexi: { enabled: true, meters: [] },
  };

  function fixture(agentQuota?: { getAgentUsage: jest.Mock }) {
    const resolver = {
      resolveSubscription: jest.fn().mockResolvedValue({
        found: true,
        features: { streaming_chat: { enabled: true, daily_messages_cap: 300 } },
      }),
    };
    const access = {
      getAIConsumptionByGroup: jest.fn().mockResolvedValue(null),
      getQuotaUsed: jest.fn().mockResolvedValue(7),
    };
    const controller = new SubscriptionAccessController(
      resolver as never,
      access as never,
      { success: (data: unknown) => data } as never,
      agentQuota as never,
    );
    return controller;
  }

  const run = (controller: SubscriptionAccessController) => {
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(42);
    return controller.getUsage() as Promise<any>;
  };

  afterEach(() => jest.restoreAllMocks());

  it('agrega agent_usage con la salida del servicio de cupos por agente', async () => {
    const getAgentUsage = jest.fn().mockResolvedValue(usage);

    const body = await run(fixture({ getAgentUsage }));

    expect(getAgentUsage).toHaveBeenCalledWith(42);
    expect(body.agent_usage).toEqual(usage);
    expect(body.features.streaming_chat).toEqual(
      expect.objectContaining({ used: 7, cap: 300 }),
    );
  });

  it('un fallo del consumo por agente no rompe el endpoint ni lo que ya devolvía', async () => {
    const body = await run(
      fixture({ getAgentUsage: jest.fn().mockRejectedValue(new Error('x')) }),
    );

    expect(body).not.toHaveProperty('agent_usage');
    expect(body.features.streaming_chat.used).toBe(7);
  });

  it('sin el servicio la respuesta queda como antes', async () => {
    const body = await run(fixture());

    expect(body).not.toHaveProperty('agent_usage');
    expect(Object.keys(body).sort()).toEqual(
      ['consumption', 'features', 'period_start'].sort(),
    );
  });
});
