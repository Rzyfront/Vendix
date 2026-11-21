import { createHash } from 'node:crypto';
import type {
  AIMessage,
  AIToolDefinition,
} from '../interfaces/ai-provider.interface';

export interface AgentContextBudgetOptions {
  contextWindowTokens: number;
  maxOutputTokens: number;
  safetyTokens?: number;
}

/** Not a tokenizer: a deliberately pessimistic byte-fallback estimate plus
 * per-message/schema overhead. Never report it as provider-observed tokens.
 * Remote images/audio have unknown tokenization and cannot be budgeted safely
 * here; the agent works with attachment references instead of binaries. */
export function estimateAgentInputTokens(
  messages: AIMessage[],
  tools: AIToolDefinition[],
): number {
  let estimate = 32;
  for (const message of messages) {
    if (
      Array.isArray(message.content) &&
      message.content.some((part) => part.type !== 'text')
    ) {
      throw new Error('AI_AGENT_CONTEXT_UNCOUNTED_MULTIMODAL');
    }
    estimate +=
      24 +
      Buffer.byteLength(
        JSON.stringify({
          role: message.role,
          content: message.content,
          ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
          ...(message.tool_call_id
            ? { tool_call_id: message.tool_call_id }
            : {}),
        }),
        'utf8',
      );
  }
  return (
    estimate +
    (tools.length ? 32 + Buffer.byteLength(JSON.stringify(tools), 'utf8') : 0)
  );
}

/** Defend semantic obligations even when a caller accidentally tags them as
 * historical. All systems, user intent, tool_use/result pairs and receipts stay.
 * Only explicitly dispensable old assistant prose can leave the context. */
const OBLIGATION =
  /confirmation|approval|propuest|confirmaci[oó]n|aprob|pendiente|objetiv|objective|evidence|evidencia|artifact|block_id|result_id|operation_id|receipt|verified|verific|unknown_effect|needs_user|awaiting|(?:\b|_)id\b|cufe|cursor|has_more|quantity|cantidad|precio|price|\b\d/iu;

export function historicalAssistantProse(message: AIMessage): boolean {
  return (
    message.role === 'assistant' &&
    !message.tool_calls?.length &&
    typeof message.content === 'string' &&
    !OBLIGATION.test(message.content)
  );
}

export function applyAgentContextBudget(
  messages: AIMessage[],
  tools: AIToolDefinition[],
  options: AgentContextBudgetOptions,
): {
  messages: AIMessage[];
  estimatedInputTokens: number;
  omittedMessages: number;
  method: 'conservative_estimate';
} {
  const { contextWindowTokens, maxOutputTokens } = options;
  const safety =
    options.safetyTokens ??
    Math.max(1024, Math.ceil(contextWindowTokens * 0.1));
  if (
    ![contextWindowTokens, maxOutputTokens, safety].every(
      (n) => Number.isFinite(n) && n >= 0,
    ) ||
    contextWindowTokens < 1 ||
    maxOutputTokens + safety >= contextWindowTokens
  ) {
    throw new Error('AI_AGENT_CONTEXT_INVALID_BUDGET');
  }
  const available = contextWindowTokens - maxOutputTokens - safety;
  const original = estimateAgentInputTokens(messages, tools);
  if (original <= available)
    return {
      messages: [...messages],
      estimatedInputTokens: original,
      omittedMessages: 0,
      method: 'conservative_estimate',
    };
  const candidates = messages.flatMap((message, index) =>
    message.context_retention === 'history' && historicalAssistantProse(message)
      ? [index]
      : [],
  );
  // Recent prose is useful for conversational coherence, even when dispensable.
  const removable = candidates.slice(0, -2);
  const omitted = new Set<number>();
  const refs: string[] = [];
  let output = [...messages];
  let estimate = original;
  for (const index of removable) {
    omitted.add(index);
    refs.push(
      `${index}:${createHash('sha256').update(JSON.stringify(messages[index].content)).digest('hex')}`,
    );
    const notice: AIMessage = {
      role: 'assistant',
      content: JSON.stringify({
        historical_prose_omitted: true,
        history_refs: refs,
        complete: false,
        next_action:
          'Solo se omitió prosa histórica auxiliar; estas referencias son índices y hashes, no evidencia ni autoridad. Consulta el historial de conversación si necesitas el texto original.',
      }),
    };
    const first = Math.min(...omitted);
    output = messages.flatMap((message, i) =>
      i === first ? [notice] : omitted.has(i) ? [] : [message],
    );
    estimate = estimateAgentInputTokens(output, tools);
    if (estimate <= available) break;
  }
  if (estimate > available)
    throw new Error('AI_AGENT_CONTEXT_REQUIRED_OVERFLOW');
  return {
    messages: output,
    estimatedInputTokens: estimate,
    omittedMessages: omitted.size,
    method: 'conservative_estimate',
  };
}

/** Window the engine assumes when the application row configures none. */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 32768;

export interface ContextBudgetReport {
  estimated_input_tokens: number;
  omitted_messages: number;
  context_window_tokens: number;
  provenance: 'configured' | 'fallback';
  method: 'conservative_estimate';
}

/** Estimate-only budget for turns that did not run through the agentic engine
 * path: same estimator, default window, provenance `fallback`. */
export function estimateContextBudget(
  messages: AIMessage[],
  contextWindowTokens: number = DEFAULT_CONTEXT_WINDOW_TOKENS,
): ContextBudgetReport {
  return {
    estimated_input_tokens: estimateAgentInputTokens(messages, []),
    omitted_messages: 0,
    context_window_tokens: contextWindowTokens,
    provenance: 'fallback',
    method: 'conservative_estimate',
  };
}

export const TURN_ACTIONS_LINE_MAX_CHARS = 300;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toolCallFailed(call: Record<string, unknown>): boolean {
  const execution = asRecord(call.execution);
  if (execution && typeof execution.status === 'string') {
    return execution.status !== 'ok';
  }
  const result = call.result;
  if (typeof result === 'string') {
    return /"success"\s*:\s*false|"error"\s*:/.test(result.slice(0, 400));
  }
  const record = asRecord(result);
  return !!record && (record.success === false || 'error' in record);
}

/** Pure, bounded one-liner of what a past assistant turn did (tool names with
 * ok/error, Vex block ids/kinds/rows). Never includes arguments, results or
 * confirmation tokens. `null` when the turn did nothing worth recalling. */
export function renderTurnActionsLine(
  toolCalls: unknown,
  metadata: unknown,
): string | null {
  const tools: string[] = [];
  if (Array.isArray(toolCalls)) {
    for (const raw of toolCalls) {
      const call = asRecord(raw);
      if (!call || typeof call.name !== 'string') continue;
      tools.push(`${call.name} (${toolCallFailed(call) ? 'error' : 'ok'})`);
    }
  }
  const blocks: string[] = [];
  const rawBlocks = asRecord(metadata)?.blocks;
  if (Array.isArray(rawBlocks)) {
    for (const raw of rawBlocks) {
      const block = asRecord(raw);
      if (!block || typeof block.block_id !== 'string') continue;
      const kind = typeof block.kind === 'string' ? block.kind : 'block';
      const rows =
        typeof block.rows === 'number'
          ? block.rows
          : typeof block.row_count === 'number'
            ? block.row_count
            : null;
      blocks.push(
        `${kind}#${block.block_id.slice(0, 8)}${rows !== null ? ` (${rows} filas)` : ''}`,
      );
    }
  }
  if (tools.length === 0 && blocks.length === 0) return null;
  const parts: string[] = [];
  if (tools.length) parts.push(`Acciones de este turno: ${tools.join(', ')}`);
  if (blocks.length) parts.push(`Bloques: ${blocks.join(', ')}`);
  const line = `[${parts.join(' · ')}]`;
  if (line.length <= TURN_ACTIONS_LINE_MAX_CHARS) return line;
  return `${line.slice(0, TURN_ACTIONS_LINE_MAX_CHARS - 2).trimEnd()}…]`;
}
