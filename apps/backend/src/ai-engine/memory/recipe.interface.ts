import type {
  PlaybookInput,
  PlaybookStep,
} from '../playbooks/playbook.interface';
import type { ObjectiveScope } from '../tasks/interfaces/agent-objective.interface';

export const RECIPE_POLICY_VERSION =
  'declarative-f1-fresh-inputs-individual-approval';
export type RecipeStatus =
  | 'candidate'
  | 'reviewed'
  | 'approved'
  | 'deprecated'
  | 'quarantined';
export interface RecipeTemplate {
  kind: 'declarative';
  workflow: string;
  playbook: { id: string; version: string; hash: string };
  policy: string;
  industry: string[];
  inputs: PlaybookInput[];
  steps: PlaybookStep[];
  verifiers: Array<{ id: string; hash: string }>;
  tools: Array<{ name: string; version: string; hash: string }>;
  required_permissions: string[];
  preconditions: string[];
  known_failures: string[];
  examples: Array<{ kind: 'happy' | 'sad'; synthetic: true; expected: string }>;
}
export interface AgentRecipe {
  id: number;
  knowledge_scope: 'store' | 'global';
  organization_id: number | null;
  store_id: number | null;
  user_id: number | null;
  recipe_key: string;
  version: string;
  template: RecipeTemplate;
  content_hash: string;
  status: RecipeStatus;
  source_trace_ids: string[];
  source_objective_ids: string[];
  source_evidence_refs: string[];
  source_script_refs: string[];
  review: RecipeReview | null;
  review_history: RecipeReview[];
  approved_at: Date | null;
  expires_at: Date | null;
  usage_count: number;
  success_count: number;
  failure_count: number;
  invalidation_count: number;
  last_failure_code?: string | null;
  created_at: Date;
}
export interface RecipeReplay {
  fixture_hash: string;
  split: 'replay' | 'holdout';
  synthetic_tenant: string;
  provider: 'openai-compatible' | 'anthropic-compatible';
  model_fingerprint: string;
  verified: boolean;
  violations: number;
  duplicates: number;
  recipe_discovery_calls: number;
  control_discovery_calls: number;
  recipe_cost_usd: number;
  control_cost_usd: number;
  control_verified: boolean;
}
/** Signed by an OFFLINE quality authority after human review, never by the model/agent. */
export interface RecipeReview {
  stage: 'reviewed' | 'approved' | 'global';
  recipe_id: number;
  content_hash: string;
  reviewer_id: number;
  process_owner: string;
  reviewed_at: string;
  expires_at: string;
  evaluation_version: string;
  on_off_comparable: true;
  runs: RecipeReplay[];
  signature: string;
}
export interface RecipeMiningJob extends ObjectiveScope {
  objective_id: string;
}
export interface RecipeSession {
  readonly kind: 'recipe-turn';
}
export const recipeFallback = () => ({
  error_code: 'RECIPE_NOT_FOUND',
  error: 'Receta no disponible para este usuario, versión o configuración.',
  next_step:
    'Usa search_playbooks/load_playbook y lecturas actuales; cada escritura requiere una aprobación nueva.',
});
