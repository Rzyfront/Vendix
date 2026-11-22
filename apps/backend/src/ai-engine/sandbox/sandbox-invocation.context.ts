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

/** Execute and persist precisely this normalized source (LF + NFC). */
export function normalizeSandboxSource(source: string): string {
  return source.replace(/\r\n?/g, '\n').normalize('NFC');
}

/** Generated source may contain PII: public SSE/transcript carries a hash, not source. */
export function publicSandboxArgs(
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (name === 'run_analysis') {
    return {
      source_hash: createHash('sha256')
        .update(normalizeSandboxSource(String(args.source ?? '')))
        .digest('hex'),
      conversation_id: args.conversation_id,
      inputs: args.inputs,
      purpose: args.purpose,
      title: args.title,
      source_omitted: true,
    };
  }
  if (name === 'run_code') {
    // F10: Code Mode source is encrypted in the audit (owner, 7 days); SSE,
    // transcript and generic tool logs carry only its hash.
    return {
      source_hash: createHash('sha256')
        .update(normalizeSandboxSource(String(args.source ?? '')))
        .digest('hex'),
      tools: args.tools,
      purpose: args.purpose,
      source_omitted: true,
    };
  }
  if (name !== 'run_readonly_script') return args;
  return {
    source_hash: createHash('sha256')
      .update(normalizeSandboxSource(String(args.source ?? '')))
      .digest('hex'),
    language: args.language,
    tools: args.tools,
    purpose: args.purpose,
    source_omitted: true,
  };
}
