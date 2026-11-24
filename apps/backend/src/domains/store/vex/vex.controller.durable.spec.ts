import { GUARDS_METADATA } from '@nestjs/common/constants';
import { VexController } from './vex.controller';
import { RequestContextService } from '../../../common/context/request-context.service';
import {
  VOICE_QUOTA_EXHAUSTED_MESSAGE,
  voiceNotInPlanMessage,
} from '../subscriptions/services/agent-quota.service';

function fixture() {
  const controller: any = Object.create(VexController.prototype);
  controller.responseService = { success: (value: unknown) => value };
  controller.planState = {
    getObjectiveProgress: jest.fn(async () => ({ id: 'objective' })),
    rejectObjectiveProposal: jest.fn(async () => ({ id: 'objective' })),
    resumeObjective: jest.fn(async () => ({
      id: 'objective',
      requires_revalidation: true,
    })),
    listObjectiveResults: jest.fn(async () => ({ items: [] })),
    getObjectiveArtifact: jest.fn(async () => ({ id: 'result' })),
    applyDurableEffect: jest.fn(async () => ({
      output: '{}',
      result: {
        status: 'unknown_effect',
        effect_status: 'unknown',
        next_action: 'Reconciliar.',
      },
    })),
    markCurrentChangeStep: jest.fn(),
  };
  controller.planApproval = {
    resolveStepForApply: jest.fn(async () => ({
      tool: 'create_customer',
      arguments: { name: 'Juan' },
    })),
    redeemPlanStep: jest.fn(async () => 'ok'),
  };
  controller.confirmations = { issue: jest.fn(async () => 'single-use') };
  controller.toolRegistry = { executeTool: jest.fn() };
  controller.activity = {
    recordApplied: jest.fn(),
    recordAppliedNarration: jest.fn(),
  };
  controller.consumeVexQuota = jest.fn();
  controller.persistStepResult = jest.fn();
  return controller;
}

describe('Vex durable objective aliases', () => {
  it('uses the Vex switch instead of depending on Vexi being enabled', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, VexController).map(
      (guard: { name: string }) => guard.name,
    );
    expect(guards).toContain('VexEnabledGuard');
    expect(guards).not.toContain('VexiEnabledGuard');
  });

  it('delegates owned progress/resume/artifacts to the same scoped service, without inference', async () => {
    const c = fixture();
    expect(await c.getObjective('objective')).toEqual({ id: 'objective' });
    await c.resumeObjective('objective', {
      expected_version: 9,
      confirm_expired: true,
    });
    expect(c.planState.resumeObjective).toHaveBeenCalledWith('objective', {
      expected_version: 9,
      allow_expired: true,
    });
    await c.getObjectiveResult('objective', 'result', { offset: 10, limit: 5 });
    expect(c.planState.getObjectiveArtifact).toHaveBeenCalledWith(
      'objective',
      'result',
      { offset: 10, limit: 5 },
    );
    expect(c.toolRegistry.executeTool).not.toHaveBeenCalled();
  });

  it('does not narrate, close steps or consume successful quota for an uncertain effect', async () => {
    const c = fixture();
    const output = await c.applyPlanStep({
      conversation_id: 1,
      plan_id: 'plan',
      step_id: 's1',
      plan_token: 'approved-token',
    });
    expect(output.execution.status).toBe('unknown_effect');
    expect(c.activity.recordApplied).not.toHaveBeenCalled();
    expect(c.planState.markCurrentChangeStep).not.toHaveBeenCalled();
    expect(c.consumeVexQuota).not.toHaveBeenCalled();
    expect(output.step_status).toBe('unknown');
    expect(output.plan_status).toBe('unknown_effect');
    // Model guidance never reaches the card nor the plan step.
    expect(output.summary).not.toContain('Reconciliar');
    expect(output.execution).not.toHaveProperty('next_action');
    expect(c.persistStepResult.mock.calls[0][0].error).not.toContain(
      'Reconciliar',
    );
    expect(c.persistStepResult).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'unknown',
        stepId: 's1',
      }),
    );
    expect(c.planState.applyDurableEffect.mock.calls[0][0]).not.toHaveProperty(
      'confirmation_token',
    );
  });

  it('synthesizes message audio on demand via VexiSpeechService without depending on VexiEnabledGuard', async () => {
    const c = fixture();
    const segments = [
      { type: 'audio', index: 0, audio_base64: 'AAA', content_type: 'audio/mp3' },
      { type: 'audio', index: 1, audio_base64: 'BBB', content_type: 'audio/mp3' },
    ];
    c.speech = { synthesizeText: jest.fn(async () => segments) };

    const result = await c.synthesizeSpeech({ text: 'Hola. Todo bien.' });

    expect(c.speech.synthesizeText).toHaveBeenCalledWith(
      'Hola. Todo bien.',
      expect.objectContaining({ agentKey: 'vex' }),
    );
    expect(result).toEqual({ segments });
  });

  describe('synthesizeSpeech voice plan and quota', () => {
    afterEach(() => jest.restoreAllMocks());

    function speechFixture(status: string) {
      const c = fixture();
      jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({ store_id: 7 } as any);
      jest.spyOn(RequestContextService, 'getRequestId').mockReturnValue('req-1');
      c.logger = { warn: jest.fn() };
      c.agentQuota = {
        checkAgentVoice: jest.fn(async () => ({ status })),
        consumeAgentVoice: jest.fn(async () => undefined),
      };
      c.speech = {
        synthesizeText: jest.fn(async (_text: string, options: any) => {
          options.meter(1.25, 0);
          return [];
        }),
      };
      return c;
    }

    it('refuses with voice_quota_exhausted when the monthly quota ran out', async () => {
      const c = speechFixture('exhausted');
      await expect(c.synthesizeSpeech({ text: 'Hola.' })).rejects.toMatchObject({
        errorCode: 'voice_quota_exhausted',
        response: expect.objectContaining({
          message: VOICE_QUOTA_EXHAUSTED_MESSAGE,
        }),
      });
      expect(c.agentQuota.checkAgentVoice).toHaveBeenCalledWith(7, 'vex');
      expect(c.speech.synthesizeText).not.toHaveBeenCalled();
    });

    it('refuses with voice_not_in_plan when the plan lacks Vex voice', async () => {
      const c = speechFixture('disabled');
      await expect(c.synthesizeSpeech({ text: 'Hola.' })).rejects.toMatchObject({
        errorCode: 'voice_not_in_plan',
        response: expect.objectContaining({
          message: voiceNotInPlanMessage('vex'),
        }),
      });
      expect(c.speech.synthesizeText).not.toHaveBeenCalled();
    });

    it('speaks with the Vex voice and meters generated seconds', async () => {
      const c = speechFixture('ok');
      await c.synthesizeSpeech({ text: 'Hola.' });
      expect(c.speech.synthesizeText).toHaveBeenCalledWith(
        'Hola.',
        expect.objectContaining({ agentKey: 'vex', meter: expect.any(Function) }),
      );
      expect(c.agentQuota.consumeAgentVoice).toHaveBeenCalledWith(
        7,
        'vex',
        1250,
        expect.stringMatching(/^speech-[0-9a-f-]{36}:speech-tts:0$/),
      );
    });

    it('dedupes per call, not per caller-supplied request id', async () => {
      const c = speechFixture('ok');
      const ids: string[] = [];
      c.agentQuota.consumeAgentVoice.mockImplementation(
        async (_s: number, _a: string, _ms: number, id: string) => {
          ids.push(id);
        },
      );
      await c.synthesizeSpeech({ text: 'Hola.' });
      await c.synthesizeSpeech({ text: 'Adiós.' });
      expect(ids).toHaveLength(2);
      expect(ids[0]).not.toBe(ids[1]);
    });

    it('fails open when the quota decision is unavailable', async () => {
      const c = speechFixture('ok');
      c.agentQuota.checkAgentVoice.mockRejectedValue(new Error('redis down'));
      await expect(c.synthesizeSpeech({ text: 'Hola.' })).resolves.toEqual({
        segments: [],
      });
    });
  });
});
