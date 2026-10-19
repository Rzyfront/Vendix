import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { AgentDurableSession } from '../tasks/agent-durable-session.service';
import type { ToolExecutionResult } from '../tools/interfaces/tool.interface';

/** Only the authenticated agent loop can supply this capability. Never tool args. */
export interface SandboxInvocation {
  agentKey: string;
  initialNames: string[];
  durable: AgentDurableSession;
  revalidate(): Promise<string[]>;
  record(
    seq: number,
    tool: string,
    args: Record<string, unknown>,
    result: ToolExecutionResult,
  ): Promise<string>;
}
export const sandboxInvocation = new AsyncLocalStorage<SandboxInvocation>();

/** Generated source may contain PII: public SSE/transcript carries a hash, not source. */
export function publicSandboxArgs(
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (name !== 'run_readonly_script') return args;
  return {
    source_hash: createHash('sha256')
      .update(
        String(args.source ?? '')
          .replace(/\r\n?/g, '\n')
          .normalize('NFC'),
      )
      .digest('hex'),
    language: args.language,
    tools: args.tools,
    purpose: args.purpose,
    source_omitted: true,
  };
}
