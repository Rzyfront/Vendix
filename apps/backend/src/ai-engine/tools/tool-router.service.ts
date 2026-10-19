import { Injectable } from '@nestjs/common';
import { AIToolDefinition } from '../interfaces/ai-provider.interface';
import { isAgentPlanTool } from '../interfaces/agent-plan.interface';
import { KnowledgeSearchService } from '../embeddings/knowledge-search.service';
import { discoveryPage, discoveryError } from './discovery-pagination';
import { AIToolRegistry } from './ai-tool-registry';
import {
  buildToolManifest,
  catalogHash,
  localToolRanking,
  localToolScores,
  mayFillWithoutEvidence,
  ToolDocument,
} from './tool-catalog';

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
 * them, so a lexical top-K that buries them guarantees NOT_OFFERED.
 *
 * Offered ON TOP of the K operative slots, like the scaffold, so the lexical
 * working set keeps its full capacity; bounded (≤8) and never a grant: every
 * name is intersected with the authorized definitions of the turn (permissions
 * ∩ plan ∩ agent allowed − denied). Discovery and plan tools are handled by
 * their own scaffolds and never listed here.
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
 * an unknown explicit key gets no core (safe default: scaffold + top-K only).
 */
export function agentToolCore(agent: string | undefined): readonly string[] {
  return AGENT_TOOL_CORE[agent ?? 'vexi'] ?? [];
}
const MIN_PLAN = new Set(['propose_plan', 'ask_user']);
/** Bounded: a model naming many unoffered tools cannot widen the set past K. */
const MAX_REQUESTED = 4;
export interface ToolRoutingSession {
  query: string;
  signature: string;
  capacity: 12 | 24 | 40;
  expansions: number;
  names: string[];
  used: string[];
  dependencies: string[];
  /** agent_key of the turn; selects the fixed core. Undefined = Vexi. */
  agent?: string;
  /**
   * Text loop (Vex/Vexi chat): a write needs lexical evidence for the intent to
   * enter the working set. The voice surface keeps its own preview-only filter.
   */
  writesNeedEvidence?: boolean;
  /**
   * Authorized tools the model already called by exact name while they were
   * not offered (AI_AGENT_TOOL_NOT_OFFERED). Pinned like dependencies at the
   * NEXT inference; never grants authority (re-filtered against `allowed`).
   */
  requested?: string[];
  pending?: { query: string; domain?: string };
  lastSearch?: { query: string; names: string[] };
}
export interface ToolRouterSelection {
  definitions: AIToolDefinition[];
  operationalCount: number;
  degraded: string[];
  catalogHash: string;
}

@Injectable()
export class ToolRouterService {
  constructor(
    private readonly registry: AIToolRegistry,
    private readonly knowledge: KnowledgeSearchService,
  ) {}

  createSession(
    query: string,
    signature: string,
    dependencies: string[] = [],
    agent?: string,
    options: { writesNeedEvidence?: boolean } = {},
  ): ToolRoutingSession {
    return {
      query: query.slice(0, 500),
      signature,
      capacity: 12,
      expansions: 0,
      names: [],
      used: [],
      dependencies,
      agent,
      ...(options.writesNeedEvidence ? { writesNeedEvidence: true } : {}),
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

  async select(
    session: ToolRoutingSession,
    authorizedDefinitions: AIToolDefinition[],
    hasPlan: boolean,
    activePlan: boolean,
  ): Promise<ToolRouterSelection> {
    const { docs, hash } = this.documents(authorizedDefinitions);
    const allowed = new Map(
      authorizedDefinitions.map((d) => [
        this.registry.canonicalName(d.function.name),
        d,
      ]),
    );
    // A strict agent/plan/caller scope that excludes discovery retains the FULL authorized
    // catalog, rather than getting stranded at K12 or receiving an unauthorized scaffold.
    if (!allowed.has('search_tools'))
      return {
        definitions: authorizedDefinitions,
        operationalCount: authorizedDefinitions.filter(
          (d) => !isAgentPlanTool(d.function.name),
        ).length,
        degraded: ['discovery_not_authorized'],
        catalogHash: hash,
      };
    const scaffold = docs.filter(
      (d) =>
        DISCOVERY.has(d.name) ||
        (isAgentPlanTool(d.name) &&
          hasPlan &&
          (activePlan || MIN_PLAN.has(d.name))),
    );
    const coreNames = new Set(
      agentToolCore(session.agent).map((n) => this.registry.canonicalName(n)),
    );
    // `docs` is already the authorized subset: a core name the agent may not use
    // simply has no document here and is never offered.
    const core = docs.filter(
      (d) =>
        coreNames.has(d.name) &&
        !DISCOVERY.has(d.name) &&
        !isAgentPlanTool(d.name),
    );
    const operational = docs.filter(
      (d) =>
        !DISCOVERY.has(d.name) &&
        !isAgentPlanTool(d.name) &&
        !coreNames.has(d.name),
    );
    const intent = session.pending ?? { query: session.query };
    let ranked: { names: string[]; degraded: string[] };
    try {
      ranked = await this.knowledge.rank(
        intent.query,
        operational,
        session.signature,
        intent.domain,
      );
    } catch {
      ranked = {
        names: localToolRanking(intent.query, operational, intent.domain),
        degraded: ['router_lexical_fallback'],
      };
    }
    // Writes never enter by a score-0 tie (alphabetical tie-break): without
    // lexical evidence for THIS intent only fail-closed reads may fill the set.
    // Vector/ts ranks are not evidence here: the vector branch returns its
    // nearest 100 regardless of relevance. Pinned/requested/previous names and
    // search_tools (which re-enters here with its own query/domain) still reach
    // a write deliberately.
    if (session.writesNeedEvidence) {
      const scores = localToolScores(intent.query, operational, intent.domain);
      const byName = new Map(operational.map((d) => [d.name, d]));
      ranked = {
        ...ranked,
        names: ranked.names.filter((name) => {
          const doc = byName.get(name);
          return (
            !!doc &&
            ((scores.get(name) ?? 0) > 0 || mayFillWithoutEvidence(doc))
          );
        }),
      };
    }
    const opAllowed = new Set(operational.map((d) => d.name));
    const pinned = [
      ...session.used,
      ...session.dependencies,
      ...(session.requested ?? []),
    ]
      .map((n) => this.registry.canonicalName(n))
      .filter((n) => opAllowed.has(n));
    // Core tools are always offered; their authorized dependencies are pinned.
    for (const doc of core)
      for (const dependency of doc.dependencies) {
        const canonical = this.registry.canonicalName(dependency);
        if (opAllowed.has(canonical) && !pinned.includes(canonical))
          pinned.push(canonical);
      }
    // Dependency closure is still bounded and never gives a denied tool authority.
    for (let i = 0; i < pinned.length && i < session.capacity; i++) {
      for (const dependency of docs.find((d) => d.name === pinned[i])
        ?.dependencies ?? []) {
        const canonical = this.registry.canonicalName(dependency);
        if (opAllowed.has(canonical) && !pinned.includes(canonical))
          pinned.push(canonical);
      }
    }
    const previous = session.names.filter((n) => opAllowed.has(n));
    const candidates = [
      ...new Set([...pinned, ...previous, ...ranked.names]),
    ].filter((n) => opAllowed.has(n));
    const names = candidates.slice(0, session.capacity);
    // Exact/alias/dependency fast path must not be buried by prior unused definitions.
    if (session.pending) {
      const requested = ranked.names.slice(
        0,
        Math.max(
          1,
          session.capacity - Math.min(pinned.length, session.capacity),
        ),
      );
      names.splice(
        0,
        names.length,
        ...[...new Set([...pinned, ...requested, ...previous, ...ranked.names])]
          .filter((n) => opAllowed.has(n))
          .slice(0, session.capacity),
      );
    }
    session.names = names;
    session.pending = undefined;
    const offered = new Set([
      ...names,
      ...scaffold.map((d) => d.name),
      ...core.map((d) => d.name),
    ]);
    return {
      definitions: [...offered]
        .sort()
        .map((n) => allowed.get(n)!)
        .filter(Boolean),
      operationalCount: names.length,
      degraded: ranked.degraded,
      catalogHash: hash,
    };
  }

  /** Stage only. Caller swaps definitions+guard together at the NEXT inference. */
  async search(
    session: ToolRoutingSession,
    args: Record<string, unknown>,
    authorized: AIToolDefinition[],
    allowExpansion = true,
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
    if (
      args.limit != null &&
      (!Number.isSafeInteger(Number(args.limit)) ||
        Number(args.limit) < 1 ||
        Number(args.limit) > 20)
    )
      return discoveryError(
        new Error('El límite debe ser un entero de 1 a 20.'),
      );
    if (args.cursor != null) {
      if (!session.lastSearch || session.lastSearch.query !== query)
        return discoveryError(
          new Error('El cursor no corresponde a la búsqueda activa.'),
        );
      return this.searchPage(session, args, authorized);
    }
    if (session.pending)
      return JSON.stringify({
        error: 'Ya hay una ampliación preparada para la siguiente inferencia.',
        next_step:
          'Usa el catálogo de la siguiente inferencia antes de volver a buscar.',
      });
    if (session.expansions >= 2)
      return JSON.stringify({
        expanded: false,
        capacity: session.capacity,
        next_step:
          'Ya se alcanzó el máximo de 40 operativas. Usa list_capabilities/list_endpoints y el bridge autorizado; no inventes herramientas ni DTOs.',
      });
    // Validation, schema cursors and no-op results above do not expand the
    // working set. Only the actual expansion needs an objective budget slot.
    if (!allowExpansion)
      return JSON.stringify({
        error: 'Se agotaron las ampliaciones del objetivo.',
        error_code: 'AGENT_EXPANSION_LIMIT',
        next_step:
          'Usa el catálogo ya autorizado o informa la capacidad concreta que falta.',
      });
    const searchQuery = [
      query,
      typeof args.intent === 'string' ? args.intent.slice(0, 200) : '',
    ]
      .filter(Boolean)
      .join(' ')
      .slice(0, 500);
    const shadow = {
      ...session,
      names: [...session.names],
      used: [...session.used],
      capacity: session.capacity === 12 ? (24 as const) : (40 as const),
      pending: {
        query: searchQuery,
        domain: args.domain as string | undefined,
      },
    };
    const next = await this.select(shadow, authorized, true, true);
    // select clears shadow.pending; never mutate current offered names here.
    session.capacity = shadow.capacity;
    session.expansions++;
    session.pending = {
      query: searchQuery,
      domain: args.domain as string | undefined,
    };
    const result = next.definitions.filter(
      (d) =>
        !DISCOVERY.has(d.function.name) && !isAgentPlanTool(d.function.name),
    );
    const exact = this.registry.canonicalName(query);
    const selectedNames = new Set(result.map((d) => d.function.name));
    session.lastSearch = {
      query,
      names: [...new Set([exact, ...shadow.names])].filter((name) =>
        selectedNames.has(name),
      ),
    };
    return this.searchPage(session, args, authorized, next.degraded);
  }

  private searchPage(
    session: ToolRoutingSession,
    args: Record<string, unknown>,
    authorized: AIToolDefinition[],
    degraded: string[] = [],
  ): string {
    try {
      const allowed = new Map(authorized.map((d) => [d.function.name, d]));
      const result = (session.lastSearch?.names ?? [])
        .map((name) => allowed.get(name))
        .filter((d): d is AIToolDefinition => !!d);
      const page = discoveryPage(
        result.map((d) => d.function),
        args,
        [session.lastSearch?.query, session.signature],
        3,
      );
      return JSON.stringify({
        enabled_next_inference: true,
        capacity: session.capacity,
        total: page.total,
        results: page.data,
        has_more: page.has_more,
        cursor: page.cursor,
        degraded,
        next_step:
          'Las definiciones se habilitan en la SIGUIENTE inferencia, no en este lote. Continúa con cursor y la misma query para más schemas sin ampliar otra vez. Cada escritura necesita su aprobación.',
      });
    } catch (error) {
      return discoveryError(error);
    }
  }

  /**
   * Stage an authorized-but-unoffered tool the model called by its exact name,
   * so the SAME call is valid at the next inference without spending a
   * search_tools expansion slot. The guard still rejects it in this batch
   * (atomic definitions+guard swap). Returns false, staging nothing, for
   * unauthorized names, discovery/plan scaffolding or unknown tools.
   */
  requestTool(
    session: ToolRoutingSession,
    name: string,
    authorized: AIToolDefinition[],
  ): boolean {
    const canonical = this.registry.canonicalName(name);
    if (DISCOVERY.has(canonical) || isAgentPlanTool(canonical)) return false;
    if (
      !authorized.some(
        (d) => this.registry.canonicalName(d.function.name) === canonical,
      )
    )
      return false;
    const requested = (session.requested ??= []);
    if (!requested.includes(canonical)) {
      requested.push(canonical);
      if (requested.length > MAX_REQUESTED) requested.shift();
    }
    return true;
  }

  markUsed(session: ToolRoutingSession, name: string): void {
    const canonical = this.registry.canonicalName(name);
    if (!session.used.includes(canonical)) session.used.push(canonical);
  }

  /** Permission/plan/caller identities belong in the signature, never prompt text. */
  signature(value: unknown): string {
    return catalogHash(value);
  }
}
