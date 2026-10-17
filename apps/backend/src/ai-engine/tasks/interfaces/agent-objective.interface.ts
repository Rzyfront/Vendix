import type { AgentPlan } from '../../interfaces/agent-plan.interface';
import type { ToolExecutionReceipt } from '../../tools/interfaces/tool.interface';

export const durableObjectivesEnabled = (): boolean =>
  process.env.AI_DURABLE_OBJECTIVES_ENABLED === 'true';

export interface ObjectiveScope {
  store_id: number;
  organization_id: number;
  user_id: number;
}

export type ObjectiveSemanticStatus =
  | 'active'
  | 'paused'
  | 'awaiting_approval'
  | 'awaiting_input'
  | 'partial'
  | 'blocked'
  | 'unknown_effect'
  | 'expired'
  | 'superseded'
  | 'cancelled'
  | 'completed_verified'
  | 'failed';

export interface ObjectiveBudget {
  provider_attempts: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number | null;
  tools: number;
  active_runtime_ms: number;
  expansions: number;
  recovery: number;
}

export const emptyObjectiveBudget = (): ObjectiveBudget => ({
  provider_attempts: 0,
  prompt_tokens: 0,
  completion_tokens: 0,
  cost_usd: 0,
  tools: 0,
  active_runtime_ms: 0,
  expansions: 0,
  recovery: 0,
});

export interface ObjectiveEntity {
  store_id: number;
  type: string;
  id: string | number;
  source_call_id: string;
  observed_at: string;
  valid_until?: string;
  resource_version?: string;
  facts?: Record<string, unknown>;
  /** These facts are never reusable to authorize a mutation. */
  volatile?: boolean;
}

export interface ObjectiveLease {
  version: number;
  lease_generation: number;
}

export interface AgentObjective extends ObjectiveScope, ObjectiveLease {
  id: string;
  conversation_id: number;
  agent_id: string | null;
  legacy_plan_id: string;
  goal: string;
  plan: AgentPlan | null;
  entities: ObjectiveEntity[];
  step_hashes: Record<string, unknown> | null;
  next_step: string | null;
  semantic_status: ObjectiveSemanticStatus;
  lease_until: Date | null;
  budget: ObjectiveBudget;
  authority_snapshot: string[];
  requires_revalidation: boolean;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface ObjectiveCheckpoint {
  plan?: AgentPlan;
  entities?: ObjectiveEntity[];
  next_step?: string | null;
  semantic_status?: Exclude<ObjectiveSemanticStatus, 'completed_verified'>;
  requires_revalidation?: boolean;
}

export interface AppendToolResultInput {
  tool_call_id: string;
  tool_name: string;
  tool_version?: string;
  args_hash: string;
  receipt: ToolExecutionReceipt;
  data: unknown;
  task_id?: number;
  /** Delta is deduplicated by tool_call_id, even when the lease is stale. */
  budget_delta?: Partial<ObjectiveBudget>;
  checkpoint?: ObjectiveCheckpoint;
}

export interface AgentToolResult extends ObjectiveScope {
  id: string;
  objective_id: string;
  task_id: number | null;
  tool_call_id: string;
  tool_name: string;
  tool_version: string;
  args_hash: string;
  receipt: ToolExecutionReceipt;
  data: unknown;
  /** listResults returns metadata only; getResult recovers the full artifact. */
  data_omitted?: boolean;
  pagination: ToolExecutionReceipt['pagination'];
  freshness: ToolExecutionReceipt['freshness'];
  resource_ids: ToolExecutionReceipt['resource_ids'];
  evidence_refs: string[];
  lease_generation: number | null;
  stale_lease: boolean;
  created_at: Date;
}

export type AgentEffectStatus =
  | 'proposed'
  | 'approved'
  | 'applying'
  | 'applied'
  | 'verified'
  | 'unknown'
  | 'failed';
export interface AgentEffect extends ObjectiveScope {
  id: string;
  objective_id: string;
  operation_id: string;
  proposal_hash: string;
  step_id: string;
  status: AgentEffectStatus;
  domain_receipt: Record<string, unknown> | null;
  domain_reference: string | null;
  evidence_result_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ResultPage {
  items: AgentToolResult[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface ObjectiveProgress {
  id: string;
  goal: string;
  conversation_id: number;
  version: number;
  semantic_status: string;
  next_step: string | null;
  budget: ObjectiveBudget;
  expires_at: string;
  requires_revalidation: boolean;
}
