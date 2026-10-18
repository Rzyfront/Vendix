import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { RequestContextService } from '../../../common/context/request-context.service';
import {
  AIToolRegistry,
  toolPreviewHash,
} from '../../../ai-engine/tools/ai-tool-registry';
import { describeVoiceAction } from './voice-action';
import { robustExecutionEnabled } from '../../../ai-engine/tasks/agent-execution-flags';
import { durableObjectivesEnabled } from '../../../ai-engine/tasks/interfaces/agent-objective.interface';
import {
  VexiVoiceConsentService,
  VoiceConsentProposal,
  VoiceConsentCapture,
  VoiceConsentAudit,
  voiceConfirmationEnabled,
} from './vexi-voice-consent.service';
import {
  VexiVoiceAuthorityService,
  VoiceAuthority,
} from './vexi-voice-authority.service';
import { VexiVoiceService } from './vexi-voice.service';
import {
  canonicalStepHash,
  VexiPlanStateService,
} from './vexi-plan-state.service';
import { VexiConfirmationService } from './vexi-confirmation.service';

export interface VoiceChallengeRequest {
  session_id: string;
  proposal_id?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  confirmation_token?: string;
  plan_id?: string;
}
export type VoiceApply = (
  proposal: Readonly<VoiceConsentProposal>,
  audit?: VoiceConsentAudit,
) => Promise<unknown>;

/** Transport adapter only. Business effects remain behind the existing apply. */
@Injectable()
export class VexiVoiceConfirmationService {
  private readonly logger = new Logger(VexiVoiceConfirmationService.name);
  private vexReceiptSink?: (
    proposal: Readonly<VoiceConsentProposal>,
  ) => Promise<unknown>;
  constructor(
    private readonly consent: VexiVoiceConsentService,
    private readonly authority: VexiVoiceAuthorityService,
    private readonly registry: AIToolRegistry,
    private readonly voice: VexiVoiceService,
    private readonly plans: VexiPlanStateService,
    private readonly confirmations: VexiConfirmationService,
  ) {}

  /** Registered by the owning Vex module; avoids reversing module dependencies. */
  registerVexReceiptSink(
    sink: (proposal: Readonly<VoiceConsentProposal>) => Promise<unknown>,
  ) {
    this.vexReceiptSink = sink;
  }
  async recordApplied(proposal: Readonly<VoiceConsentProposal>) {
    if (proposal.agentKey !== 'vex') return null;
    try {
      return await this.vexReceiptSink!(proposal);
    } catch {
      this.logger.warn(
        'El cambio fue aplicado; el estado de la tarjeta Vex requiere reconciliación.',
      );
      return null;
    }
  }

  capability() {
    return {
      enabled:
        voiceConfirmationEnabled() &&
        durableObjectivesEnabled() &&
        robustExecutionEnabled(),
      requires_reliable_stt: true,
      fallback: 'click',
    };
  }
  private requireEnabled() {
    if (!this.capability().enabled)
      throw new ConflictException(
        'La confirmación hablada no está disponible. Usa la aprobación con clic.',
      );
  }
  async session(input: {
    conversation_id: number;
    agent_key: 'vex' | 'vexi';
    channel?: 'pipeline' | 'realtime';
  }) {
    this.requireEnabled();
    const current = await this.authority.prepareAuthority(
      input.conversation_id,
      input.agent_key,
    );
    if (!current.objective_id)
      throw new ConflictException(
        'Primero abre el objetivo de esta conversación.',
      );
    return this.consent.createSession({
      conversationId: current.conversation_id,
      agentKey: current.agent_key,
      objectiveId: current.objective_id,
      stepId: current.step_id,
      channel: input.channel ?? 'pipeline',
      tools: current.authorizedDefinitions.map((definition) => ({
        name: definition.function.name,
        version: this.registry.get(definition.function.name)?.version ?? '1',
      })),
    });
  }

  /** Vex normal dictation uses the same STT, without depending on Vexi's toggle. */
  async transcribeTurn(
    input: { conversation_id: number; agent_key: 'vex' | 'vexi' },
    file: Express.Multer.File,
  ) {
    this.requireEnabled();
    await this.authority.prepareAuthority(
      input.conversation_id,
      input.agent_key,
    );
    return this.voice.transcribe(undefined, file); // Dictation is NEVER consent.
  }
  async challenge(input: VoiceChallengeRequest) {
    this.requireEnabled();
    const session = await this.consent.validateSession(input.session_id);
    const current = await this.authority.resolveAuthority(
      session.conversationId,
      session.agentKey,
    );
    await this.requireSessionAuthority(session, current);
    let proposalId = input.proposal_id;
    if (proposalId) {
      // A new dedicated capture may rebind an owned immutable proposal, never
      // its old nonce. No secret token is sent through the browser/model.
      const original = await this.consent.getProposalForClick(proposalId);
      if (
        original.conversationId !== session.conversationId ||
        original.agentKey !== session.agentKey ||
        original.objectiveId !== session.objectiveId ||
        original.stepId !== session.stepId
      )
        throw new ConflictException(
          'La propuesta pertenece a otro objetivo o conversación.',
        );
      await this.validate(original);
      if (original.sessionId !== input.session_id) {
        const rebound = await this.consent.registerProposal({
          sessionId: input.session_id,
          tool: original.tool,
          toolVersion: original.toolVersion,
          arguments: original.arguments,
          preview: original.preview,
          confirmationToken: original.confirmationToken,
          actionLabel: original.actionLabel,
          ...(original.planId && { planId: original.planId }),
          maxExpiresAt: original.expiresAt,
        });
        proposalId = rebound.proposal_id;
      }
    }
    if (!proposalId) {
      if (!input.tool || !input.arguments)
        throw new ConflictException('Selecciona una propuesta exacta.');
      const tool = this.registry.canonicalName(input.tool);
      this.requireOffered(current, tool);
      const args = JSON.parse(JSON.stringify(input.arguments)) as Record<
        string,
        unknown
      >;
      const fresh = await this.authority.runAuthorized(current, () =>
        this.registry.previewForConsent(tool, args),
      );
      let token = input.confirmation_token;
      if (session.agentKey === 'vex') {
        // Vex never exposes a bundle token to voice. Resolve ONE server step.
        const record = await this.plans.getStepHashRecord(
          session.conversationId,
        );
        if (
          !input.plan_id ||
          record.plan_id !== input.plan_id ||
          record.steps.length !== 1 ||
          !record.created_at ||
          Date.now() - Date.parse(record.created_at) > 300_000 ||
          Date.parse(record.created_at) > Date.now() ||
          record.steps[0].tool !== tool ||
          record.steps[0].args_hash !== canonicalStepHash(tool, args)
        )
          throw new ConflictException(
            'Este plan cambió o no contiene una sola escritura vigente. Revísalo con clic.',
          );
        // Verify the ORIGINAL displayed diff, not an invented/current preview.
        await this.assertVexDisplayedPreview(
          session.conversationId,
          input.plan_id,
          tool,
          args,
          fresh.preview,
        );
        const ctx = RequestContextService.asyncLocalStorage.getStore()!;
        token = await this.confirmations.issue(tool, args, ctx.user_id, {
          previewHash: toolPreviewHash(fresh.preview),
          storeId: ctx.store_id!,
          organizationId: ctx.organization_id!,
          conversationId: session.conversationId,
          toolVersion: fresh.toolVersion,
        });
      }
      if (!token)
        throw new ConflictException(
          'La propuesta no tiene una confirmación vigente. Solicita otra.',
        );
      const registered = await this.consent.registerProposal({
        sessionId: input.session_id,
        tool,
        arguments: args,
        toolVersion: fresh.toolVersion,
        preview: fresh.preview,
        confirmationToken: token,
        actionLabel: describeVoiceAction(fresh.preview),
        ...(input.plan_id && { planId: input.plan_id }),
      });
      proposalId = registered.proposal_id;
    }
    const proposal = await this.consent.getProposal(
      input.session_id,
      proposalId,
    );
    await this.validate(proposal);
    const challenge = await this.consent.issueChallenge({
      sessionId: input.session_id,
      proposalId,
    });
    const preview =
      proposal.preview as import('../../../ai-engine/tools/interfaces/tool.interface').ToolPreview;
    const consequence = this.registry.isIrreversible(proposal.tool)
      ? 'Esta acción tiene consecuencias irreversibles o externas. Lee todos los valores antes de confirmar.'
      : null;
    const value = (item: unknown) =>
      typeof item === 'string' ? item : JSON.stringify(item ?? null);
    const actionText = [
      preview.target,
      ...preview.changes.map(
        (change) =>
          `${change.label}: de ${value(change.from)} a ${value(change.to)}.`,
      ),
      preview.message,
      consequence,
    ]
      .filter(Boolean)
      .join(' ');
    return { ...challenge, preview, consequence, action_text: actionText };
  }

  // Replaced below by an injected owner-scoped transcript lookup in the plan service.
  private async assertVexDisplayedPreview(
    conversationId: number,
    planId: string,
    tool: string,
    args: Record<string, unknown>,
    preview: unknown,
  ) {
    return this.plans.assertVoiceProposalPreview(
      conversationId,
      planId,
      tool,
      args,
      toolPreviewHash(preview),
    );
  }
  private requireOffered(current: VoiceAuthority, tool: string) {
    if (
      !current.authorizedDefinitions.some(
        (definition) => definition.function.name === tool,
      )
    )
      throw new ConflictException(
        'La herramienta no está autorizada en este objetivo.',
      );
  }
  private async requireSessionAuthority(
    session: { objectiveId: string | null; stepId: string | null },
    current: VoiceAuthority,
  ) {
    if (
      session.objectiveId !== current.objective_id ||
      session.stepId !== current.step_id
    )
      throw new ConflictException(
        'Cambió el objetivo o el paso. Abre una sesión nueva y revisa la propuesta.',
      );
    await this.authority.assertWritable(current);
  }
  async validate(proposal: Readonly<VoiceConsentProposal>) {
    this.requireEnabled();
    const current = await this.authority.resolveAuthority(
      proposal.conversationId,
      proposal.agentKey,
    );
    await this.requireSessionAuthority(proposal, current);
    this.requireOffered(current, proposal.tool);
    if (proposal.agentKey === 'vex' && !this.vexReceiptSink)
      throw new ConflictException(
        'La aprobación Vex no está disponible en este proceso.',
      );
    const fresh = await this.authority.runAuthorized(current, () =>
      this.registry.previewForConsent(
        proposal.tool,
        JSON.parse(JSON.stringify(proposal.arguments)),
      ),
    );
    if (
      toolPreviewHash(fresh.preview) !== proposal.previewHash ||
      VexiVoiceConsentService.hash(fresh.arguments) !==
        proposal.argumentsHash ||
      fresh.toolVersion !== proposal.toolVersion
    )
      throw new ConflictException(
        'La propuesta cambió. Revisa una nueva antes de aprobar.',
      );
    if (proposal.planId)
      await this.assertVexDisplayedPreview(
        proposal.conversationId,
        proposal.planId,
        proposal.tool,
        proposal.arguments,
        fresh.preview,
      );
    return fresh;
  }
  async effectStepId(
    proposal: Readonly<VoiceConsentProposal>,
  ): Promise<string | undefined> {
    if (!proposal.planId) return proposal.stepId ?? undefined;
    const step = await this.plans.assertVoiceProposalPreview(
      proposal.conversationId,
      proposal.planId,
      proposal.tool,
      proposal.arguments,
      proposal.previewHash,
    );
    return `${proposal.planId}:${step.stepId}`; // EXACT identity used by existing Vex click apply.
  }
  async runAuthorized<T>(
    proposal: Readonly<VoiceConsentProposal>,
    callback: () => Promise<T>,
  ): Promise<T> {
    const current = await this.authority.resolveAuthority(
      proposal.conversationId,
      proposal.agentKey,
    );
    return this.authority.runAuthorized(current, callback);
  }
  async consentAudio(
    input: {
      session_id: string;
      proposal_id: string;
      challenge_id: string;
      capture: VoiceConsentCapture;
    },
    file: Express.Multer.File,
    apply: VoiceApply,
  ) {
    this.requireEnabled();
    const proposal = await this.consent.getProposal(
      input.session_id,
      input.proposal_id,
    );
    await this.validate(proposal); // Revalidate BEFORE paying for STT.
    const observation = await this.voice.transcribeConsent(file);
    return this.consent.consumeConsent(
      {
        sessionId: input.session_id,
        proposalId: input.proposal_id,
        challengeId: input.challenge_id,
        observation,
        capture: input.capture,
      },
      {
        validate: (stored) => this.validate(stored),
        apply,
      },
    );
  }
  async applyClick(
    input: { session_id: string; proposal_id: string },
    apply: VoiceApply,
  ) {
    return this.consent.consumeClick(input.proposal_id, {
      validate: async (proposal) => {
        if (proposal.sessionId !== input.session_id)
          throw new ConflictException(
            'La propuesta no corresponde a esta sesión.',
          );
        return this.validate(proposal);
      },
      apply,
    });
  }
  async cancel(sessionId: string) {
    await this.consent.closeSession(sessionId);
    return { cancelled: true };
  }
}
