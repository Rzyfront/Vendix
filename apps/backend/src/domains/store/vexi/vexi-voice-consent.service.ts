import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { RequestContextService } from '../../../common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import type { ToolRoutingSession } from '../../../ai-engine/tools/tool-router.service';
import {
  canonicalJson,
  VexiConfirmationService,
} from './vexi-confirmation.service';

const SESSION_TTL_SECONDS = 300;
/** Billing retention is NOT authority duration. All executable reads use expiresAt. */
const SESSION_RETENTION_SECONDS = 3_600;
const CONSENT_TTL_SECONDS = 60;
const MIN_CONFIDENCE = 0.95;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOOL = /^[a-z][a-z0-9_]{0,99}$/;
const VERSION = /^[a-zA-Z0-9._-]{1,40}$/;

export interface VoiceConsentTool {
  name: string;
  version: string;
}
export interface VoiceSessionInput {
  conversationId: number;
  agentKey: 'vex' | 'vexi';
  objectiveId: string | null;
  stepId: string | null;
  tools: VoiceConsentTool[];
  channel?: 'pipeline' | 'realtime';
  /** Server-created router state, never accepted from an HTTP DTO. */
  routing?: ToolRoutingSession;
}
export interface VoiceConsentSession extends VoiceSessionInput {
  sessionId: string;
  userId: number;
  organizationId: number;
  storeId: number;
  expiresAt: number;
  revision: number;
  playbookTokens: number;
  /** Execution tombstone; realtime quota close may still consume the record. */
  closed?: boolean;
}
export interface RegisterVoiceProposalInput {
  sessionId: string;
  tool: string;
  toolVersion: string;
  arguments: Record<string, unknown>;
  preview: unknown;
  confirmationToken: string;
  /** Inert subject + operation derived by the server from the issued preview. */
  actionLabel: string;
  planId?: string;
  /** Server-only cap when rebinding the SAME immutable displayed proposal. */
  maxExpiresAt?: number;
}
/** SERVER ONLY: never return this record to an LLM, transcript or browser. */
export interface VoiceConsentProposal extends RegisterVoiceProposalInput {
  proposalId: string;
  userId: number;
  organizationId: number;
  storeId: number;
  conversationId: number;
  agentKey: 'vex' | 'vexi';
  objectiveId: string | null;
  stepId: string | null;
  sessionRevision: number;
  argumentsHash: string;
  previewHash: string;
  expiresAt: number;
}
export interface VoiceConsentCapture {
  dedicated: boolean;
  foreground: boolean;
  focused: boolean;
  assistantSilent: boolean;
  noBargeIn: boolean;
  notEcho: boolean;
  reconnected: boolean;
}
/** Only the authenticated server STT adapter may construct this observation. */
export interface VoiceConsentObservation {
  source: 'server_stt';
  text: string;
  /** Null/unknown confidence NEVER falls back to approval. */
  confidence: number | null;
}
export interface ConsumeVoiceConsentInput {
  sessionId: string;
  proposalId: string;
  challengeId: string;
  observation: VoiceConsentObservation;
  capture: VoiceConsentCapture;
}
export interface VoiceConsentCallbacks<T> {
  /** Must recheck current permissions, agent/plan, setup, state and D1 step. */
  validate: (proposal: Readonly<VoiceConsentProposal>) => Promise<{
    arguments: Record<string, unknown>;
    preview: unknown;
    toolVersion: string;
  }>;
  /** MUST call the existing apply/registry choke; no direct business writes. */
  apply: (
    proposal: Readonly<VoiceConsentProposal>,
    audit: VoiceConsentAudit,
  ) => Promise<T>;
}
export interface VoiceConsentAudit {
  channel: 'voice';
  challenge_hash: string;
  proposal_hash: string;
}
export interface VoiceConsentChallenge {
  session_id: string;
  proposal_id: string;
  challenge_id: string;
  phrase: string;
  expected_phrase: string;
  preview_hash: string;
  expires_at: string;
}
interface StoredChallenge {
  challengeId: string;
  proposalId: string;
  sessionId: string;
  sessionRevision: number;
  phraseHash: string;
  expiresAt: number;
}

/** All mutations compare the exact immutable session snapshot, not only an ID. */
const REGISTER_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if ARGV[6] ~= '' and redis.call('GET', KEYS[4]) ~= ARGV[6] then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[4])
redis.call('SET', KEYS[3], ARGV[3], 'PX', ARGV[4])
redis.call('SET', KEYS[4], ARGV[5], 'PX', ARGV[4])
return 1
`;
const CHALLENGE_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if redis.call('GET', KEYS[2]) ~= ARGV[2] then return 0 end
if redis.call('GET', KEYS[3]) ~= ARGV[3] then return 0 end
if redis.call('GET', KEYS[5]) ~= ARGV[6] then return 0 end
redis.call('SET', KEYS[4], ARGV[4], 'PX', ARGV[5])
return 1
`;
const CONSUME_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if redis.call('GET', KEYS[2]) ~= ARGV[2] then return 0 end
if redis.call('GET', KEYS[3]) ~= ARGV[3] then return 0 end
if redis.call('GET', KEYS[4]) ~= ARGV[4] then return 0 end
if redis.call('GET', KEYS[5]) ~= ARGV[5] then return 0 end
redis.call('DEL', KEYS[2], KEYS[3], KEYS[4])
return 1
`;
const CLICK_SCRIPT = `
-- voice_click_claim: immutable proposal and current diff in one atomic turn.
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if redis.call('GET', KEYS[2]) ~= ARGV[2] then return 0 end
redis.call('DEL', KEYS[1])
return 1
`;
const INVALIDATE_CHALLENGE_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if redis.call('GET', KEYS[2]) ~= ARGV[2] then return 0 end
if redis.call('GET', KEYS[3]) ~= ARGV[3] then return 0 end
if redis.call('GET', KEYS[4]) ~= ARGV[4] then return 0 end
redis.call('DEL', KEYS[4])
return 1
`;
const UPDATE_SESSION_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ttl)
redis.call('DEL', KEYS[2])
return 1
`;
const CLOSE_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1], KEYS[2])
return 1
`;
const TOMBSTONE_SESSION_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ttl)
redis.call('DEL', KEYS[2])
return 1
`;

/**
 * Ephemeral consent authority only; it never mutates business data. A challenge
 * is not authentication/biometrics. Browser lifecycle flags are defensive hints,
 * not evidence against a hostile authenticated client or acoustic replay. Real
 * microphone/echo/noise/focus behavior remains a QA gate; click is always fallback.
 */
@Injectable()
export class VexiVoiceConsentService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly confirmations: VexiConfirmationService,
  ) {}

  static hash(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
  }

  async createSession(
    input: VoiceSessionInput,
  ): Promise<{ session_id: string; expires_at: string }> {
    const principal = this.principal();
    this.validateInput(input);
    const session: VoiceConsentSession = {
      ...this.copy(input, 64_000),
      channel: input.channel ?? 'pipeline',
      ...principal,
      sessionId: randomUUID(),
      revision: 0,
      playbookTokens: 0,
      expiresAt: Date.now() + SESSION_TTL_SECONDS * 1_000,
    };
    await this.redis.set(
      this.sessionKey(session.sessionId),
      canonicalJson(session),
      'EX',
      SESSION_RETENTION_SECONDS,
    );
    return {
      session_id: session.sessionId,
      expires_at: new Date(session.expiresAt).toISOString(),
    };
  }

  async validateSession(
    sessionId: string,
    expected?: Partial<
      Pick<
        VoiceConsentSession,
        'conversationId' | 'agentKey' | 'objectiveId' | 'stepId'
      >
    >,
  ): Promise<VoiceConsentSession> {
    const principal = this.principal();
    this.requireUuid(sessionId);
    const session = this.parse<VoiceConsentSession>(
      await this.redis.get(this.sessionKey(sessionId)),
    );
    if (
      !session ||
      session.closed === true ||
      session.sessionId !== sessionId ||
      session.expiresAt <= Date.now() ||
      session.userId !== principal.userId ||
      session.organizationId !== principal.organizationId ||
      session.storeId !== principal.storeId ||
      !Number.isSafeInteger(session.revision) ||
      session.revision < 0 ||
      !Number.isSafeInteger(session.expiresAt) ||
      !Number.isSafeInteger(session.playbookTokens) ||
      session.playbookTokens < 0
    ) {
      this.reject('session_unavailable');
    }
    this.validateInput(session);
    for (const [key, value] of Object.entries(expected ?? {})) {
      if (session[key as keyof VoiceConsentSession] !== value)
        this.reject('session_binding_mismatch');
    }
    return session;
  }

  /** Only server router/authorization code calls this; changes invalidate consent. */
  async updateSessionCatalog(
    sessionId: string,
    tools: VoiceConsentTool[],
    routing?: ToolRoutingSession,
    expectedRevision?: number,
    playbookTokens?: number,
  ): Promise<VoiceConsentSession> {
    const session = await this.validateSession(sessionId);
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision !== session.revision ||
      (playbookTokens !== undefined &&
        (!Number.isSafeInteger(playbookTokens) ||
          playbookTokens < session.playbookTokens ||
          playbookTokens > 1_000_000))
    )
      this.reject('session_changed');
    const next: VoiceConsentSession = {
      ...session,
      tools: this.copy(tools, 40_000),
      revision: session.revision + 1,
      ...(playbookTokens !== undefined && { playbookTokens }),
      ...(routing && { routing: this.copy(routing, 20_000) }),
    };
    this.validateInput(next);
    const result = await this.redis.eval(
      UPDATE_SESSION_SCRIPT,
      2,
      this.sessionKey(sessionId),
      this.activeKey(sessionId),
      canonicalJson(session),
      canonicalJson(next),
    );
    if (Number(result) !== 1) this.reject('session_changed');
    return next;
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = await this.validateSession(sessionId);
    if (session.channel === 'realtime') {
      // Cancel authority, NOT the existing billing obligation. The retained
      // tombstone cannot be read/expanded/proposed/consented again.
      const closed = await this.redis.eval(
        TOMBSTONE_SESSION_SCRIPT,
        2,
        this.sessionKey(sessionId),
        this.activeKey(sessionId),
        canonicalJson(session),
        canonicalJson({ ...session, closed: true }),
      );
      if (Number(closed) !== 1) this.reject('session_changed');
      return;
    }
    await this.redis.eval(
      CLOSE_SCRIPT,
      2,
      this.sessionKey(sessionId),
      this.activeKey(sessionId),
      canonicalJson(session),
    );
    // Any orphan proposal/challenge expires <=60s and is unusable without session.
  }

  /**
   * Retained only to finish the existing realtime quota loop after authority
   * expiry. Returned data grants NO tool/proposal/consent access. One winner.
   */
  async closeSessionForBilling(
    sessionId: string,
  ): Promise<VoiceConsentSession> {
    const principal = this.principal();
    this.requireUuid(sessionId);
    const session = this.parse<VoiceConsentSession>(
      await this.redis.get(this.sessionKey(sessionId)),
    );
    if (
      !session ||
      session.channel !== 'realtime' ||
      session.sessionId !== sessionId ||
      session.userId !== principal.userId ||
      session.organizationId !== principal.organizationId ||
      session.storeId !== principal.storeId ||
      !Number.isSafeInteger(session.expiresAt) ||
      !Number.isSafeInteger(session.revision) ||
      session.revision < 0 ||
      !Number.isSafeInteger(session.playbookTokens) ||
      session.playbookTokens < 0 ||
      Date.now() < session.expiresAt - SESSION_TTL_SECONDS * 1_000 ||
      Date.now() >=
        session.expiresAt +
          (SESSION_RETENTION_SECONDS - SESSION_TTL_SECONDS) * 1_000
    ) {
      this.reject('billing_session_unavailable');
    }
    this.validateInput(session);
    const closed = await this.redis.eval(
      CLOSE_SCRIPT,
      2,
      this.sessionKey(sessionId),
      this.activeKey(sessionId),
      canonicalJson(session),
    );
    if (Number(closed) !== 1) this.reject('billing_session_already_closed');
    return session;
  }

  async registerProposal(input: RegisterVoiceProposalInput): Promise<{
    session_id: string;
    proposal_id: string;
    preview_hash: string;
    expires_at: string;
  }> {
    const session = await this.validateSession(input.sessionId);
    if (
      !TOOL.test(input.tool) ||
      !VERSION.test(input.toolVersion) ||
      !session.tools.some(
        (tool) =>
          tool.name === input.tool && tool.version === input.toolVersion,
      )
    ) {
      this.reject('tool_not_offered');
    }
    this.requireUuid(input.confirmationToken);
    this.actionLabel(input.actionLabel);
    if (
      input.maxExpiresAt !== undefined &&
      (!Number.isSafeInteger(input.maxExpiresAt) ||
        input.maxExpiresAt <= Date.now())
    ) {
      this.reject('proposal_expired');
    }
    if (
      !input.arguments ||
      typeof input.arguments !== 'object' ||
      Array.isArray(input.arguments)
    ) {
      this.reject('arguments_invalid');
    }
    const args = this.copy(input.arguments, 32_000);
    const preview = this.copy(input.preview, 64_000);
    const inspection = await this.confirmations.inspect(
      input.confirmationToken,
      input.tool,
      args,
      session.userId,
    );
    const previewHash = VexiVoiceConsentService.hash(preview);
    this.requireTokenBinding(
      inspection,
      session,
      input.toolVersion,
      previewHash,
    );
    const expiresAt = Math.min(
      session.expiresAt,
      Date.now() + CONSENT_TTL_SECONDS * 1_000,
      Date.now() + inspection.ttlSeconds * 1_000,
      input.maxExpiresAt ?? Infinity,
    );
    const proposal: VoiceConsentProposal = {
      sessionId: session.sessionId,
      tool: input.tool,
      toolVersion: input.toolVersion,
      arguments: args,
      preview,
      confirmationToken: input.confirmationToken,
      actionLabel: input.actionLabel,
      ...(input.planId && { planId: input.planId.slice(0, 80) }),
      proposalId: randomUUID(),
      userId: session.userId,
      organizationId: session.organizationId,
      storeId: session.storeId,
      conversationId: session.conversationId,
      agentKey: session.agentKey,
      objectiveId: session.objectiveId,
      stepId: session.stepId,
      sessionRevision: session.revision,
      argumentsHash: VexiVoiceConsentService.hash(args),
      previewHash,
      expiresAt,
    };
    const result = await this.redis.eval(
      REGISTER_SCRIPT,
      4,
      this.sessionKey(session.sessionId),
      this.proposalKey(proposal.proposalId),
      this.activeKey(session.sessionId),
      this.currentKey(proposal),
      canonicalJson(session),
      canonicalJson(proposal),
      proposal.proposalId,
      this.ttl(expiresAt),
      this.proposalFingerprint(proposal),
      input.maxExpiresAt !== undefined
        ? this.proposalFingerprint(proposal)
        : '',
    );
    if (Number(result) !== 1) this.reject('session_changed');
    return {
      session_id: session.sessionId,
      proposal_id: proposal.proposalId,
      preview_hash: previewHash,
      expires_at: new Date(expiresAt).toISOString(),
    };
  }

  /** Server adapter only; includes the secret existing token. Do not serialize. */
  async getProposal(
    sessionId: string,
    proposalId: string,
  ): Promise<VoiceConsentProposal> {
    const session = await this.validateSession(sessionId);
    return this.loadProposal(session, proposalId);
  }

  /**
   * SERVER ONLY, explicit-click endpoint only. Cancelling voice is not rejecting
   * the displayed business proposal: an authenticated click may still approve
   * its immutable <=60s payload after voice/session/billing close. The adapter
   * MUST freshly validate objective/step/agent/version/preview and existing apply
   * authority. This method never restores a voice session/challenge/catalog.
   */
  async getProposalForClick(proposalId: string): Promise<VoiceConsentProposal> {
    const principal = this.principal();
    this.requireUuid(proposalId);
    const proposal = this.parse<VoiceConsentProposal>(
      await this.redis.get(this.proposalKey(proposalId)),
    );
    if (
      !proposal ||
      proposal.proposalId !== proposalId ||
      !Number.isSafeInteger(proposal.expiresAt) ||
      proposal.expiresAt <= Date.now() ||
      proposal.userId !== principal.userId ||
      proposal.organizationId !== principal.organizationId ||
      proposal.storeId !== principal.storeId ||
      !Number.isSafeInteger(proposal.sessionRevision) ||
      proposal.sessionRevision < 0 ||
      !TOOL.test(proposal.tool) ||
      !VERSION.test(proposal.toolVersion) ||
      !proposal.arguments ||
      typeof proposal.arguments !== 'object' ||
      Array.isArray(proposal.arguments) ||
      VexiVoiceConsentService.hash(proposal.arguments) !==
        proposal.argumentsHash ||
      VexiVoiceConsentService.hash(proposal.preview) !== proposal.previewHash
    )
      this.reject('click_proposal_unavailable');
    if (
      (await this.redis.get(this.currentKey(proposal))) !==
      this.proposalFingerprint(proposal)
    )
      this.reject('proposal_superseded');
    this.requireUuid(proposal.sessionId);
    this.requireUuid(proposal.confirmationToken);
    this.validateInput({
      conversationId: proposal.conversationId,
      agentKey: proposal.agentKey,
      objectiveId: proposal.objectiveId,
      stepId: proposal.stepId,
      tools: [{ name: proposal.tool, version: proposal.toolVersion }],
    });
    const inspection = await this.confirmations.inspect(
      proposal.confirmationToken,
      proposal.tool,
      proposal.arguments,
      principal.userId,
    );
    this.requireTokenBinding(
      inspection,
      {
        ...principal,
        conversationId: proposal.conversationId,
      },
      proposal.toolVersion,
      proposal.previewHash,
    );
    return proposal;
  }

  /** Explicit click shares the current-proposal fence, without audio. */
  async consumeClick<T>(
    proposalId: string,
    callbacks: {
      validate: VoiceConsentCallbacks<T>['validate'];
      apply: (proposal: Readonly<VoiceConsentProposal>) => Promise<T>;
    },
  ): Promise<T> {
    const proposal = await this.getProposalForClick(proposalId);
    const fresh = await callbacks.validate(this.copy(proposal, 128_000));
    if (
      fresh.toolVersion !== proposal.toolVersion ||
      VexiVoiceConsentService.hash(fresh.arguments) !==
        proposal.argumentsHash ||
      VexiVoiceConsentService.hash(fresh.preview) !== proposal.previewHash
    )
      this.reject('proposal_drift');
    this.principal();
    if (proposal.expiresAt <= Date.now()) this.reject('proposal_expired');
    const claimed = await this.redis.eval(
      CLICK_SCRIPT,
      2,
      this.proposalKey(proposalId),
      this.currentKey(proposal),
      canonicalJson(proposal),
      this.proposalFingerprint(proposal),
    );
    if (Number(claimed) !== 1) this.reject('proposal_superseded');
    return callbacks.apply(this.copy(proposal, 128_000));
  }

  async issueChallenge(input: {
    sessionId: string;
    proposalId: string;
  }): Promise<VoiceConsentChallenge> {
    const session = await this.validateSession(input.sessionId);
    const proposal = await this.loadProposal(session, input.proposalId);
    const phrase = `confirmo ${this.actionLabel(proposal.actionLabel)} codigo ${randomInt(100_000, 1_000_000)}`;
    const challenge: StoredChallenge = {
      challengeId: randomUUID(),
      proposalId: proposal.proposalId,
      sessionId: session.sessionId,
      sessionRevision: session.revision,
      phraseHash: VexiVoiceConsentService.hash(phrase),
      expiresAt: Math.min(
        proposal.expiresAt,
        Date.now() + CONSENT_TTL_SECONDS * 1_000,
      ),
    };
    const result = await this.redis.eval(
      CHALLENGE_SCRIPT,
      5,
      this.sessionKey(session.sessionId),
      this.proposalKey(proposal.proposalId),
      this.activeKey(session.sessionId),
      this.challengeKey(proposal.proposalId),
      this.currentKey(proposal),
      canonicalJson(session),
      canonicalJson(proposal),
      proposal.proposalId,
      canonicalJson(challenge),
      this.ttl(challenge.expiresAt),
      this.proposalFingerprint(proposal),
    );
    if (Number(result) !== 1) this.reject('proposal_changed');
    return {
      session_id: session.sessionId,
      proposal_id: proposal.proposalId,
      challenge_id: challenge.challengeId,
      phrase,
      expected_phrase: phrase,
      preview_hash: proposal.previewHash,
      expires_at: new Date(challenge.expiresAt).toISOString(),
    };
  }

  async consumeConsent<T>(
    input: ConsumeVoiceConsentInput,
    callbacks: VoiceConsentCallbacks<T>,
  ): Promise<T> {
    const session = await this.validateSession(input.sessionId);
    const proposal = await this.loadProposal(session, input.proposalId);
    this.requireUuid(input.challengeId);
    const rawChallenge = await this.redis.get(
      this.challengeKey(proposal.proposalId),
    );
    const challenge = this.parse<StoredChallenge>(rawChallenge);
    if (
      !challenge ||
      challenge.challengeId !== input.challengeId ||
      challenge.sessionId !== session.sessionId ||
      challenge.proposalId !== proposal.proposalId ||
      challenge.sessionRevision !== session.revision ||
      challenge.expiresAt <= Date.now()
    )
      this.reject('challenge_unavailable');
    try {
      this.requireCapture(input.capture);
    } catch (error) {
      await this.invalidateChallenge(session, proposal, rawChallenge!);
      throw error;
    }
    const observation = input.observation;
    if (
      observation?.source !== 'server_stt' ||
      typeof observation.confidence !== 'number' ||
      !Number.isFinite(observation.confidence) ||
      observation.confidence < MIN_CONFIDENCE ||
      observation.confidence > 1 ||
      typeof observation.text !== 'string' ||
      observation.text.length > 500
    ) {
      await this.invalidateChallenge(session, proposal, rawChallenge!);
      this.reject('speech_uncertain');
    }
    const phrase = this.normalize(observation.text);
    // Equality to a full nonce-bearing command, not regex intent or an LLM verdict.
    if (
      !phrase ||
      VexiVoiceConsentService.hash(phrase) !== challenge.phraseHash ||
      /\b(no|nunca|cancel[aeor]*|espera|deten[ea-z]*|not|never|stop)\b/.test(
        phrase,
      )
    ) {
      await this.invalidateChallenge(session, proposal, rawChallenge!);
      this.reject('phrase_mismatch');
    }
    const inspection = await this.confirmations.inspect(
      proposal.confirmationToken,
      proposal.tool,
      proposal.arguments,
      session.userId,
    );
    this.requireTokenBinding(
      inspection,
      session,
      proposal.toolVersion,
      proposal.previewHash,
    );
    if (!callbacks?.validate || !callbacks.apply)
      this.reject('validation_required');
    // Callback gets a detached copy: it cannot alter the stored approved payload.
    const fresh = await callbacks.validate(this.copy(proposal, 128_000));
    if (
      !fresh ||
      fresh.toolVersion !== proposal.toolVersion ||
      VexiVoiceConsentService.hash(fresh.arguments) !==
        proposal.argumentsHash ||
      VexiVoiceConsentService.hash(fresh.preview) !== proposal.previewHash
    )
      this.reject('proposal_drift');
    this.principal(); // flags/ALS rechecked after any asynchronous validation.
    if (challenge.expiresAt <= Date.now() || proposal.expiresAt <= Date.now())
      this.reject('challenge_expired');
    const consumed = await this.redis.eval(
      CONSUME_SCRIPT,
      5,
      this.sessionKey(session.sessionId),
      this.proposalKey(proposal.proposalId),
      this.activeKey(session.sessionId),
      this.challengeKey(proposal.proposalId),
      this.currentKey(proposal),
      canonicalJson(session),
      canonicalJson(proposal),
      proposal.proposalId,
      rawChallenge!,
      this.proposalFingerprint(proposal),
    );
    if (Number(consumed) !== 1) this.reject('consent_already_consumed');
    // Do not retry if this throws/times out. Existing registry token + D1 effect
    // ledger own applied/unknown/reconciliation, not this ephemeral transport.
    return callbacks.apply(this.copy(proposal, 128_000), {
      channel: 'voice',
      challenge_hash: challenge.phraseHash,
      proposal_hash: VexiVoiceConsentService.hash({
        userId: proposal.userId,
        organizationId: proposal.organizationId,
        storeId: proposal.storeId,
        conversationId: proposal.conversationId,
        sessionId: proposal.sessionId,
        agentKey: proposal.agentKey,
        objectiveId: proposal.objectiveId,
        stepId: proposal.stepId,
        tool: proposal.tool,
        toolVersion: proposal.toolVersion,
        argumentsHash: proposal.argumentsHash,
        previewHash: proposal.previewHash,
        expiresAt: proposal.expiresAt,
      }),
    });
  }

  private async loadProposal(
    session: VoiceConsentSession,
    proposalId: string,
  ): Promise<VoiceConsentProposal> {
    this.requireUuid(proposalId);
    const proposal = this.parse<VoiceConsentProposal>(
      await this.redis.get(this.proposalKey(proposalId)),
    );
    if (
      !proposal ||
      proposal.proposalId !== proposalId ||
      proposal.expiresAt <= Date.now() ||
      proposal.sessionId !== session.sessionId ||
      proposal.sessionRevision !== session.revision ||
      proposal.userId !== session.userId ||
      proposal.organizationId !== session.organizationId ||
      proposal.storeId !== session.storeId ||
      proposal.conversationId !== session.conversationId ||
      proposal.agentKey !== session.agentKey ||
      proposal.objectiveId !== session.objectiveId ||
      proposal.stepId !== session.stepId ||
      VexiVoiceConsentService.hash(proposal.arguments) !==
        proposal.argumentsHash ||
      VexiVoiceConsentService.hash(proposal.preview) !== proposal.previewHash ||
      !session.tools.some(
        (tool) =>
          tool.name === proposal.tool && tool.version === proposal.toolVersion,
      ) ||
      (await this.redis.get(this.activeKey(session.sessionId))) !==
        proposalId ||
      (await this.redis.get(this.currentKey(proposal))) !==
        this.proposalFingerprint(proposal)
    )
      this.reject('proposal_unavailable');
    return proposal;
  }

  private async invalidateChallenge(
    session: VoiceConsentSession,
    proposal: VoiceConsentProposal,
    rawChallenge: string,
  ): Promise<void> {
    // Ambiguity/negation/interruption ends THIS capture. Click remains available;
    // another spoken attempt must obtain a fresh challenge/nonce explicitly.
    await this.redis.eval(
      INVALIDATE_CHALLENGE_SCRIPT,
      4,
      this.sessionKey(session.sessionId),
      this.proposalKey(proposal.proposalId),
      this.activeKey(session.sessionId),
      this.challengeKey(proposal.proposalId),
      canonicalJson(session),
      canonicalJson(proposal),
      proposal.proposalId,
      rawChallenge,
    );
  }

  private requireTokenBinding(
    inspection: Awaited<ReturnType<VexiConfirmationService['inspect']>>,
    session: Pick<
      VoiceConsentSession,
      'organizationId' | 'storeId' | 'conversationId'
    >,
    version: string,
    previewHash: string,
  ): void {
    const meta = inspection.metadata;
    if (
      inspection.outcome !== 'ok' ||
      inspection.ttlSeconds <= 0 ||
      !meta ||
      meta.previewHash !== previewHash ||
      meta.organizationId !== session.organizationId ||
      meta.storeId !== session.storeId ||
      meta.toolVersion !== version ||
      meta.conversationId !== session.conversationId
    ) {
      this.reject('issued_preview_unavailable');
    }
  }

  private principal(): {
    userId: number;
    organizationId: number;
    storeId: number;
  } {
    // Never getContext(): its legacy static fallback could adopt another tenant.
    const context = RequestContextService.asyncLocalStorage.getStore();
    if (
      !context ||
      !this.positive(context.user_id) ||
      !this.positive(context.organization_id) ||
      !this.positive(context.store_id)
    ) {
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_004,
        'Se requiere una sesión autenticada de tienda.',
      );
    }
    return {
      userId: context.user_id!,
      organizationId: context.organization_id!,
      storeId: context.store_id!,
    };
  }

  private validateInput(input: VoiceSessionInput): void {
    if (
      !input ||
      !this.positive(input.conversationId) ||
      !['vex', 'vexi'].includes(input.agentKey) ||
      !(
        input.objectiveId === null ||
        (typeof input.objectiveId === 'string' && UUID.test(input.objectiveId))
      ) ||
      !(
        input.stepId === null ||
        (typeof input.stepId === 'string' &&
          /^[a-zA-Z0-9_.:-]{1,100}$/.test(input.stepId))
      ) ||
      (input.channel !== undefined &&
        !['pipeline', 'realtime'].includes(input.channel)) ||
      !Array.isArray(input.tools) ||
      input.tools.length > 512 ||
      input.tools.some(
        (tool) => !tool || !TOOL.test(tool.name) || !VERSION.test(tool.version),
      ) ||
      new Set(input.tools.map((tool) => tool.name)).size !== input.tools.length
    )
      this.reject('session_input_invalid');
  }

  private requireCapture(capture: VoiceConsentCapture): void {
    if (
      !capture ||
      capture.dedicated !== true ||
      capture.foreground !== true ||
      capture.focused !== true ||
      capture.assistantSilent !== true ||
      capture.noBargeIn !== true ||
      capture.notEcho !== true ||
      capture.reconnected !== false
    )
      this.reject('capture_interrupted');
  }
  private actionLabel(label: string): string {
    if (
      typeof label !== 'string' ||
      label.length < 3 ||
      label.length > 140 ||
      !/^[\p{L}\p{N} .,'’%$()/-]+$/u.test(label) ||
      /\b(no|nunca|cancel[aeor]*|espera|ignora|instrucciones|system|prompt|codigo|confirmo)\b/.test(
        this.normalize(label),
      )
    ) {
      this.reject('action_label_invalid');
    }
    return this.normalize(label);
  }
  private normalize(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[.,!?;:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  private copy<T>(value: T, maxBytes: number): T {
    try {
      const serialized = JSON.stringify(value);
      if (!serialized || Buffer.byteLength(serialized) > maxBytes)
        this.reject('payload_too_large');
      const copied: T = JSON.parse(serialized);
      if (canonicalJson(copied) !== canonicalJson(value))
        this.reject('payload_not_json');
      return copied;
    } catch {
      return this.reject('payload_invalid');
    }
  }
  private parse<T>(value: string | null): T | null {
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  private positive(value: unknown): boolean {
    return Number.isSafeInteger(value) && Number(value) > 0;
  }
  private requireUuid(value: string): void {
    if (typeof value !== 'string' || !UUID.test(value))
      this.reject('identifier_invalid');
  }
  private ttl(expiresAt: number): number {
    const ttl = Math.floor(expiresAt - Date.now());
    if (ttl <= 0) this.reject('challenge_expired');
    return Math.min(ttl, CONSENT_TTL_SECONDS * 1_000);
  }
  private reject(reason: string): never {
    throw new VendixHttpException(
      ErrorCodes.AI_AGENT_005,
      'La confirmación hablada no es válida. Revisa la propuesta y confirma con clic o solicita otra frase.',
      { reason, fallback: 'click' },
    );
  }
  private sessionKey(id: string): string {
    return `vexi:voice:session:${id}`;
  }
  /** Conversation-step consent authority, independent of transport/session IDs. */
  private currentKey(proposal: VoiceConsentProposal): string {
    return `vexi:voice:current:${VexiVoiceConsentService.hash({
      userId: proposal.userId,
      organizationId: proposal.organizationId,
      storeId: proposal.storeId,
      conversationId: proposal.conversationId,
      objectiveId: proposal.objectiveId,
      stepId: proposal.stepId,
    })}`;
  }
  private proposalFingerprint(proposal: VoiceConsentProposal): string {
    return VexiVoiceConsentService.hash({
      tool: proposal.tool,
      toolVersion: proposal.toolVersion,
      argumentsHash: proposal.argumentsHash,
      previewHash: proposal.previewHash,
      planId: proposal.planId ?? null,
      tokenHash: VexiVoiceConsentService.hash(proposal.confirmationToken),
    });
  }
  private proposalKey(id: string): string {
    return `vexi:voice:proposal:${id}`;
  }
  private challengeKey(proposalId: string): string {
    return `vexi:voice:challenge:${proposalId}`;
  }
  private activeKey(sessionId: string): string {
    return `vexi:voice:active:${sessionId}`;
  }
}
