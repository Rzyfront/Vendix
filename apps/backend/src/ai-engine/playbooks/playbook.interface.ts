import type { CatalogMethod } from '../tools/bridge/api-catalog.service';

/** Vendix extensions live in an explicitly versioned JSON contract, not the skill standard. */
export interface PlaybookToolContract {
  name: string;
  version: string;
}
export interface PlaybookInput {
  key: string;
  required: boolean;
  source: 'user' | 'lookup';
  description: string;
}
export interface PlaybookStep {
  id: string;
  section: string;
  instruction: string;
  tool?: string;
  depends_on: string[];
  arguments?: Record<string, unknown>;
  approval: 'none' | 'individual';
  bridge?: { method: CatalogMethod; path: string };
}
/** Trusted caller supplies observations of domain reads, never the model's assertion of success. */
export interface PlaybookObservation {
  step_id: string;
  tool: string;
  status: 'ok' | 'error' | 'pending_confirmation' | 'unknown_effect';
  fresh: boolean;
  complete: boolean;
  after_step?: string;
  /** Captured validated arguments of the trusted read invocation, not inferred output IDs. */
  arguments?: Record<string, unknown>;
  artifact?: boolean;
  resource_ids: Record<string, string | number>;
  data: unknown;
  bridge?: { method: CatalogMethod; path: string };
}
export interface PlaybookExample {
  kind: 'happy' | 'sad';
  description: string;
  input: Record<string, unknown>;
  observations: PlaybookObservation[];
  expected: 'verified' | 'not_verified';
}
export interface PlaybookContract {
  schema_version: '1';
  mode: 'executable' | 'preparation_only';
  inputs: PlaybookInput[];
  steps: PlaybookStep[];
  examples: PlaybookExample[];
  gaps: string[];
}
export interface PlaybookMetadata {
  version: string;
  owner: string;
  industry: string[];
  workflow_key: string;
  tool_contracts: PlaybookToolContract[];
  required_permissions: string[];
  verifier_ids: string[];
}
export interface PlaybookSection {
  id: string;
  title: string;
  body: string;
  steps: PlaybookStep[];
}
export interface PlaybookDocument {
  id: string;
  name: string;
  description: string;
  metadata: PlaybookMetadata;
  contract: PlaybookContract;
  sections: PlaybookSection[];
  body: string;
  hash: string;
  source: string;
}
export interface PlaybookGap {
  playbook_id: string;
  code: string;
  detail: string;
  step_id?: string;
}
export interface PlaybookVerificationResult {
  verified: boolean;
  scope: 'preparation' | 'domain';
  evidence_step_ids: string[];
  reasons: string[];
}
export type PlaybookVerifier = (
  input: Record<string, unknown>,
  observations: PlaybookObservation[],
) => PlaybookVerificationResult;
