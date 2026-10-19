import { Injectable } from '@nestjs/common';
import { AIToolDefinition } from '../interfaces/ai-provider.interface';
import { isAgentPlanTool } from '../interfaces/agent-plan.interface';
import { KnowledgeSearchService } from '../embeddings/knowledge-search.service';
import { AIToolRegistry } from './ai-tool-registry';
import {
  buildToolManifest,
  catalogHash,
  localToolScores,
  ToolDocument,
} from './tool-catalog';
import {
  appendLoaded,
  composeWorkingSet,
  CORE_DISCOVERY,
  relevantTop,
  TOOL_WORKING_SET,
} from './tool-working-set';

const DISCOVERY = new Set([
  'search_tools',
  'search_playbooks',
  'load_playbook',
  'search_recipes',
  'load_recipe',
  'list_capabilities',
  'list_endpoints',
  // Bridge + capability detail: the prompts send the model to list_endpoints →
  // call_endpoint/write_endpoint and list_capabilities → explain_capability.
  // Offering the map without the way to use it produced AI_AGENT_TOOL_NOT_OFFERED
  // on every bridge call (P0-7). Still authorization-filtered like all scaffold;
  // write_endpoint keeps its mandatory confirmation.
  'call_endpoint',
  'write_endpoint',
  'explain_capability',
]);
/**
 * Fixed per-agent core: every business tool the agent's system prompt names by
 * exact identifier (Vexi: `chat_assistant` seed + migración
 * 20260803234500_vexi_documentos_y_agente_integral; Vex: `vex_render_*` in
 * 20261001120000_vex_agent_registration). The prompt orders the model to call
 * them, so they are always in hand (with CORE_DISCOVERY).
 *
 * Loading only, never a grant: every name is intersected with the authorized
 * definitions of the turn (permissions ∩ plan ∩ agent allowed − denied).
 * Discovery and plan tools are never listed here.
 */
export const AGENT_TOOL_CORE: Readonly<Record<string, readonly string[]>> = {
  vexi: [
    'ui_navigate',
    'ui_refresh',
    'ui_pos_checkout',
    'get_report',
    'queue_task',
    'bulk_prepare',
    'ai_extract_document',
    'validate_extraction',
  ],
  vex: [
    'vex_render_table',
    'vex_render_chart',
    'vex_render_kpi',
    'vex_render_image',
    'vex_render_file',
    'vex_block_read',
    'vex_block_transform',
  ],
};
/**
 * The engine treats a missing agent_key as Vexi (`params.agent_key ?? 'vexi'`);
 * an unknown explicit key gets no agent core (discovery core + loaded only).
 */
export function agentToolCore(agent: string | undefined): readonly string[] {
  return AGENT_TOOL_CORE[agent ?? 'vexi'] ?? [];
}
const MIN_PLAN = new Set(['propose_plan', 'ask_user']);
/**
 * Per-turn routing state. Plain JSON on purpose: the voice surface clones it
 * with JSON.stringify and persists it with the consent session.
 */
export interface ToolRoutingSession {
  query: string;
  signature: string;
  /** Active playbook/plan dependencies; loaded when authorized (D4). */
  dependencies: string[];
  /** Tools executed in this turn or recovered from the recent history. */
  used: string[];
  /** Operational tools loaded in this turn, in load order (append-only). */
  loaded: string[];
  /** agent_key of the turn; selects the fixed core. Undefined = Vexi. */
  agent?: string;
  /** D1 prefetch already ran for this turn. */
  prefetched?: boolean;
  /** Reason the turn serves the full authorized catalog (cascade floor). */
  fullCatalog?: string;
  retrieval?: {
    source: string;
    coverage: number;
    prefetchHits: number;
    degraded: string[];
  };
  /** Hard-rule hits: authorized tool called without being loaded (D3). */
  unloadedAuthorizedCalls: number;
  lastSearch?: { query: string; names: string[] };
}
export interface ToolRouterSelection {
  definitions: AIToolDefinition[];
  operationalCount: number;
  coreCount: number;
  loadedCount: number;
  degraded: string[];
  catalogHash: string;
  retrievalSource: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('ROUTER_TIMEOUT')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

@Injectable()
export class ToolRouterService {
  constructor(
    private readonly registry: AIToolRegistry,
    private readonly knowledge: KnowledgeSearchService,
  ) {}

  /**
   * `history`: tool names used in the recent turns (see recentToolNames). They
   * are reloaded first, so a follow-up («sí, dale») keeps its tools.
   */
  createSession(
    query: string,
    signature: string,
    dependencies: string[] = [],
    agent?: string,
    options: { history?: string[] } = {},
  ): ToolRoutingSession {
    const history = (options.history ?? []).map((n) =>
      this.registry.canonicalName(n),
    );
    // Keep the most recent ones when the history alone exceeds the room left
    // for the prefetch (topic change drops the oldest unused first).
    const room = TOOL_WORKING_SET.maxLoaded - TOOL_WORKING_SET.prefetchTop;
    return {
      query: query.slice(0, 500),
      signature,
      dependencies,
      used: [...new Set(history)],
      loaded: [...new Set(history)].slice(-room),
      agent,
      unloadedAuthorizedCalls: 0,
    };
  }

  private documents(definitions: AIToolDefinition[]): {
    docs: ToolDocument[];
    hash: string;
  } {
    const authorized = new Set(
      definitions.map((d) => this.registry.canonicalName(d.function.name)),
    );
    const manifest = buildToolManifest(this.registry);
    return {
      docs: manifest.documents.filter((d) => authorized.has(d.name)),
      hash: manifest.hash,
    };
  }

  private operational(docs: ToolDocument[]): ToolDocument[] {
    return docs.filter(
      (d) => !DISCOVERY.has(d.name) && !isAgentPlanTool(d.name),
    );
  }

  /** Each name followed by its declared discovery dependencies (deduped). */
  private withDependencies(names: readonly string[]): string[] {
    const byName = new Map(
      buildToolManifest(this.registry).documents.map((d) => [d.name, d]),
    );
    const out: string[] = [];
    for (const name of names)
      for (const n of [name, ...(byName.get(name)?.dependencies ?? [])]) {
        const canonical = this.registry.canonicalName(n);
        if (!out.includes(canonical)) out.push(canonical);
      }
    return out;
  }

  private coreNames(agent: string | undefined): string[] {
    return [...CORE_DISCOVERY, ...agentToolCore(agent)].map((n) =>
      this.registry.canonicalName(n),
    );
  }

  /**
   * D1: one hybrid search per turn over the message (+ active goal) before
   * the first inference. Loads the top-8 with score ≥ 0.35 × top-1. The turn
   * cascades to the FULL authorized catalog (the #934 floor) when the index
   * covers < 90 % of the authorized tools, the search errors or times out, or
   * no layer finds evidence and the history brought nothing to work with.
   */
  async prefetch(
    session: ToolRoutingSession,
    authorizedDefinitions: AIToolDefinition[],
  ): Promise<void> {
    if (session.prefetched) return;
    session.prefetched = true;
    const { docs } = this.documents(authorizedDefinitions);
    const operational = this.operational(docs);
    const authorized = new Set(operational.map((d) => d.name));
    const core = new Set(this.coreNames(session.agent));
    if (!operational.length) {
      session.retrieval = {
        source: 'none',
        coverage: 0,
        prefetchHits: 0,
        degraded: [],
      };
      return;
    }
    try {
      const result = await withTimeout(
        this.knowledge.rank(session.query, operational, session.signature),
        TOOL_WORKING_SET.prefetchTimeoutMs,
      );
      const coverage = result.coverage ?? 0;
      // Threshold relative to the best LOADABLE tool: a core tool (always in
      // hand) at top-1 must not push every real candidate under the bar.
      const top = relevantTop(
        Object.fromEntries(
          Object.entries(result.scores ?? {}).filter(
            ([n]) => authorized.has(n) && !core.has(n),
          ),
        ),
      );
      session.retrieval = {
        source: result.source ?? 'none',
        coverage,
        prefetchHits: top.length,
        degraded: result.degraded ?? [],
      };
      if (coverage < TOOL_WORKING_SET.minCoverage)
        session.fullCatalog = 'index_coverage';
      else if (
        !top.length &&
        !session.loaded.some((n) => authorized.has(n) && !core.has(n))
      )
        session.fullCatalog = 'no_evidence';
      appendLoaded(
        session.loaded,
        this.withDependencies(top),
        authorized,
        core,
      );
    } catch (error) {
      session.fullCatalog =
        error instanceof Error && error.message === 'ROUTER_TIMEOUT'
          ? 'router_timeout'
          : 'router_error';
      session.retrieval = {
        source: 'none',
        coverage: 0,
        prefetchHits: 0,
        degraded: [session.fullCatalog],
      };
    }
  }

  /**
   * D4: preload for a plan/playbook step (its title as intent). Best effort:
   * loads up to `searchDefault` relevant tools; a failure loads nothing (the
   * hard rule and search_tools still cover the step).
   */
  async preload(
    session: ToolRoutingSession,
    intent: string,
    authorizedDefinitions: AIToolDefinition[],
  ): Promise<string[]> {
    const query = intent.trim().slice(0, 500);
    if (!query || session.fullCatalog) return [];
    const operational = this.operational(
      this.documents(authorizedDefinitions).docs,
    );
    const core = new Set(this.coreNames(session.agent));
    try {
      const result = await withTimeout(
        this.knowledge.rank(query, operational, session.signature),
        TOOL_WORKING_SET.prefetchTimeoutMs,
      );
      const top = relevantTop(
        Object.fromEntries(
          Object.entries(result.scores ?? {}).filter(([n]) => !core.has(n)),
        ),
        TOOL_WORKING_SET.searchDefault,
      );
      return this.load(session, top, authorizedDefinitions);
    } catch {
      return [];
    }
  }

  /**
   * D2/D3/D4: appends authorized operational names to the working set. Hard
   * rule calls pass `cap: null` (a call that must run always loads).
   */
  load(
    session: ToolRoutingSession,
    names: readonly string[],
    authorizedDefinitions: AIToolDefinition[],
    cap: number | null = TOOL_WORKING_SET.maxLoaded +
      TOOL_WORKING_SET.searchMax,
  ): string[] {
    const authorized = new Set(
      authorizedDefinitions
        .map((d) => this.registry.canonicalName(d.function.name))
        .filter((n) => !DISCOVERY.has(n) && !isAgentPlanTool(n)),
    );
    return appendLoaded(
      session.loaded,
      this.withDependencies(names.map((n) => this.registry.canonicalName(n))),
      authorized,
      new Set(this.coreNames(session.agent)),
      cap,
    );
  }

  /** Whether `name` is in this turn's working set (core, loaded or full catalog). */
  isLoaded(session: ToolRoutingSession, name: string): boolean {
    const canonical = this.registry.canonicalName(name);
    return (
      !!session.fullCatalog ||
      isAgentPlanTool(canonical) ||
      this.coreNames(session.agent).includes(canonical) ||
      session.loaded.includes(canonical)
    );
  }

  /**
   * Tools offered to the next inference: `[core sorted] + [loaded in order]`
   * (+ gated plan tools), all ∩ the turn's authority. Relevance never grants:
   * a denied or foreign-surface tool never reaches this list because it is
   * not in `authorizedDefinitions`. With `fullCatalog` set, every authorized
   * tool is offered (core → loaded → rest), the pre-dynamic behaviour.
   */
  async select(
    session: ToolRoutingSession,
    authorizedDefinitions: AIToolDefinition[],
    hasPlan: boolean,
    activePlan: boolean,
  ): Promise<ToolRouterSelection> {
    await this.prefetch(session, authorizedDefinitions);
    const { hash } = this.documents(authorizedDefinitions);
    const allowed = new Map(
      authorizedDefinitions.map((d) => [
        this.registry.canonicalName(d.function.name),
        d,
      ]),
    );
    const authorized = new Set(allowed.keys());
    if (session.dependencies.length)
      this.load(session, session.dependencies, authorizedDefinitions);
    const planNames = [...allowed.keys()]
      .filter(
        (name) =>
          isAgentPlanTool(name) &&
          hasPlan &&
          (activePlan || MIN_PLAN.has(name)),
      )
      .sort((a, b) => a.localeCompare(b));
    const { core, loaded } = composeWorkingSet(
      this.coreNames(session.agent),
      session.loaded,
      authorized,
    );
    let names = [...core, ...planNames, ...loaded];
    if (session.fullCatalog) {
      const listed = new Set(names);
      const rest = [...allowed.keys()]
        .filter(
          (name) =>
            !listed.has(name) && !isAgentPlanTool(name) && !DISCOVERY.has(name),
        )
        .sort((a, b) => a.localeCompare(b));
      const scaffold = [...allowed.keys()]
        .filter((name) => !listed.has(name) && DISCOVERY.has(name))
        .sort((a, b) => a.localeCompare(b));
      names = [...names, ...rest, ...scaffold];
    }
    const degraded = [
      ...(session.retrieval?.degraded ?? []),
      ...(session.fullCatalog ? ['full_catalog_fallback'] : []),
      ...(allowed.has('search_tools') ? [] : ['discovery_not_authorized']),
    ];
    const operationalCount = names.filter(
      (n) => !DISCOVERY.has(n) && !isAgentPlanTool(n),
    ).length;
    return {
      definitions: names.map((n) => allowed.get(n)!),
      operationalCount,
      coreCount: core.length,
      loadedCount: names.length - core.length - planNames.length,
      degraded: [...new Set(degraded)],
      catalogHash: hash,
      retrievalSource: session.fullCatalog
        ? 'full_catalog_fallback'
        : (session.retrieval?.source ?? 'none'),
    };
  }

  /**
   * Shop index for the system prompt: domain → authorized operational tool
   * names. The model SEES that a tool exists even without its definition, so
   * it searches or calls it instead of giving up. Stable for a given
   * authority (sorted), so it stays in the cacheable prefix.
   */
  buildToolIndexDigest(authorizedDefinitions: AIToolDefinition[]): string {
    const byDomain = new Map<string, string[]>();
    for (const doc of this.operational(
      this.documents(authorizedDefinitions).docs,
    )) {
      const list = byDomain.get(doc.domain) ?? [];
      list.push(doc.name);
      byDomain.set(doc.domain, list);
    }
    if (!byDomain.size) return '';
    const lines = [...byDomain.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([domain, names]) =>
          `- ${domain}: ${names.sort((a, b) => a.localeCompare(b)).join(', ')}`,
      );
    return [
      'Índice del taller: herramientas que existen y puedes usar en este turno, por área. Las que no tengas cargadas búscalas con search_tools o llámalas directamente por su nombre exacto.',
      ...lines,
    ].join('\n');
  }

  /**
   * D2: ranks the authorized catalog for an intent and LOADS the results for
   * the next inference (default 5, max 10). Never grants: only authorized
   * operational tools are returned. Writes still need their approval.
   */
  async search(
    session: ToolRoutingSession,
    args: Record<string, unknown>,
    authorized: AIToolDefinition[],
  ): Promise<string> {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (
      !query ||
      query.length > 500 ||
      (args.domain != null &&
        (typeof args.domain !== 'string' || args.domain.length > 100))
    ) {
      return JSON.stringify({
        error: 'Indica query de 1 a 500 caracteres y un dominio válido.',
        error_code: 'INVALID_ARGS',
        next_step: 'Busca por nombre, intención o dominio concreto.',
      });
    }
    const limit =
      args.limit == null ? TOOL_WORKING_SET.searchDefault : Number(args.limit);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > TOOL_WORKING_SET.searchMax
    )
      return JSON.stringify({
        error: `El límite debe ser un entero de 1 a ${TOOL_WORKING_SET.searchMax}.`,
        error_code: 'INVALID_ARGS',
        next_step: 'Repite la búsqueda sin límite o con uno válido.',
      });
    const searchQuery = [
      query,
      typeof args.intent === 'string' ? args.intent.slice(0, 200) : '',
    ]
      .filter(Boolean)
      .join(' ')
      .slice(0, 500);
    const domain = args.domain as string | undefined;
    const operational = this.operational(this.documents(authorized).docs);
    let ranked: string[];
    let degraded: string[] = [];
    try {
      const result = await withTimeout(
        this.knowledge.rank(
          searchQuery,
          operational,
          session.signature,
          domain,
        ),
        TOOL_WORKING_SET.prefetchTimeoutMs,
      );
      ranked = result.names;
      degraded = result.degraded;
    } catch {
      ranked = [];
      degraded = ['router_lexical_fallback'];
    }
    // Evidence first (vector/SQL rank or local lexical), exact name always.
    const scores = localToolScores(searchQuery, operational, domain);
    const opNames = new Set(operational.map((d) => d.name));
    const exact = this.registry.canonicalName(query);
    const local = [...scores.entries()]
      .filter(([, score]) => score > 0)
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .map(([name]) => name);
    const names = [...new Set([exact, ...ranked, ...local])]
      .filter((name) => opNames.has(name))
      .slice(0, limit);
    session.lastSearch = { query, names };
    this.load(session, names, authorized);
    const byName = new Map(
      authorized.map((d) => [this.registry.canonicalName(d.function.name), d]),
    );
    return JSON.stringify({
      total: names.length,
      results: names.map((name) => ({
        name,
        description: (byName.get(name)?.function.description ?? '').slice(
          0,
          240,
        ),
      })),
      degraded,
      next_step: names.length
        ? 'Estas herramientas quedaron cargadas: llama la adecuada en tu siguiente respuesta. Cada escritura necesita su aprobación.'
        : 'No encontré una herramienta para eso. Prueba otras palabras o revisa el índice del taller.',
    });
  }

  /**
   * D4: a name that is not authorized/does not exist (hallucinated, e.g.
   * `list_suppliers`) → real authorized alternatives, loaded for the next
   * inference. Never a permission notice.
   */
  async alternatives(
    session: ToolRoutingSession,
    name: string,
    intent: string,
    authorized: AIToolDefinition[],
  ): Promise<string[]> {
    const query = `${name.replace(/_/g, ' ')} ${intent}`.trim().slice(0, 500);
    const parsed = JSON.parse(
      await this.search(session, { query }, authorized),
    ) as { results?: Array<{ name: string }> };
    return (parsed.results ?? []).map((r) => r.name);
  }

  /** Records an executed tool and keeps it loaded (hard rule included). */
  markUsed(
    session: ToolRoutingSession,
    name: string,
    authorizedDefinitions?: AIToolDefinition[],
  ): void {
    const canonical = this.registry.canonicalName(name);
    if (!session.used.includes(canonical)) session.used.push(canonical);
    if (authorizedDefinitions)
      this.load(session, [canonical], authorizedDefinitions, null);
  }

  /** Permission/plan/caller identities belong in the signature, never prompt text. */
  signature(value: unknown): string {
    return catalogHash(value);
  }
}
