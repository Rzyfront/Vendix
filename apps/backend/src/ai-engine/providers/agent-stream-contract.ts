import type {
  AIToolCall,
  AIToolDefinition,
  AIResponse,
} from '../interfaces/ai-provider.interface';
import { validateToolArgs } from '../tools/tool-args.validator';

/** A missing/invalid provider counter is not a measured zero. */
export function reportedAgentUsage(
  usage: AIResponse['usage'],
): AIResponse['usage'] {
  if (!usage) return undefined;
  const valid = (value: number) => Number.isSafeInteger(value) && value >= 0;
  if (
    ![usage.promptTokens, usage.completionTokens, usage.totalTokens].every(
      valid,
    ) ||
    (usage.cacheReadTokens !== undefined && !valid(usage.cacheReadTokens)) ||
    (usage.cacheCreationTokens !== undefined &&
      !valid(usage.cacheCreationTokens)) ||
    usage.totalTokens !==
      usage.promptTokens +
        usage.completionTokens +
        (usage.cacheReadTokens ?? 0) +
        (usage.cacheCreationTokens ?? 0)
  )
    return undefined;
  return usage;
}

/** Stable order only: this never widens the caller's authorized working set. */
export function canonicalAgentTools(
  tools: AIToolDefinition[] | undefined,
): AIToolDefinition[] | undefined {
  if (!tools) return undefined;
  const names = new Set<string>();
  for (const tool of tools) {
    if (!tool.function.name || names.has(tool.function.name))
      throw new Error('Duplicate or missing offered tool name');
    names.add(tool.function.name);
  }
  // Order is the caller's contract: [sorted core] + [loaded in load order].
  // Re-sorting here would move the core prefix and break prompt caching.
  return [...tools];
}

/** Validate the entire batch before exposing even its first executable call. */
export function validateAgentToolCalls(
  calls: AIToolCall[],
  tools: AIToolDefinition[] | undefined,
): AIToolCall[] {
  const ids = new Set<string>();
  const offered = new Map(
    (tools ?? []).map((tool) => [tool.function.name, tool]),
  );
  const normalized: AIToolCall[] = [];
  for (const call of calls) {
    const suppliedName = call.function?.name;
    // Match the registry's compatible-provider namespace normalization, but
    // resolve only against this inference's offered working set, never a wider
    // global registry or a fuzzy/guessed alias.
    const suffix = suppliedName?.slice(suppliedName.lastIndexOf('.') + 1);
    const name = offered.has(suppliedName) ? suppliedName : suffix;
    if (
      !call.id ||
      ids.has(call.id) ||
      call.type !== 'function' ||
      !offered.has(name)
    )
      throw new Error('Invalid or unoffered completed tool call');
    ids.add(call.id);
    let args: unknown;
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      throw new Error('Completed tool arguments are not valid JSON');
    }
    if (!args || typeof args !== 'object' || Array.isArray(args))
      throw new Error('Completed tool arguments must be an object');
    // Same supported schema subset as the registry. Parse creates a private
    // copy because the edge validator coerces numeric strings in place.
    const validation = validateToolArgs(
      name,
      offered.get(name)!.function.parameters,
      args as Record<string, unknown>,
    );
    if (!validation.ok)
      throw new Error('Completed tool arguments violate the offered schema');
    normalized.push({
      ...call,
      function: { ...call.function, name, arguments: JSON.stringify(args) },
    });
  }
  return normalized;
}
