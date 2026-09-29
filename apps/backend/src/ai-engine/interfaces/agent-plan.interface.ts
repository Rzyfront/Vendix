/**
 * Internal task list of an agent turn chain.
 *
 * The plan is cognitive scaffolding, never product surface: it is persisted in
 * `ai_conversations.metadata.agent_plan` so it survives the turn boundaries a
 * write approval or a clarifying question impose, and it is fed back to the
 * model on every turn so the model never re-derives what is left. It is never
 * rendered, streamed or narrated to the person.
 */
export type AgentPlanStatus =
  | 'active'
  | 'paused'
  | 'done'
  | 'superseded'
  | 'abandoned';

export type AgentPlanStepStatus =
  | 'pending'
  | 'in_progress'
  | 'done'
  | 'failed'
  | 'rejected'
  | 'waiting_user'
  | 'skipped';

export interface AgentPlanDeliverable {
  id: string;
  description: string;
  verified: boolean;
  /** Real value read from the system (id, number, state) proving it exists. */
  evidence?: string;
}

export interface AgentPlanStep {
  order: number;
  title: string;
  kind: 'verificacion' | 'cambio';
  /** Verifiable criterion that makes this step done. */
  done_when: string;
  status: AgentPlanStepStatus;
  evidence?: string;
  note?: string;
  /** Only while `waiting_user`: the question asked. */
  question?: string;
  attempts: number;
}

export interface AgentPlan {
  id: string;
  status: AgentPlanStatus;
  goal: string;
  deliverables: AgentPlanDeliverable[];
  steps: AgentPlanStep[];
  created_at: string;
  updated_at: string;
}

/** Names of the plan tools the agent loop intercepts when a hook is present. */
export const AGENT_PLAN_TOOLS = [
  'propose_plan',
  'update_plan_step',
  'verify_deliverables',
  'ask_user',
  'revise_plan',
  'pause_plan',
  'resume_plan',
] as const;

export type AgentPlanToolName = (typeof AGENT_PLAN_TOOLS)[number];

export function isAgentPlanTool(name: string): name is AgentPlanToolName {
  return (AGENT_PLAN_TOOLS as readonly string[]).includes(name);
}

export interface AgentPlanToolOutcome {
  /** Tool result handed back to the model (JSON string). */
  result: string;
  /**
   * Set by `ask_user`: the turn ends and `text` is what the person reads.
   * The loop yields it as the turn's final text.
   */
  endTurn?: { text: string };
}

/**
 * Bridge between the agent loop (which knows nothing about conversations) and
 * the plan persisted for one conversation. Built per turn by the chat surface;
 * absent on surfaces with no conversation (background queue, MCP, voice
 * bridge), where the planning tools fall back to their stateless handlers.
 */
export interface AgentPlanHook {
  execute(
    name: AgentPlanToolName,
    args: Record<string, any>,
  ): Promise<AgentPlanToolOutcome>;
  /** The plan if its status is `active`, else null. */
  snapshot(): Promise<AgentPlan | null>;
}
