import type { VexiToolExecution } from './vexi-api.service';
import type { VexiProposal } from '../store/vexi/vexi.actions';

export interface VoiceConsentContext {
  conversation_id: number;
  agent_key: 'vex' | 'vexi';
  channel: 'pipeline' | 'realtime';
  objective_id?: string;
  plan_id?: string;
  step_id?: string;
  /** Realtime registered proposal, browser-only; never forwarded to the model. */
  session_id?: string;
  proposal_id?: string;
}

export interface VoiceConsentChallenge {
  session_id: string;
  proposal_id: string;
  challenge_id: string;
  expected_phrase: string;
  expires_at: string | number;
  preview_hash?: string;
  /** Server-owned full action, quantities, values and irreversible consequence. */
  action_text?: string;
}

export interface VoiceConsentReceipt {
  tool: string;
  output: string;
  summary?: string | null;
  execution?: VexiToolExecution;
  audio_base64?: string;
  content_type?: string;
  step_status?: 'pending' | 'applied' | 'failed' | 'cancelled';
  plan_status?:
    | 'proposed'
    | 'approved'
    | 'rejected'
    | 'applied'
    | 'partially_applied';
}

export interface VoiceConsentApplied {
  context: VoiceConsentContext;
  confirmationToken: string;
  proposalArguments?: Record<string, unknown>;
  receipt: VoiceConsentReceipt;
}

export function voiceChallengeExpiry(value: string | number): number {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  return Date.parse(value);
}

/** Foreground is a necessary UI guard, never biometric authentication. */
export function voiceCaptureAllowed(input: {
  now: number;
  expiresAt: number;
  focused: boolean;
  visible: boolean;
  assistantSilent: boolean;
  epoch: number;
  expectedEpoch: number;
}): boolean {
  return (
    Number.isFinite(input.expiresAt) &&
    input.now < input.expiresAt &&
    input.focused &&
    input.visible &&
    input.assistantSilent &&
    input.epoch === input.expectedEpoch
  );
}

/** Exact proposal identity includes the displayed diff, not only the token. */
export function voiceProposalIdentity(
  proposal: VexiProposal,
  context: VoiceConsentContext,
): string {
  return JSON.stringify([
    context,
    proposal.tool,
    proposal.arguments,
    proposal.confirmationToken,
    proposal.preview,
  ]);
}

/** No elision: the readout must include every subject, value and warning. */
export function voiceProposalReadout(proposal: VexiProposal): string {
  const value = (item: unknown) =>
    typeof item === 'string' ? item : JSON.stringify(item ?? null);
  const preview = proposal.preview;
  return [
    preview?.target || proposal.tool,
    ...(preview?.changes ?? []).map(
      (change) =>
        `${change.label || change.field}: de ${value(change.from)} a ${value(change.to)}.`,
    ),
    preview?.message || '',
    'Revisa la consecuencia completa antes de confirmar. El dictado normal no autoriza cambios.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** A typed pending/unknown receipt must never become a green applied claim. */
export function voiceReceiptWasApplied(receipt: VoiceConsentReceipt): boolean {
  if (receipt.execution)
    return (
      receipt.execution.status === 'ok' &&
      receipt.execution.effect_status === 'applied' &&
      receipt.execution.freshness === 'observed'
    );
  if (receipt.step_status) return receipt.step_status === 'applied';
  return true; // Existing successful legacy apply ABI (no semantic envelope).
}

/** Only these context fields may cross the authenticated session boundary. */
export function voiceConsentSessionRequest(context: VoiceConsentContext) {
  return {
    conversation_id: context.conversation_id,
    agent_key: context.agent_key,
    channel: context.channel,
  };
}

/** Realtime authority stays opaque: never leak or re-submit its raw token/args as approval. */
export function voiceChallengeRequest(
  session_id: string,
  context: VoiceConsentContext,
  proposal: VexiProposal,
) {
  if (context.proposal_id)
    return { session_id, proposal_id: context.proposal_id };
  return {
    session_id,
    tool: proposal.tool,
    arguments: proposal.arguments,
    ...(proposal.confirmationToken
      ? { confirmation_token: proposal.confirmationToken }
      : {}),
    ...(context.plan_id ? { plan_id: context.plan_id } : {}),
  };
}

/** Only an explicit click calls this; a failed spoken attempt never auto-applies. */
export function voiceClickRequest(
  context: VoiceConsentContext,
): { session_id: string; proposal_id: string } | null {
  return context.session_id && context.proposal_id
    ? { session_id: context.session_id, proposal_id: context.proposal_id }
    : null;
}
