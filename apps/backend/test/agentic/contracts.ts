/** Offline evaluation transport. Only a trusted domain/UI adapter may collect evidence. */
export type AgentOutcome =
  | 'completed_verified'
  | 'awaiting_approval'
  | 'awaiting_input'
  | 'blocked_permission'
  | 'blocked_plan'
  | 'not_found'
  | 'partial'
  | 'unknown_effect'
  | 'failed'
  | 'cancelled';
export type EvalMode = 'replay' | 'shadow' | 'live';
export type EvalSplit = 'dev' | 'holdout';
export type FactValue = string | number | boolean | null;
export type Facts = Record<string, FactValue>;
export interface EvalCase {
  id: string;
  corpusVersion: string;
  split: EvalSplit;
  agent: 'vex' | 'vexi';
  channel: 'text' | 'pipeline' | 'realtime';
  risk: 'read' | 'write' | 'ui' | 'security';
  request: string;
  persona:
    | 'owner'
    | 'admin'
    | 'operator'
    | 'blocked-owner'
    | 'revoked-operator';
  scope: { organizationId: number; storeId: number; userId: number };
  eligible: boolean;
  consented: boolean;
  baselineComparable: boolean;
  expectedOutcome: AgentOutcome;
  authority: 'server' | 'ui' | 'guard';
  expectedFacts: Facts;
  expectedFinalFacts: Facts;
  maxEffects: number;
  capabilities: string[];
}
export interface EvalFingerprint {
  providerFamily: string;
  model: string;
  promptHash: string;
  appKey: string;
  configHash: string;
  catalogHash: string;
  catalogVersion: string;
  featureFlagsHash: string;
  cacheCondition: 'cold' | 'warm' | 'unknown';
}
export interface ProviderAttempt {
  attemptId: string;
  providerCallId: string;
  billable: boolean | null;
  costUsd: number | null;
  /** Uncached input only; null unless the provider's usage semantics are known. */
  inputTokens: number | null;
  reportedInputTokens?: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreateTokens: number | null;
}
export interface EvalSpan {
  spanId: string;
  parentSpanId: string | null;
  kind:
    | 'root'
    | 'router'
    | 'context'
    | 'provider_request'
    | 'provider_attempt'
    | 'retry'
    | 'closing_inference'
    | 'tool'
    | 'ui_wait'
    | 'approval_wait'
    | 'verifier';
  providerCallId?: string;
  attemptId?: string;
  toolCallId?: string;
  /** Optional measured transport interval; root/wait arithmetic still uses wall-clock boundaries. */
  transportDurationMs?: number;
  startedAtMs: number;
  endedAtMs: number | null;
}
export interface EvalEvidence {
  authority: 'server' | 'ui' | 'guard' | 'model';
  traceId: string;
  fixtureFingerprint: string;
  scope: EvalCase['scope'];
  collectedAtMs: number;
  facts: Facts;
}
export interface EvalReceipt {
  schemaVersion: 1;
  caseId: string;
  repeat: number;
  corpusVersion: string;
  traceId: string;
  /** Phase A has no durable objective for every legacy turn. Unknown is null, never invented. */
  objectiveId: string | null;
  turnId: string;
  fixtureFingerprint: string;
  fingerprint: EvalFingerprint;
  outcome: AgentOutcome;
  claimedCompleted: boolean;
  finalFacts: Facts;
  evidence: EvalEvidence[];
  /** Entries come from authoritative post-run mutation audit, NOT tool dispatch events. */
  effects: {
    operationId: string;
    scope: EvalCase['scope'];
    authorized: boolean;
    consentValid: boolean;
  }[];
  violations: string[];
  providerAttempts: ProviderAttempt[];
  spans: EvalSpan[];
  logicalCalls: number;
  toolCalls: number;
  repeatedToolCalls: number;
  capabilities: string[];
  timings: {
    startedAtMs: number;
    endedAtMs: number;
    usefulContentAtMs: number | null;
    proposalAtMs: number | null;
    completionAtMs: number | null;
  };
  retrieval?: {
    relevant: string[];
    retrieved: string[];
    k: number;
    expansions: number;
    recipes: number;
  };
  /** Diagnostic only; never included in canonical cost. */
  logicalLogCostUsd?: number | null;
}
export interface EvalGrade {
  outcomeCorrect: boolean;
  completionVerified: boolean;
  falseSuccess: boolean;
  exactFinal: boolean;
  duplicateEffects: number;
  safetyViolations: number;
  traceComplete: boolean;
  reasons: string[];
}
export interface EvalRow {
  caseId: string;
  repeat: number;
  status: 'ran' | 'not_run';
  reason?: string;
  receipt?: EvalReceipt;
  grade?: EvalGrade;
}
