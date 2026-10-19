import { RequestContextService } from '../../../common/context/request-context.service';
import { VexiController } from '../vexi/vexi.controller';
import { VexiVoiceConfirmationService } from '../vexi/vexi-voice-confirmation.service';
import type { VoiceConsentProposal } from '../vexi/vexi-voice-consent.service';
import { PlanApprovalService } from './services/plan-approval.service';
import { VexModule } from './vex.module';

const context = {
  store_id: 11, organization_id: 7, user_id: 3,
  is_owner: false, is_super_admin: false,
};
const planId = 'd973bb78-8c4a-4daa-a600-b9969d726447';
const args = { id: 7, name: 'Nuevo' };

/** Real controller -> voice adapter -> Vex module sink -> plan persistence.
 * Prisma transport and the already-produced D1 receipt are synthetic, not DB/audio E2E.
 */
function fixture(
  status: 'proposed' | 'approved',
  outcome = 'unknown_effect',
  withPlan = true,
) {
  let metadata = {
    plan: {
      plan_id: planId,
      status,
      steps: [
        {
          step_id: 's1',
          tool: 'update_product',
          arguments: args,
          status: 'pending',
          confirmation_token: 'consumed',
          irreversible: false,
        },
      ],
    },
    other: 'preserved',
  };
  const prisma: any = {
    ai_conversations: {
      findFirst: jest.fn(async () => ({ id: 22, user_id: 3 })),
    },
    ai_messages: {
      findMany: jest.fn(async () => [
        { id: 1, metadata: structuredClone(metadata) },
      ]),
      updateMany: jest.fn(async ({ data }) => {
        metadata = structuredClone(data.metadata);
        return { count: 1 };
      }),
    },
  };
  const makePlans = () =>
    new PlanApprovalService({} as any, {} as any, {} as any, prisma);
  const plans = makePlans();
  const voice = new VexiVoiceConfirmationService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  jest.spyOn(voice, 'validate').mockResolvedValue({} as any);
  jest.spyOn(voice, 'effectStepId').mockResolvedValue(`${planId}:s1`);
  const quota = jest.fn();
  const registry: any = { registerMany: jest.fn() };
  new VexModule(registry, {} as any, voice, plans, {
    consumeAIQuota: quota,
  } as any).onModuleInit();
  const controller: any = Object.create(VexiController.prototype);
  controller.responseService = { success: (data: unknown) => data };
  controller.voiceConfirmations = voice;
  controller.planState = {
    applyDurableEffect: jest.fn(async () => ({
      output: '{}',
      result: {
        status: outcome,
        effect_status:
          outcome === 'ok'
            ? 'applied'
            : outcome === 'unknown_effect'
              ? 'unknown'
              : 'not_applied',
        next_action: 'Reconciliar antes de repetir.',
      },
    })),
    markCurrentChangeStep: jest.fn(),
  };
  controller.activity = {
    recordApplied: jest.fn(),
    recordAppliedNarration: jest.fn(),
  };
  const proposal: VoiceConsentProposal = {
    sessionId: 'voice-session',
    tool: 'update_product',
    toolVersion: '1',
    arguments: args,
    preview: { summary: 'Renombrar producto' },
    confirmationToken: 'consumed',
    actionLabel: 'Producto · actualizar',
    ...(withPlan && { planId }),
    proposalId: 'proposal-1',
    userId: 3,
    organizationId: 7,
    storeId: 11,
    conversationId: 22,
    agentKey: 'vex',
    objectiveId: null,
    stepId: null,
    sessionRevision: 1,
    argumentsHash: 'args-hash',
    previewHash: 'preview-hash',
    expiresAt: Date.now() + 60_000,
  };
  const apply = () =>
    controller.applyConfirmation(
      {
        tool: proposal.tool,
        arguments: args,
        confirmation_token: 'consumed',
        conversation_id: 22,
      },
      { proposal },
    );
  return {
    controller,
    voice,
    quota,
    makePlans,
    apply,
    proposal,
    metadata: () => metadata,
  };
}

describe('N1 Vex voice semantic receipt persistence', () => {
  it.each(['proposed', 'approved'] as const)(
    'persists unknown from %s, survives reload and rejects new approval without success activity/quota',
    async (status) =>
      RequestContextService.runIsolated(context, async () => {
        const f = fixture(status);
        const output = await f.apply();
        expect(output).toMatchObject({
          step_status: 'unknown',
          plan_status: 'unknown_effect',
        });
        // A fresh service reads persisted metadata, not the previous instance's state.
        const reloaded = await f.makePlans().getPlan(22, planId);
        expect(reloaded).toMatchObject({
          status: 'unknown_effect',
          steps: [{ status: 'unknown' }],
        });
        expect(reloaded!.steps[0]).not.toHaveProperty('confirmation_token');
        expect(f.metadata().other).toBe('preserved');
        await expect(
          f
            .makePlans()
            .resolveStepForConfirmation({
              planId,
              stepId: 's1',
              conversationId: 22,
              userId: 3,
            }),
        ).rejects.toThrow();
        expect(f.quota).not.toHaveBeenCalled();
        expect(f.controller.activity.recordApplied).not.toHaveBeenCalled();
        expect(
          f.controller.activity.recordAppliedNarration,
        ).not.toHaveBeenCalled();
        expect(
          f.controller.planState.markCurrentChangeStep,
        ).not.toHaveBeenCalled();
        expect(f.controller.planState.applyDurableEffect).toHaveBeenCalledTimes(
          1,
        );
        expect(
          f.controller.planState.applyDurableEffect.mock.calls[0][0].stepId,
        ).toBe(`${planId}:s1`);
      }),
  );
  it('retains definitive failure without charging successful quota', async () =>
    RequestContextService.runIsolated(context, async () => {
      const f = fixture('proposed', 'recoverable_error');
      expect(await f.apply()).toMatchObject({
        step_status: 'failed',
        plan_status: 'partially_applied',
      });
      expect((await f.makePlans().getPlan(22, planId))!.steps[0].status).toBe(
        'failed',
      );
      expect(f.quota).not.toHaveBeenCalled();
      expect(f.controller.activity.recordApplied).not.toHaveBeenCalled();
    }));
  it('keeps the applied path and its one success unit', async () =>
    RequestContextService.runIsolated(context, async () => {
      const f = fixture('proposed', 'ok');
      expect(await f.apply()).toMatchObject({
        step_status: 'applied',
        plan_status: 'applied',
      });
      expect(f.quota).toHaveBeenCalledTimes(1);
      expect(f.controller.activity.recordApplied).toHaveBeenCalledTimes(1);
      expect(
        f.controller.activity.recordAppliedNarration,
      ).toHaveBeenCalledTimes(1);
    }));
  it('reports an applied single-use Vex voice receipt as applied, like the click path', async () =>
    RequestContextService.runIsolated(context, async () => {
      // `single-` cards send no plan_id: no server plan exists to persist.
      const f = fixture('proposed', 'ok', false);
      expect(f.proposal.planId).toBeUndefined();
      expect(await f.apply()).toMatchObject({
        step_status: 'applied',
        plan_status: 'applied',
      });
      expect(f.quota).toHaveBeenCalledTimes(1);
      expect(f.metadata().plan.steps[0].status).toBe('pending');
    }));
  it('keeps an uncertain single-use Vex voice receipt fail-closed', async () =>
    RequestContextService.runIsolated(context, async () => {
      const f = fixture('proposed', 'unknown_effect', false);
      expect(await f.apply()).toMatchObject({
        step_status: 'unknown',
        plan_status: 'unknown_effect',
      });
      expect(f.quota).not.toHaveBeenCalled();
    }));
  it('does not send Vexi receipts to the Vex-only sink', async () => {
    const f = fixture('proposed');
    expect(
      await f.voice.recordResult(
        { ...f.proposal, agentKey: 'vexi' },
        { outcome: 'unknown' },
      ),
    ).toBeNull();
    expect(f.quota).not.toHaveBeenCalled();
    expect(f.metadata().plan.status).toBe('proposed');
  });
});
