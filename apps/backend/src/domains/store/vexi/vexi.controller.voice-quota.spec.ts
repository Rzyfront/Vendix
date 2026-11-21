import { VexiController } from './vexi.controller';
import { RequestContextService } from '../../../common/context/request-context.service';

/**
 * T14 — el acuse hablado de un cambio aplicado usa la voz y el cupo del agente
 * dueño del hilo. Sin voz en el plan o con el cupo agotado el cambio se aplica
 * igual y el acuse llega en texto con su aviso; el audio generado se mide.
 */
describe('VexiController — acuse de voz por agente (T14)', () => {
  const context = {
    store_id: 1,
    organization_id: 2,
    user_id: 3,
    is_super_admin: false,
    is_owner: true,
    roles: ['owner'],
  };

  function fixture(
    voiceStatus: string,
    metadata: Record<string, unknown> | null = { agent_key: 'vex' },
  ) {
    const planState: any = {
      applyDurableEffect: jest.fn(async () => ({
        output: JSON.stringify({ summary: 'Subí el precio de la Coca a $3.500' }),
        result: { status: 'ok', effect_status: 'applied' },
      })),
      markCurrentChangeStep: jest.fn(),
    };
    const activity: any = {
      recordApplied: jest.fn(),
      recordAppliedNarration: jest.fn(),
    };
    const speech: any = {
      resolveParams: jest.fn(async () => ({ voice: 'v', speed: 1, vol: 1 })),
      resolveCurrency: jest.fn(async () => 'COP'),
      synthesize: jest.fn(async () => ({
        audioBase64: 'AAAA',
        contentType: 'audio/mpeg',
        generated: true,
        seconds: 2.4,
      })),
    };
    const agentQuota: any = {
      checkAgentVoice: jest.fn(async () => ({
        status: voiceStatus,
        cap: 60,
        used: 0,
      })),
      consumeAgentVoice: jest.fn(async () => undefined),
    };
    const prisma: any = {
      ai_conversations: {
        findFirst: jest.fn(async () => ({ metadata, app_key: 'chat_assistant' })),
      },
    };
    const controller = new VexiController(
      {} as any,
      { success: (data: unknown) => data } as any,
      { executeTool: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      activity,
      {} as any,
      speech,
      planState,
      undefined,
      agentQuota,
      prisma,
    );
    return { controller, speech, agentQuota, prisma };
  }

  const apply = (controller: VexiController) =>
    RequestContextService.run(context, () =>
      controller.applyConfirmation({
        tool: 'update_product_price',
        arguments: {},
        confirmation_token: 'token',
        conversation_id: 7,
        speak: true,
      } as never),
    ) as Promise<any>;

  it('cupo agotado: el cambio se aplica y el acuse llega en texto con el aviso', async () => {
    const { controller, speech, agentQuota } = fixture('exhausted');

    const output = await apply(controller);

    expect(agentQuota.checkAgentVoice).toHaveBeenCalledWith(1, 'vex');
    expect(output.summary).toBe('Subí el precio de la Coca a $3.500');
    expect(output.audio_base64).toBeUndefined();
    expect(output.voice_notice).toEqual({
      code: 'voice_quota_exhausted',
      message: 'Se acabó la lectura en voz de este mes',
    });
    expect(speech.synthesize).not.toHaveBeenCalled();
  });

  it('voz fuera del plan del agente: aviso propio de ese agente', async () => {
    const { controller } = fixture('disabled', null);

    const output = await apply(controller);

    expect(output.voice_notice).toEqual({
      code: 'voice_not_in_plan',
      message: 'Tu plan no incluye la lectura en voz de Vexi.',
    });
  });

  it('con voz: habla con la voz del agente y mide los segundos generados en ms', async () => {
    const { controller, speech, agentQuota } = fixture('ok');

    const output = await apply(controller);

    expect(speech.resolveParams).toHaveBeenCalledWith('vex');
    expect(output.audio_base64).toBe('AAAA');
    expect(output.voice_notice).toBeUndefined();
    expect(agentQuota.consumeAgentVoice).toHaveBeenCalledWith(
      1,
      'vex',
      2400,
      expect.stringMatching(/:ack-tts$/),
    );
  });

  it('un acierto de caché no consume cupo', async () => {
    const { controller, speech, agentQuota } = fixture('ok');
    speech.synthesize.mockResolvedValue({
      audioBase64: 'AAAA',
      contentType: 'audio/mpeg',
      generated: false,
      seconds: 0,
    });

    await apply(controller);

    expect(agentQuota.consumeAgentVoice).not.toHaveBeenCalled();
  });

  it('decisión no disponible: el acuse habla como antes de T14', async () => {
    const { controller } = fixture('unavailable');

    const output = await apply(controller);

    expect(output.audio_base64).toBe('AAAA');
    expect(output.voice_notice).toBeUndefined();
  });
});
