import type {
  ObjectiveLease,
  ObjectiveScope,
} from './interfaces/agent-objective.interface';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../domains/store/vexi/vexi-confirmation.service';

export interface AgentVerificationBinding
  extends ObjectiveScope, ObjectiveLease {
  objective_id: string;
  step_id: string;
}

export interface AgentVerifiedEvidence extends AgentVerificationBinding {
  evidence_refs: string[];
  workflows: string[];
  verified_at: string;
  contracts_hash: string;
}

/** Fixed economic inputs/step identities; artifact selectors are deliberately excluded. */
export function agentVerificationContractsHash(
  requests: ReadonlyArray<{
    workflow_key: string;
    step_id: string;
    inputs: Record<string, unknown>;
  }>,
): string {
  return createHash('sha256')
    .update(
      canonicalJson(
        requests
          .map(({ workflow_key, step_id, inputs }) => ({
            workflow_key,
            step_id,
            inputs,
          }))
          .sort(
            (a, b) =>
              a.step_id.localeCompare(b.step_id) ||
              a.workflow_key.localeCompare(b.workflow_key),
          ),
      ),
    )
    .digest('hex');
}

declare const verificationBrand: unique symbol;
/** Process-local authority. JSON, artifact IDs and model booleans cannot recreate it. */
export type AgentVerificationCapability = {
  readonly [verificationBrand]: true;
};

const issued = new WeakMap<
  object,
  { evidence: AgentVerifiedEvidence; expires: number }
>();
const MAX_AGE_MS = 30_000;

/** Only trusted verifier code calls this; never expose an issuing tool or endpoint. */
export function issueAgentVerification(
  evidence: AgentVerifiedEvidence,
): AgentVerificationCapability {
  const capability = Object.freeze({}) as AgentVerificationCapability;
  issued.set(capability, {
    evidence: structuredClone(evidence),
    expires: Date.now() + MAX_AGE_MS,
  });
  return capability;
}

/** Consume inside the repository's current lease/CAS fence, not before acquiring it. */
export function consumeAgentVerification(
  value: unknown,
  expected: AgentVerificationBinding,
): AgentVerifiedEvidence | null {
  if (!value || typeof value !== 'object') return null;
  const entry = issued.get(value);
  if (!entry) return null;
  issued.delete(value); // A failed/stale attempt cannot later resurrect the proof.
  if (Date.now() >= entry.expires) return null;
  for (const key of [
    'objective_id',
    'step_id',
    'store_id',
    'organization_id',
    'user_id',
    'version',
    'lease_generation',
  ] as const)
    if (entry.evidence[key] !== expected[key]) return null;
  return structuredClone(entry.evidence);
}
