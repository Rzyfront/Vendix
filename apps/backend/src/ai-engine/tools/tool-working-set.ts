/**
 * Dynamic tool working set («el mecánico»): pure helpers, no I/O.
 *
 * The model receives a small fixed core plus the tools LOADED for this turn,
 * not the whole authorized catalog (prod 2026-10: ~220 tools ≈ 80k prompt
 * tokens per call). Relevance only decides what is loaded; authority is
 * resolved elsewhere and every name here is intersected with it. An authorized
 * tool that is not loaded stays callable: the loop loads and runs it in the
 * same round (hard rule), so loading is an optimization, never a permission.
 */
export const TOOL_WORKING_SET = {
  /** Operational tools loaded at turn start (history + prefetch). */
  maxLoaded: 30,
  /** D1: per-message prefetch, top-K with a relative score threshold. */
  prefetchTop: 8,
  prefetchRelativeScore: 0.35,
  /** D2: search_tools loads this many by default, never more than searchMax. */
  searchDefault: 5,
  searchMax: 10,
  /** Tools used in the last N user turns are reloaded from the history. */
  historyTurns: 3,
  /** Below this ready-index coverage the router serves the full catalog. */
  minCoverage: 0.9,
  /** Prefetch budget before cascading to the full catalog. */
  prefetchTimeoutMs: 3000,
} as const;

/**
 * Discovery always in hand. The other discovery tools (playbooks, recipes,
 * list_endpoints) stay callable through the hard rule and the shop index.
 */
export const CORE_DISCOVERY: readonly string[] = [
  'search_tools',
  'list_capabilities',
  'call_endpoint',
  'write_endpoint',
  'explain_capability',
];

/**
 * Names with evidence, best first, whose score is ≥ ratio × best score.
 * Ties break by name so the same scores always yield the same list.
 */
export function relevantTop(
  scores: Readonly<Record<string, number>>,
  limit: number = TOOL_WORKING_SET.prefetchTop,
  ratio: number = TOOL_WORKING_SET.prefetchRelativeScore,
): string[] {
  const ranked = Object.entries(scores)
    .filter(([, score]) => Number.isFinite(score) && score > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  if (!ranked.length) return [];
  const floor = ranked[0][1] * ratio;
  return ranked
    .filter(([, score]) => score >= floor)
    .slice(0, Math.max(0, limit))
    .map(([name]) => name);
}

interface HistoryMessage {
  role?: string;
  tool_calls?: Array<{ function?: { name?: string } }>;
}

/** Index where the last `turns` user turns start (0 if there are fewer). */
function windowStart(
  list: readonly { role?: string }[],
  turns: number,
): number {
  let seen = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role !== 'user') continue;
    seen++;
    if (seen === turns) return i;
  }
  return 0;
}

/** Appends a name once, ignoring anything that is not a non-empty string. */
function pushName(names: string[], name: unknown): void {
  if (typeof name === 'string' && name && !names.includes(name))
    names.push(name);
}

/**
 * Tool names called in the last `turns` user turns, oldest first, deduped.
 * The working set is rebuilt from the history every turn (no DB state): a
 * resumed or legacy conversation recovers its tools, and a topic change
 * naturally drops what was not used recently.
 */
export function recentToolNames(
  messages: readonly HistoryMessage[] | undefined,
  turns: number = TOOL_WORKING_SET.historyTurns,
): string[] {
  const list = messages ?? [];
  const names: string[] = [];
  for (const message of list.slice(windowStart(list, turns)))
    for (const call of message?.tool_calls ?? [])
      pushName(names, call?.function?.name);
  return names;
}

/** A persisted `ai_messages` row as the chat loads it (`tool_calls` is JSON). */
interface StoredHistoryMessage {
  role?: string;
  tool_calls?: unknown;
}

/**
 * Lo mismo que `recentToolNames`, pero sobre las filas persistidas de
 * `ai_messages`, donde `tool_calls` se guarda como `[{ name, arguments, result }]`
 * y no con `function.name`.
 *
 * Existe porque el historial que el chat le pasa al agente lleva solo
 * `{ role, content }`: inyectar ahí los `tool_calls` sin sus resultados rompería
 * el protocolo de tool calls del proveedor, así que el chat calcula los nombres
 * aparte y los pasa en `recent_tool_names`. Sin esto el seguimiento («y con
 * tarjeta») perdía la tool del turno anterior y el modelo adivinaba rutas
 * (E2E g18). Tolera también la forma `function.name` por si una fila la trae.
 */
export function recentStoredToolNames(
  messages: readonly StoredHistoryMessage[] | undefined,
  turns: number = TOOL_WORKING_SET.historyTurns,
): string[] {
  const list = messages ?? [];
  const names: string[] = [];
  for (const message of list.slice(windowStart(list, turns))) {
    const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    for (const call of calls) {
      if (!call || typeof call !== 'object') continue;
      const record = call as {
        name?: unknown;
        function?: { name?: unknown } | null;
      };
      pushName(names, record.name ?? record.function?.name);
    }
  }
  return names;
}

/**
 * Appends `incoming` to `loaded` (append-only, preserves load order), skipping
 * core, unauthorized and already loaded names. `cap` bounds the operational
 * loaded count; `null` means uncapped (hard rule: a call must always load).
 * Returns the names actually appended.
 */
export function appendLoaded(
  loaded: string[],
  incoming: readonly string[],
  authorized: ReadonlySet<string>,
  core: ReadonlySet<string>,
  cap: number | null = TOOL_WORKING_SET.maxLoaded,
): string[] {
  const added: string[] = [];
  for (const name of incoming) {
    if (cap !== null && loaded.length >= cap) break;
    if (!authorized.has(name) || core.has(name) || loaded.includes(name))
      continue;
    loaded.push(name);
    added.push(name);
  }
  return added;
}

/**
 * Final tool order: `[core sorted by name] + [loaded in load order]`. The core
 * prefix is byte-stable across rounds and turns (prompt caching); loads only
 * append. Every name is intersected with the authorized set.
 */
export function composeWorkingSet(
  core: readonly string[],
  loaded: readonly string[],
  authorized: ReadonlySet<string>,
): { core: string[]; loaded: string[] } {
  const coreNames = [...new Set(core)]
    .filter((name) => authorized.has(name))
    .sort((a, b) => a.localeCompare(b));
  const coreSet = new Set(coreNames);
  const loadedNames = [...new Set(loaded)].filter(
    (name) => authorized.has(name) && !coreSet.has(name),
  );
  return { core: coreNames, loaded: loadedNames };
}

/**
 * Natural-language signature of a tool for an invalid-args recovery on a tool
 * the model called without having its definition loaded (hard rule).
 */
export function describeToolSignature(
  parameters: Record<string, unknown> | undefined,
): string {
  const properties = (parameters?.properties ?? {}) as Record<
    string,
    { type?: unknown; description?: unknown }
  >;
  const required = new Set(
    Array.isArray(parameters?.required)
      ? (parameters!.required as string[])
      : [],
  );
  const fields = Object.entries(properties)
    .slice(0, 12)
    .map(([name, schema]) => {
      const type = typeof schema?.type === 'string' ? schema.type : 'valor';
      return `${name} (${type}${required.has(name) ? ', obligatorio' : ''})`;
    });
  return fields.length
    ? `Campos que acepta: ${fields.join(', ')}.`
    : 'No necesita campos.';
}
