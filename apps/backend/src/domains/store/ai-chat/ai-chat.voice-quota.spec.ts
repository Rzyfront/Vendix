import { AIChatService } from './ai-chat.service';
import { ChatStreamReplay } from './chat-stream-replay';
import { RequestContextService } from '../../../common/context/request-context.service';
import { VendixHttpException } from '../../../common/errors';

/**
 * T14 — cupos por agente en el chat.
 *
 * - La voz de lectura se decide por agente: sin voz en el plan o con el cupo
 *   agotado la respuesta llega en texto con su aviso; cada segmento generado
 *   se mide en milisegundos con dedup por stream y segmento.
 * - Con los mensajes o tokens de Vex agotados, Vex lo dice al crear el turno
 *   (HTTP con mensaje claro), nunca al reconectar el stream.
 */
const context = {
  store_id: 1,
  organization_id: 2,
  user_id: 3,
  is_super_admin: false,
  is_owner: true,
  roles: ['owner'],
};

type Internals = {
  resolveTurnVoice(
    agentKey: string | null,
    streamId: string,
    streamStartedAt: number,
  ): Promise<{
    speak: boolean;
    agentKey: string | null;
    notice?: { type: string; code: string; message: string };
    meter?: (seconds: number, index: number) => void;
  }>;
  assertVexTurnQuota(agentKey: string | null): Promise<void>;
};

/**
 * `AIChatService & Internals` collapses to `never` because both methods are
 * private on the class; the mapped `Omit` keeps only the public surface.
 */
type TestableChatService = Omit<AIChatService, keyof Internals> & Internals;

function serviceWith(fields: Record<string, unknown>): TestableChatService {
  return Object.assign(
    Object.create(AIChatService.prototype) as AIChatService,
    { logger: { warn: jest.fn(), log: jest.fn(), error: jest.fn() } },
    fields,
  ) as unknown as TestableChatService;
}

async function collect(generator: AsyncGenerator<unknown>): Promise<unknown[]> {
  const result: unknown[] = [];
  for await (const frame of generator) result.push(frame);
  return result;
}

describe('AIChatService — voz por agente (T14)', () => {
  const quota = (status: string) => ({
    checkAgentVoice: jest
      .fn()
      .mockResolvedValue({ status, cap: 3600, used: 0 }),
    consumeAgentVoice: jest.fn().mockResolvedValue(undefined),
  });

  it('cupo de voz agotado: la respuesta va en texto con «Se acabó la lectura en voz de este mes»', async () => {
    const agentQuota = quota('exhausted');
    const service = serviceWith({ agentQuota });

    const gate = await RequestContextService.run(context, () =>
      service.resolveTurnVoice('vexi', 'stream-1', 1000),
    );

    expect(agentQuota.checkAgentVoice).toHaveBeenCalledWith(1, 'vexi');
    expect(gate).toEqual({
      speak: false,
      agentKey: 'vexi',
      notice: {
        type: 'voice_notice',
        code: 'voice_quota_exhausted',
        message: 'Se acabó la lectura en voz de este mes',
      },
    });
  });

  it('voz fuera del plan de ese agente: texto con el aviso del agente', async () => {
    const service = serviceWith({ agentQuota: quota('disabled') });

    const gate = await RequestContextService.run(context, () =>
      service.resolveTurnVoice('vex', 'stream-1', 1000),
    );

    expect(gate.speak).toBe(false);
    expect(gate.notice).toEqual({
      type: 'voice_notice',
      code: 'voice_not_in_plan',
      message: 'Tu plan no incluye la lectura en voz de Vex.',
    });
  });

  it('con voz: mide cada segmento generado en ms con dedup por stream y segmento', async () => {
    const agentQuota = quota('ok');
    const service = serviceWith({ agentQuota });

    const gate = await RequestContextService.run(context, () =>
      service.resolveTurnVoice('vex', 'stream-9', 1234),
    );
    expect(gate.speak).toBe(true);
    expect(gate.notice).toBeUndefined();

    gate.meter?.(2.6124, 3);
    expect(agentQuota.consumeAgentVoice).toHaveBeenCalledWith(
      1,
      'vex',
      2612,
      'stream-9:tts:1234:3',
    );
  });

  it('un fallo del medidor no rompe el turno', async () => {
    const agentQuota = quota('ok');
    agentQuota.consumeAgentVoice.mockRejectedValue(new Error('redis down'));
    const service = serviceWith({ agentQuota });

    const gate = await RequestContextService.run(context, () =>
      service.resolveTurnVoice('vexi', 'stream-1', 1),
    );

    expect(() => gate.meter?.(1, 0)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('decisión no disponible: habla como antes de T14, sin aviso falso', async () => {
    const service = serviceWith({ agentQuota: quota('unavailable') });

    const gate = await RequestContextService.run(context, () =>
      service.resolveTurnVoice('vexi', 'stream-1', 1),
    );

    expect(gate.speak).toBe(true);
    expect(gate.notice).toBeUndefined();
  });

  it('sin servicio de cupos o con un agente sin cupo propio: comportamiento previo', async () => {
    const withoutQuota = serviceWith({});
    const other = quota('disabled');
    const withOtherAgent = serviceWith({ agentQuota: other });

    await RequestContextService.run(context, async () => {
      await expect(
        withoutQuota.resolveTurnVoice('vexi', 's', 1),
      ).resolves.toEqual({ speak: true, agentKey: 'vexi' });
      await expect(
        withOtherAgent.resolveTurnVoice('support_bot', 's', 1),
      ).resolves.toEqual({ speak: true, agentKey: 'support_bot' });
    });
    expect(other.checkAgentVoice).not.toHaveBeenCalled();
  });
});

describe('AIChatService — cupos de Vex antes del turno (T14)', () => {
  const exceeded = (degradation: 'block' | 'warn') => ({
    exceeded: true,
    cap: 200,
    used: 200,
    degradation,
  });
  const free = { exceeded: false, cap: 200, used: 3, degradation: 'block' };

  it('mensajes del día agotados: lo dice con un mensaje claro y código de cuota', async () => {
    const checkExtraQuota = jest
      .fn()
      .mockImplementation(async (_s: number, _f: string, counter: string) =>
        counter === 'daily_messages' ? exceeded('block') : free,
      );
    const service = serviceWith({
      subscriptionAccess: { checkExtraQuota },
    });

    const error = await RequestContextService.run(context, () =>
      service.assertVexTurnQuota('vex').catch((e: unknown) => e),
    );

    expect(error).toBeInstanceOf(VendixHttpException);
    const exception = error as VendixHttpException;
    expect(exception.errorCode).toBe('SUBSCRIPTION_006');
    expect(exception.getResponse()).toMatchObject({
      message:
        'Vex ya usó todos los mensajes de hoy de tu plan. Mañana se renueva el cupo; si lo necesitas antes, puedes mejorar el plan.',
      details: { feature: 'vex_agent', counter: 'daily_messages' },
    });
  });

  it('tokens del mes agotados: mensaje propio', async () => {
    const checkExtraQuota = jest
      .fn()
      .mockImplementation(async (_s: number, _f: string, counter: string) =>
        counter === 'monthly_tokens' ? exceeded('block') : free,
      );
    const service = serviceWith({ subscriptionAccess: { checkExtraQuota } });

    const error = (await RequestContextService.run(context, () =>
      service.assertVexTurnQuota('vex').catch((e: unknown) => e),
    )) as VendixHttpException;

    expect(error.errorCode).toBe('SUBSCRIPTION_006');
    expect(error.getResponse()).toMatchObject({
      message: expect.stringContaining('cupo de uso del modelo de este mes'),
      details: { counter: 'monthly_tokens' },
    });
  });

  it('degradación warn no corta; Vexi no pasa por este cupo', async () => {
    const checkExtraQuota = jest.fn().mockResolvedValue(exceeded('warn'));
    const service = serviceWith({ subscriptionAccess: { checkExtraQuota } });

    await RequestContextService.run(context, async () => {
      await expect(service.assertVexTurnQuota('vex')).resolves.toBeUndefined();
      checkExtraQuota.mockClear();
      await expect(
        service.assertVexTurnQuota('vexi'),
      ).resolves.toBeUndefined();
    });
    expect(checkExtraQuota).not.toHaveBeenCalled();
  });

  it('el prechequeo corre al crear el turno y no deja crear el intent', async () => {
    const create = jest.fn().mockResolvedValue('stream-1');
    const assertVexTurnQuota = jest
      .fn()
      .mockRejectedValue(new Error('cupo agotado'));
    const service = serviceWith({
      getConversation: jest
        .fn()
        .mockResolvedValue({ id: 7, metadata: { agent_key: 'vex' }, status: 'active' }),
      assertVexTurnAccess: jest.fn().mockResolvedValue(undefined),
      assertVexTurnQuota,
      streamIntents: { create },
    });

    await expect(
      RequestContextService.run(context, () =>
        service.createStreamIntent(7, { content: 'hola' } as never),
      ),
    ).rejects.toThrow('cupo agotado');
    expect(assertVexTurnQuota).toHaveBeenCalledWith('vex');
    expect(create).not.toHaveBeenCalled();
  });

  it('reconectar el stream no vuelve a chequear el cupo (el turno que gastó el último mensaje sigue vivo)', async () => {
    const assertVexTurnQuota = jest.fn();
    const service = serviceWith({
      streamReplay: new ChatStreamReplay(),
      executeMessageStream: jest.fn(async function* () {
        yield { type: 'done' };
      }),
      getConversation: jest
        .fn()
        .mockResolvedValue({ id: 7, metadata: { agent_key: 'vex' }, status: 'active' }),
      assertVexTurnAccess: jest.fn().mockResolvedValue(undefined),
      assertVexTurnQuota,
    });

    await RequestContextService.run(context, async () => {
      await collect(service.sendMessageStream(7, 'opaque'));
      await collect(
        service.sendMessageStream(7, 'opaque', undefined, {
          after_sequence: 1,
        }),
      );
    });
    expect(assertVexTurnQuota).not.toHaveBeenCalled();
  });
});
