/** Offline G seam: REAL registry, Lua-command model, consent, host and D1 apply. */
import { RequestContextService } from '../../src/common/context/request-context.service';
import { AIToolRegistry } from '../../src/ai-engine/tools/ai-tool-registry';
import { AgentObjectiveRepository } from '../../src/ai-engine/tasks/agent-objective.repository';
import { ObjectiveMemoryDatabase } from '../../src/ai-engine/tasks/testing/objective-memory-db';
import { VexiConfirmationService } from '../../src/domains/store/vexi/vexi-confirmation.service';
import { VexiVoiceConsentService } from '../../src/domains/store/vexi/vexi-voice-consent.service';
import { VexiVoiceConfirmationService } from '../../src/domains/store/vexi/vexi-voice-confirmation.service';
import { VexiVoiceService } from '../../src/domains/store/vexi/vexi-voice.service';
import { VexiController } from '../../src/domains/store/vexi/vexi.controller';
import { VexiPlanStateService } from '../../src/domains/store/vexi/vexi-plan-state.service';
import { MemoryRedis } from '../../src/domains/store/vexi/testing/voice-memory-redis';

const context = {
  user_id: 3,
  store_id: 1,
  organization_id: 2,
  permissions: ['write'],
  roles: ['owner'],
  is_owner: true,
  is_super_admin: false,
};
const run = <T>(work: () => T) =>
  RequestContextService.runIsolated(context, work);

const capture = {
  dedicated: true,
  foreground: true,
  focused: true,
  assistantSilent: true,
  noBargeIn: true,
  notEcho: true,
  reconnected: false,
};
const file = {
  buffer: Buffer.from('synthetic audio, not acoustic evidence'),
  mimetype: 'audio/webm',
} as Express.Multer.File;
async function fixture(agentKey: 'vex' | 'vexi' = 'vexi') {
  const redis = new MemoryRedis();
  const confirmation = new VexiConfirmationService(redis as any);
  const core = new VexiVoiceConsentService(redis as any, confirmation);
  const registry = new AIToolRegistry(confirmation);
  let value = 1;
  const mutation = jest.fn(async () => {
    value = 2;
    return JSON.stringify({
      applied: true,
      data: { id: 7, quantity: 2 },
      summary: 'Cantidad cambiada a 2.',
    });
  });
  const preview = jest.fn(async () => ({
    status: 'ok' as const,
    target: 'Registro',
    domain: 'records',
    changes: [{ field: 'quantity', label: 'Cantidad', from: value, to: 2 }],
  }));
  registry.register({
    name: 'change_record',
    domain: 'records',
    description: 'Change record',
    requiresConfirmation: true,
    requiredPermissions: ['write'],
    parameters: {
      type: 'object',
      properties: { quantity: { type: 'number' } },
      required: ['quantity'],
    },
    handler: mutation,
    preview,
  });
  const db = new ObjectiveMemoryDatabase();
  db.seedConversation(5, context, { agent_key: agentKey });
  const repo = new AgentObjectiveRepository(db.prisma);
  const objective = await repo.createOrReplace(5, null, agentKey, {
    goal: 'Cambiar cantidad',
    authority_snapshot: ['write'],
  });
  const plans = new VexiPlanStateService(db.prisma, repo);
  const current = {
    conversation_id: 5,
    agent_key: agentKey,
    objective_id: objective.id,
    step_id: null,
    goal: 'Cambiar cantidad',
    plan: null,
    authorizedDefinitions: registry.getAgentDefinitions(['write']),
  };
  const authority = {
    prepareAuthority: jest.fn(async () => current),
    resolveAuthority: jest.fn(async () => current),
    assertWritable: jest.fn(async () => {}),
    runAuthorized: jest.fn(async (_a: unknown, cb: () => Promise<unknown>) =>
      cb(),
    ),
  };
  let phrase = '';
  let confidence: number | null = 0.99;
  const engine = {
    runTranscription: jest.fn(async () => ({
      success: true,
      text: phrase,
      confidence,
    })),
  };
  const voice = new VexiVoiceService(engine as any);
  const host = new VexiVoiceConfirmationService(
    core,
    authority as any,
    registry,
    voice,
    plans,
    confirmation,
  );
  const activity = {
    recordApplied: jest.fn(),
    recordAppliedNarration: jest.fn(),
  };
  const speech = {
    resolveParams: jest.fn(async () => ({})),
    resolveCurrency: jest.fn(async () => {
      throw new Error('TTS offline');
    }),
    synthesize: jest.fn(),
  };
  const controller = new VexiController(
    {} as any,
    { success: (data: unknown) => data } as any,
    registry,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    activity,
    {} as any,
    speech as any,
    plans,
    host,
  );
  const vexSink = jest
    .fn()
    .mockResolvedValue({ step_status: 'applied', plan_status: 'applied' });
  if (agentKey === 'vex') {
    host.registerVexReceiptSink(vexSink);
    jest.spyOn(plans, 'getStepHashRecord').mockResolvedValue({
      plan_id: 'exact-card',
      created_at: new Date().toISOString(),
      steps: [
        {
          order: 1,
          tool: 'change_record',
          args_hash:
            require('../../src/domains/store/vexi/vexi-plan-state.service').canonicalStepHash(
              'change_record',
              { quantity: 2 },
            ),
        },
      ],
    });
    jest
      .spyOn(plans, 'assertVoiceProposalPreview')
      .mockResolvedValue({ stepId: 's1' });
  }
  const session = await host.session({
    conversation_id: 5,
    agent_key: agentKey,
  });
  let details: any;
  try {
    await registry.executeTool(
      'change_record',
      { quantity: 2 },
      { proposalOnly: true, conversationId: 5 },
    );
  } catch (e: any) {
    details = e.getResponse().details;
  }
  const challenge = await host.challenge({
    session_id: session.session_id,
    tool: 'change_record',
    arguments: { quantity: 2 },
    confirmation_token: details.confirmation_token,
    ...(agentKey === 'vex' && { plan_id: 'exact-card' }),
  });
  phrase = challenge.expected_phrase;
  const body = {
    session_id: session.session_id,
    proposal_id: challenge.proposal_id,
    challenge_id: challenge.challenge_id,
    capture,
    speak: true,
  };
  return {
    host,
    core,
    registry,
    plans,
    repo,
    controller,
    redis,
    vexSink,
    mutation,
    preview,
    authority,
    activity,
    speech,
    engine,
    session,
    challenge,
    body,
    setPhrase: (text: string) => (phrase = text),
    setConfidence: (n: number | null) => (confidence = n),
    setValue: (n: number) => (value = n),
  };
}
describe('G REAL consent -> existing apply -> D1 receipt offline', () => {
  it('exact server phrase applies once and TTS failure preserves applied text', () =>
    run(async () => {
      const f = await fixture();
      expect(f.mutation).not.toHaveBeenCalled();
      const result: any = await f.controller.consentVoiceProposal(file, f.body);
      expect(f.mutation).toHaveBeenCalledTimes(1);
      expect(result.execution).toMatchObject({
        status: 'ok',
        effect_status: 'applied',
      });
      expect(result.summary).toBe('Cantidad cambiada a 2.');
      expect(result.audio_base64).toBeUndefined();
      expect(f.activity.recordApplied).toHaveBeenCalledTimes(1);
      await expect(
        f.controller.consentVoiceProposal(file, f.body),
      ).rejects.toBeDefined();
      expect(f.mutation).toHaveBeenCalledTimes(1);
      const objective = await f.repo.getForConversation(5);
      const effects = await f.repo.listEffects(objective!.id);
      expect(effects).toHaveLength(1);
      expect(effects[0].domain_receipt).toMatchObject({
        consent: {
          channel: 'voice',
          challenge_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      });
      expect(JSON.stringify(effects)).not.toContain(
        f.challenge.expected_phrase,
      );
    }));
  it('double concurrent POST dispatches at most one business write', () =>
    run(async () => {
      const f = await fixture();
      const outcomes = await Promise.allSettled([
        f.controller.consentVoiceProposal(file, f.body),
        f.controller.consentVoiceProposal(file, f.body),
      ]);
      expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      expect(f.mutation).toHaveBeenCalledTimes(1);
    }));
  it.each([
    'sí',
    'no',
    'no ' + 'confirmo cambiar registro',
    'audio del asistente',
    'confirmo cambiar otro registro codigo 111111',
  ])('negative %s has ZERO writes', (text) =>
    run(async () => {
      const f = await fixture();
      f.setPhrase(text);
      await expect(
        f.controller.consentVoiceProposal(file, f.body),
      ).rejects.toBeDefined();
      expect(f.mutation).not.toHaveBeenCalled();
    }),
  );
  it('unknown ASR score refuses even exact phrase', () =>
    run(async () => {
      const f = await fixture();
      f.setConfidence(null);
      await expect(
        f.controller.consentVoiceProposal(file, f.body),
      ).rejects.toBeDefined();
      expect(f.mutation).not.toHaveBeenCalled();
    }));
  it('changed diff refuses before transcription or token redemption', () =>
    run(async () => {
      const f = await fixture();
      f.setValue(99);
      await expect(
        f.controller.consentVoiceProposal(file, f.body),
      ).rejects.toBeDefined();
      expect(f.engine.runTranscription).not.toHaveBeenCalled();
      expect(f.mutation).not.toHaveBeenCalled();
    }));
  it('revoked plan/permission refuses before STT and writes', () =>
    run(async () => {
      const f = await fixture();
      f.authority.assertWritable.mockRejectedValueOnce(new Error('revoked'));
      await expect(
        f.controller.consentVoiceProposal(file, f.body),
      ).rejects.toBeDefined();
      expect(f.engine.runTranscription).not.toHaveBeenCalled();
      expect(f.mutation).not.toHaveBeenCalled();
    }));
  it('foreign authenticated tenant cannot read/consent the proposal', () =>
    run(async () => {
      const f = await fixture();
      await RequestContextService.runIsolated({ ...context, store_id: 9 }, () =>
        expect(
          f.controller.consentVoiceProposal(file, f.body),
        ).rejects.toBeDefined(),
      );
      expect(f.mutation).not.toHaveBeenCalled();
    }));
  it('session close invalidates challenge without touching the original click approval', () =>
    run(async () => {
      const f = await fixture();
      const stored = await f.core.getProposal(
        f.session.session_id,
        f.challenge.proposal_id,
      );
      await f.host.cancel(f.session.session_id);
      await expect(
        f.controller.consentVoiceProposal(file, f.body),
      ).rejects.toBeDefined();
      expect(f.mutation).not.toHaveBeenCalled();
      await f.controller.applyConfirmation({
        tool: stored.tool,
        arguments: stored.arguments,
        confirmation_token: stored.confirmationToken,
        conversation_id: 5,
      });
      expect(f.mutation).toHaveBeenCalledTimes(1);
    }));
  it('server-held proposal click and consent race never double apply', () =>
    run(async () => {
      const f = await fixture();
      await Promise.allSettled([
        f.controller.consentVoiceProposal(file, f.body),
        f.controller.applyVoiceProposalWithClick({
          session_id: f.session.session_id,
          proposal_id: f.challenge.proposal_id,
        }),
      ]);
      expect(f.mutation).toHaveBeenCalledTimes(1);
    }));
  it('Vex spoken apply and existing click share EXACT operation identity', () =>
    run(async () => {
      const f = await fixture('vex');
      const result: any = await f.controller.consentVoiceProposal(file, f.body);
      expect(result.plan_status).toBe('applied');
      expect(f.vexSink).toHaveBeenCalledTimes(1);
      const objective = await f.repo.getForConversation(5);
      const effects = await f.repo.listEffects(objective!.id);
      expect(effects[0].step_id).toBe('exact-card:s1');
      await expect(
        f.plans.applyDurableEffect(
          {
            conversationId: 5,
            stepId: 'exact-card:s1',
            tool: 'change_record',
            args: { quantity: 2 },
          },
          () =>
            f.registry.executeTool(
              'change_record',
              { quantity: 2 },
              { confirmationToken: 'new-click-token' },
            ),
        ),
      ).rejects.toBeDefined();
      expect(f.mutation).toHaveBeenCalledTimes(1);
    }));
  it('explicit opaque click survives closed voice transport without exposing a token', () =>
    run(async () => {
      const f = await fixture();
      await f.host.cancel(f.session.session_id);
      await expect(
        f.controller.consentVoiceProposal(file, f.body),
      ).rejects.toBeDefined();
      const result: any = await f.controller.applyVoiceProposalWithClick({
        session_id: f.session.session_id,
        proposal_id: f.challenge.proposal_id,
      });
      expect(result.execution.effect_status).toBe('applied');
      expect(f.mutation).toHaveBeenCalledTimes(1);
    }));
  it('new dedicated session rebinds an opaque proposal, never its old nonce/expiry', () =>
    run(async () => {
      const f = await fixture();
      await f.host.cancel(f.session.session_id);
      const session = await f.host.session({
        conversation_id: 5,
        agent_key: 'vexi',
      });
      const challenge = await f.host.challenge({
        session_id: session.session_id,
        proposal_id: f.challenge.proposal_id,
      });
      expect(challenge.challenge_id).not.toBe(f.challenge.challenge_id);
      expect(Date.parse(challenge.expires_at)).toBeLessThanOrEqual(
        Date.parse(f.challenge.expires_at),
      );
      f.setPhrase(challenge.expected_phrase);
      await f.controller.consentVoiceProposal(file, {
        ...f.body,
        session_id: session.session_id,
        proposal_id: challenge.proposal_id,
        challenge_id: challenge.challenge_id,
      });
      expect(f.mutation).toHaveBeenCalledTimes(1);
    }));
  it('a replacement during explicit-click validation cannot apply the old diff', () =>
    run(async () => {
      const f = await fixture();
      const validate = f.host.validate.bind(f.host);
      jest
        .spyOn(f.host, 'validate')
        .mockImplementationOnce(async (proposal) => {
          const fresh = await validate(proposal);
          let next: any;
          try {
            await f.registry.executeTool(
              'change_record',
              { quantity: 3 },
              { proposalOnly: true, conversationId: 5 },
            );
          } catch (error: any) {
            next = error.getResponse().details;
          }
          await f.core.registerProposal({
            sessionId: f.session.session_id,
            tool: 'change_record',
            toolVersion: '1',
            arguments: { quantity: 3 },
            preview: next.preview,
            confirmationToken: next.confirmation_token,
            actionLabel: 'cambiar registro cantidad',
          });
          return fresh;
        });
      await expect(
        f.controller.applyVoiceProposalWithClick({
          session_id: f.session.session_id,
          proposal_id: f.challenge.proposal_id,
        }),
      ).rejects.toBeDefined();
      expect(f.mutation).not.toHaveBeenCalled();
    }));
  it('Vex dictation uses its bound authority but never consumes consent or writes', () =>
    run(async () => {
      const f = await fixture('vex');
      f.setPhrase('sí');
      const result = await f.controller.transcribeAgentVoice(file, {
        conversation_id: 5,
        agent_key: 'vex',
      });
      expect(result).toEqual({ text: 'sí' });
      expect(f.mutation).not.toHaveBeenCalled();
      expect(f.authority.prepareAuthority).toHaveBeenCalledWith(5, 'vex');
    }));
});
