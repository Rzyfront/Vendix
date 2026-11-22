import { AsyncLocalStorage } from 'node:async_hooks';
import type { AgentDurableSession } from '../tasks/agent-durable-session.service';

/**
 * F10 (T64): what the Code Mode bridge needs from the turn that offers
 * `run_code`. Only the authenticated agent loop can supply it (T65): it is
 * never reachable from tool args, so a script can never widen its own
 * authority.
 *
 * Scripts also run in NORMAL turns, so the durable objective is optional.
 */
export interface CodeModeInvocation {
  agentKey: string;
  /** Tool names authorized in THIS turn (permissions ∩ plan ∩ agent). */
  initialNames: string[];
  /** Re-derives the turn's authorized tool names (permissions may change). */
  revalidate(): Promise<string[]>;
  /** Present only inside durable (objective) turns. */
  durable?: AgentDurableSession;
  /**
   * Meters one action per successful inner call, the same rule as a direct
   * tool call (§F10.3 e). The `run_code` wrapper itself is not metered.
   */
  onToolSuccess?(seq: number, tool: string): Promise<void>;
}

export const codeModeInvocation = new AsyncLocalStorage<CodeModeInvocation>();
