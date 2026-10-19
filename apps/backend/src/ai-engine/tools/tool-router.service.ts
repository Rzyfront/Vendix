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
 * them, so they lead the ordered catalog.
 *
 * Ordering only, never a grant: every name is intersected with the authorized
 * definitions of the turn (permissions ∩ plan ∩ agent allowed − denied).
 * Discovery and plan tools are ordered last and never listed here.
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

  /**
   * The model ALWAYS receives every tool the turn authorizes (permissions ∩
   * plan ∩ agent allowed − denied ∩ caller). Relevance only ORDERS the list
   * (core → ranked for the goal → rest → scaffold); it never excludes. A top-K
   * working set made the model call authorized-but-unoffered tools, which the
   * loop rejected as AI_AGENT_TOOL_NOT_ALLOWED / staged for another round:
   * false «sin permisos» notices and turns that ran out of rounds (prod 2026-10).
   *
   * The order is computed once per session (the goal does not change inside a
   * turn), so the tool block stays byte-stable across rounds for prompt caching.
   * Plan tools keep their hook gating: without a plan hook they are not offered.
   */
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
    const offerPlanTool = (name: string) =>
      hasPlan && (activePlan || MIN_PLAN.has(name));
    const coreNames = agentToolCore(session.agent).map((n) =>
      this.registry.canonicalName(n),
    );
    const operational = docs.filter(
      (d) => !DISCOVERY.has(d.name) && !isAgentPlanTool(d.name),
    );
    let degraded: string[] = [];
    if (!session.names.length && operational.length) {
      let ranked: string[];
      try {
        const result = await this.knowledge.rank(
          session.query,
          operational,
          session.signature,
        );
        ranked = result.names;
        degraded = result.degraded;
      } catch {
        ranked = localToolRanking(session.query, operational);
        degraded = ['router_lexical_fallback'];
      }
      session.names = [...new Set([...coreNames, ...ranked])];
    }
    const order = new Map<string, number>();
    for (const name of [...session.used, ...session.names])
      if (!order.has(name)) order.set(name, order.size);
    const rank = (name: string) => {
      if (DISCOVERY.has(name) || isAgentPlanTool(name))
        return Number.MAX_SAFE_INTEGER;
      return order.get(name) ?? Number.MAX_SAFE_INTEGER - 1;
    };
    const names = [...allowed.keys()]
      .filter((name) => !isAgentPlanTool(name) || offerPlanTool(name))
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    return {
      definitions: names.map((n) => allowed.get(n)!),
      operationalCount: names.filter(
        (n) => !DISCOVERY.has(n) && !isAgentPlanTool(n),
      ).length,
      degraded: allowed.has('search_tools')
        ? degraded
        : [...degraded, 'discovery_not_authorized'],
      catalogHash: hash,
    };
  }

  /**
   * Optional helper: ranks the ALREADY OFFERED authorized catalog for an
   * intent. It never stages, expands or gates anything — every authorized
   * tool is callable in the same round.
   */
  async search(
    session: ToolRoutingSession,
    args: Record<string, unknown>,
    authorized: AIToolDefinition[],
    _allowExpansion = true,
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
    const searchQuery = [
      query,
      typeof args.intent === 'string' ? args.intent.slice(0, 200) : '',
    ]
      .filter(Boolean)
      .join(' ')
      .slice(0, 500);
    const domain = args.domain as string | undefined;
    const operational = this.documents(authorized).docs.filter(
      (d) => !DISCOVERY.has(d.name) && !isAgentPlanTool(d.name),
    );
    let ranked: string[];
    let degraded: string[] = [];
    try {
      const result = await this.knowledge.rank(
        searchQuery,
        operational,
        session.signature,
        domain,
      );
      ranked = result.names;
      degraded = result.degraded;
    } catch {
      ranked = localToolRanking(searchQuery, operational, domain);
      degraded = ['router_lexical_fallback'];
    }
    const scores = localToolScores(searchQuery, operational, domain);
    const opNames = new Set(operational.map((d) => d.name));
    const exact = this.registry.canonicalName(query);
    session.lastSearch = {
      query,
      names: [
        ...new Set([
          exact,
          ...ranked.filter((name) => (scores.get(name) ?? 0) > 0),
          ...ranked,
        ]),
      ]
        .filter((name) => opNames.has(name))
        .slice(0, 24),
    };
    return this.searchPage(session, args, authorized, degraded);
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
        total: page.total,
        results: page.data,
        has_more: page.has_more,
        cursor: page.cursor,
        degraded,
        next_step:
          'Todas estas herramientas ya están en tu catálogo actual: llama la adecuada directamente en esta misma respuesta. Cada escritura necesita su aprobación.',
      });
    } catch (error) {
      return discoveryError(error);
    }
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
