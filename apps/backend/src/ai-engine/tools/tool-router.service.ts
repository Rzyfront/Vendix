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
]);
const MIN_PLAN = new Set(['propose_plan', 'ask_user']);
export interface ToolRoutingSession {
  query: string;
  signature: string;
  capacity: 12 | 24 | 40;
  expansions: number;
  names: string[];
  used: string[];
  dependencies: string[];
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
  ): ToolRoutingSession {
    return {
      query: query.slice(0, 500),
      signature,
      capacity: 12,
      expansions: 0,
      names: [],
      used: [],
      dependencies,
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
    const operational = docs.filter(
      (d) => !DISCOVERY.has(d.name) && !isAgentPlanTool(d.name),
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
    const opAllowed = new Set(operational.map((d) => d.name));
    const pinned = [...session.used, ...session.dependencies]
      .map((n) => this.registry.canonicalName(n))
      .filter((n) => opAllowed.has(n));
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
    const offered = new Set([...names, ...scaffold.map((d) => d.name)]);
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

  markUsed(session: ToolRoutingSession, name: string): void {
    const canonical = this.registry.canonicalName(name);
    if (!session.used.includes(canonical)) session.used.push(canonical);
  }

  /** Permission/plan/caller identities belong in the signature, never prompt text. */
  signature(value: unknown): string {
    return catalogHash(value);
  }
}
