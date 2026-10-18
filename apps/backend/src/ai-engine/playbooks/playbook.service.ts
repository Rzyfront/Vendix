import { Injectable, Optional } from '@nestjs/common';
import { KnowledgeSearchService } from '../embeddings/knowledge-search.service';
import { RequestContextService } from '../../common/context/request-context.service';
import type { AIToolDefinition } from '../interfaces/ai-provider.interface';
import { AIToolRegistry } from '../tools/ai-tool-registry';
import { ApiCatalogService } from '../tools/bridge/api-catalog.service';
import {
  catalogHash,
  type ToolCatalogManifest,
  type ToolDocument,
} from '../tools/tool-catalog';
import { PlaybookLoaderService } from './playbook-loader.service';
import type { PlaybookDocument, PlaybookStep } from './playbook.interface';

export interface PlaybookScope {
  organization_id: number;
  store_id: number;
  user_id: number;
}
export interface ActivePlaybookPin {
  id: string;
  version: string;
  hash: string;
  section?: string;
}
/** Opaque handle: the authoritative scope/catalog are held privately, not in tool args. */
export interface PlaybookSession {
  readonly session_kind: 'playbook-turn';
}
interface SessionState {
  scope: PlaybookScope;
  allowed: ReadonlySet<string>;
  initialAllowed: ReadonlySet<string>;
  active: Map<string, ActivePlaybookPin>;
  spent: Map<string, number>;
  restoreErrors: string[];
}
interface PlaybookError {
  error_code: string;
  error: string;
  next_step: string;
}
export interface LoadedPlaybook {
  id: string;
  version: string;
  hash: string;
  metadata: { verifier_ids: string[]; sections: string[] };
  section: { id: string; title: string; body: string; steps: PlaybookStep[] };
  inputs: Array<{ key: string; required: boolean; source: 'user' | 'lookup' }>;
  mode: 'executable' | 'preparation_only';
  gaps: string[];
  omitted_steps: number;
  omitted_body_lines: number;
  authority: 'guidance_only_current_tools_and_individual_approval';
  budget: {
    limit_tokens: number;
    estimated_tokens: number;
    remaining_tokens: number;
  };
}
const INITIAL_TOKENS = 2000;
const MAX_ACTIVE = 2;
const estimatedTokens = (value: unknown): number =>
  Buffer.byteLength(
    typeof value === 'string' ? value : JSON.stringify(value),
    'utf8',
  );
const normalized = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
const error = (
  code: string,
  message: string,
  next = 'Revalida la versión publicada y los permisos actuales; no ejecutes pasos omitidos.',
): PlaybookError => ({ error_code: code, error: message, next_step: next });

@Injectable()
export class PlaybookService {
  // Weak keys are loop-owned objects, never a user-supplied ID or cross-turn cache.
  private readonly sessions = new WeakMap<PlaybookSession, SessionState>();

  constructor(
    private readonly loader: PlaybookLoaderService,
    private readonly registry: AIToolRegistry,
    private readonly apiCatalog: ApiCatalogService,
    @Optional() private readonly knowledge?: KnowledgeSearchService,
  ) {}

  createSession(options: {
    scope: PlaybookScope;
    authorizedDefinitions: AIToolDefinition[];
    activePins?: ActivePlaybookPin[];
  }): PlaybookSession {
    this.assertScope(options.scope);
    const session: PlaybookSession = Object.freeze({
      session_kind: 'playbook-turn',
    });
    const initialAllowed = new Set(
      options.authorizedDefinitions.map((definition) =>
        this.registry.canonicalName(definition.function.name),
      ),
    );
    const state: SessionState = {
      scope: { ...options.scope },
      allowed: new Set(initialAllowed),
      initialAllowed,
      active: new Map(),
      spent: new Map(),
      restoreErrors: [],
    };
    this.sessions.set(session, state);
    // Historical pins are facts, not authority or cached bodies. Restore only release matches.
    for (const pin of (options.activePins ?? []).slice(0, MAX_ACTIVE + 1)) {
      if (state.active.size >= MAX_ACTIVE) {
        state.restoreErrors.push('PLAYBOOK_ACTIVE_LIMIT');
        break;
      }
      const document = this.loader
        .getPlaybooks()
        .find((candidate) => candidate.id === pin.id);
      if (
        !document ||
        document.metadata.version !== pin.version ||
        document.hash !== pin.hash ||
        (pin.section &&
          !document.sections.some((section) => section.id === pin.section))
      ) {
        state.restoreErrors.push(`PLAYBOOK_PIN_STALE:${pin.id}`);
        // Keep the stale identity pinned: discarding it would silently adopt a
        // changed release on the next load without proving its historical hash.
        if (
          typeof pin.id === 'string' &&
          typeof pin.version === 'string' &&
          typeof pin.hash === 'string'
        )
          state.active.set(pin.id, { ...pin });
        continue;
      }
      state.active.set(pin.id, {
        id: pin.id,
        version: pin.version,
        hash: pin.hash,
        ...(pin.section ? { section: pin.section } : {}),
      });
    }
    return session;
  }

  /** Current authorization may narrow/restore the turn's original boundary, never widen it. */
  refreshAuthorization(
    session: PlaybookSession,
    authorizedDefinitions: AIToolDefinition[],
  ): void {
    const state = this.state(session);
    state.allowed = new Set(
      authorizedDefinitions
        .map((definition) =>
          this.registry.canonicalName(definition.function.name),
        )
        .filter((name) => state.initialAllowed.has(name)),
    );
  }

  /** Routing hints only: every returned tool already belongs to the current authorized intersection. */
  getActiveToolDependencies(session: PlaybookSession): string[] {
    const state = this.state(session);
    const documents = this.loader.getPlaybooks();
    const names = new Set<string>();
    for (const pin of state.active.values()) {
      const document = documents.find(
        (candidate) =>
          candidate.id === pin.id &&
          candidate.metadata.version === pin.version &&
          candidate.hash === pin.hash,
      );
      if (!document) continue;
      const section = pin.section ?? document.sections[0]?.id;
      for (const step of this.prune(document, state).steps) {
        if (
          step.section === section &&
          step.tool &&
          this.isAllowed(step.tool, state)
        )
          names.add(this.registry.canonicalName(step.tool));
      }
    }
    return [...names].sort();
  }

  getActivePins(session: PlaybookSession): ActivePlaybookPin[] {
    return [...this.state(session).active.values()].map((pin) => ({ ...pin }));
  }

  search(session: PlaybookSession, args: { query: string; limit?: number }) {
    const state = this.state(session);
    if (
      typeof args.query !== 'string' ||
      !args.query.trim() ||
      args.query.length > 500 ||
      (args.limit !== undefined &&
        (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 10))
    )
      return error('PLAYBOOK_SEARCH_INVALID', 'Consulta o límite inválido.');
    const words = normalized(args.query).split(/\s+/).filter(Boolean);
    const ranked = this.loader
      .getPlaybooks()
      .map((document) => {
        const title = normalized(document.name);
        const text = normalized(
          [
            document.id,
            document.description,
            ...document.contract.inputs.map((input) => input.key),
          ].join(' '),
        );
        const score = words.reduce(
          (sum, word) =>
            sum + (title.includes(word) ? 3 : text.includes(word) ? 1 : 0),
          0,
        );
        return { document, score };
      })
      .filter(({ score }) => score > 0)
      .sort(
        (a, b) =>
          b.score - a.score || a.document.id.localeCompare(b.document.id),
      );
    return {
      results: ranked
        .slice(0, args.limit ?? 5)
        .map(({ document }) => this.summary(document, state)),
      has_more: ranked.length > (args.limit ?? 5),
      restored_pin_errors: [...state.restoreErrors],
    };
  }

  /** B retrieval returns names only; all summaries are reconstructed from this authorized release. */
  async searchHybrid(
    session: PlaybookSession,
    args: { query: string; limit?: number },
  ) {
    const local = this.search(session, args);
    if ('error_code' in local || !this.knowledge) return local;
    const state = this.state(session);
    const manifest = this.getKnowledgeManifest();
    const permissions =
      RequestContextService.asyncLocalStorage.getStore()?.permissions ?? [];
    const authorizedDocuments = manifest.documents.filter(
      (document) =>
        Array.isArray(document.metadata.required_permissions) &&
        (document.metadata.required_permissions as string[]).every(
          (permission) => permissions.includes(permission),
        ) &&
        Array.isArray(document.metadata.tool_names) &&
        (document.metadata.tool_names as string[]).every((name) =>
          this.isAllowed(name, state),
        ),
    );
    const signature = catalogHash({
      scope: state.scope,
      allowed: [...state.allowed].sort(),
      permissions: [...permissions].sort(),
      release: manifest.hash,
    });
    try {
      const ranking = await this.knowledge.rank(
        args.query,
        authorizedDocuments,
        signature,
        undefined,
        'process',
      );
      // Provider/index waits cannot revive stale session authority.

      const current = this.state(session);
      const currentPermissions =
        RequestContextService.asyncLocalStorage.getStore()?.permissions ?? [];
      const activeDocuments = new Map(
        this.getKnowledgeManifest()
          .documents.filter(
            (document) =>
              (document.metadata.required_permissions as string[]).every(
                (permission) => currentPermissions.includes(permission),
              ) &&
              (document.metadata.tool_names as string[]).every((name) =>
                this.isAllowed(name, current),
              ),
          )
          .map((document) => [document.name, document]),
      );
      const byId = new Map(
        this.loader.getPlaybooks().map((document) => [document.id, document]),
      );
      const ids = new Set<string>();
      for (const name of ranking.names) {
        const document = activeDocuments.get(name);
        if (document && typeof document.metadata.playbook_id === 'string')
          ids.add(document.metadata.playbook_id);
      }
      // Local partial/preparation-only processes remain discoverable with concrete gaps.
      const currentLocal = this.search(session, args);
      if ('error_code' in currentLocal) return currentLocal;
      for (const result of currentLocal.results) ids.add(result.id);
      const results = [...ids].flatMap((id) => {
        const document = byId.get(id);
        return document ? [this.summary(document, current)] : [];
      });
      return {
        results: results.slice(0, args.limit ?? 5),
        has_more: results.length > (args.limit ?? 5),
        restored_pin_errors: [...current.restoreErrors],
        degraded: ranking.degraded,
      };
    } catch {
      return {
        ...this.search(session, args),
        degraded: ['knowledge_unavailable'],
      };
    }
  }

  load(
    session: PlaybookSession,
    args: {
      id: string;
      version: string;
      section?: string;
      hash?: string;
    },
  ): LoadedPlaybook | PlaybookError {
    const state = this.state(session);
    if (
      typeof args.id !== 'string' ||
      !/^[a-z0-9][a-z0-9-]{0,99}$/.test(args.id) ||
      typeof args.version !== 'string' ||
      !args.version ||
      args.version.length > 40 ||
      (args.section !== undefined &&
        (typeof args.section !== 'string' ||
          !/^[a-z0-9][a-z0-9-]{0,99}$/.test(args.section)))
    )
      return error(
        'PLAYBOOK_LOAD_INVALID',
        'Identificador, versión o sección inválidos.',
      );
    const document = this.loader
      .getPlaybooks()
      .find((candidate) => candidate.id === args.id);
    if (!document)
      return error(
        'PLAYBOOK_NOT_FOUND',
        'El proceso no está en esta versión publicada.',
      );
    if (document.metadata.version !== args.version)
      return error(
        'PLAYBOOK_VERSION_MISMATCH',
        'La versión solicitada no coincide con la versión publicada.',
      );
    const previous = state.active.get(document.id);
    if (
      (args.hash && args.hash !== document.hash) ||
      (previous &&
        (previous.hash !== document.hash ||
          previous.version !== document.metadata.version))
    )
      return error(
        'PLAYBOOK_HASH_MISMATCH',
        'El contenido cambió; no se reutiliza un pin histórico ni se adopta una versión nueva en silencio.',
      );
    const section = args.section
      ? document.sections.find((candidate) => candidate.id === args.section)
      : document.sections[0];
    if (!section)
      return error(
        'PLAYBOOK_SECTION_NOT_FOUND',
        'La sección solicitada no existe.',
      );
    if (!previous && state.active.size >= MAX_ACTIVE)
      return error(
        'PLAYBOOK_ACTIVE_LIMIT',
        'Ya hay dos procesos activos en este turno.',
        'Continúa con los procesos activos; para cambiar el conjunto abre un objetivo nuevo sin pines anteriores.',
      );
    const spent = state.spent.get(document.id) ?? 0;
    const remaining = INITIAL_TOKENS - spent;
    const pruning = this.prune(document, state);
    const forbidden = document.metadata.tool_contracts
      .map((tool) => tool.name)
      .filter((name) => !this.isAllowed(name, state));
    // Whole lines and whole structured steps only; never partial JSON/instructions.
    const originalLines = section.body.split('\n');
    const keptStepIds = new Set(pruning.steps.map((step) => step.id));
    const blockedSteps = document.contract.steps.filter(
      (step) => !keptStepIds.has(step.id),
    );
    const forbiddenReferences = [
      ...forbidden,
      ...blockedSteps.flatMap((step) => [
        step.instruction,
        ...(step.bridge ? [step.bridge.path] : []),
      ]),
    ].filter(Boolean);
    const safeLines = originalLines.filter(
      (line) =>
        !forbiddenReferences.some((reference) => line.includes(reference)),
    );
    const steps = pruning.steps.filter((step) => step.section === section.id);
    const result: LoadedPlaybook = {
      id: document.id,
      version: document.metadata.version,
      hash: document.hash,
      metadata: {
        verifier_ids: [...document.metadata.verifier_ids],
        sections: document.sections.map((candidate) => candidate.id),
      },
      section: {
        id: section.id,
        title: section.title,
        body: safeLines.join('\n'),
        steps,
      },
      inputs: document.contract.inputs.map(({ key, required, source }) => ({
        key,
        required,
        source,
      })),
      mode: pruning.gaps.length ? 'preparation_only' : document.contract.mode,
      gaps: [...pruning.gaps],
      omitted_steps: section.steps.length - steps.length,
      omitted_body_lines: originalLines.length - safeLines.length,
      authority: 'guidance_only_current_tools_and_individual_approval',
      budget: {
        limit_tokens: INITIAL_TOKENS,
        estimated_tokens: 0,
        remaining_tokens: remaining,
      },
    };
    // Budget covers the COMPLETE serialized result at 1 token/UTF-8 byte, a
    // conservative upper bound (not the unsafe chars/4 heuristic for Spanish).
    const measure = () => {
      result.budget.estimated_tokens = 0;
      result.budget.remaining_tokens = remaining;
      for (let i = 0; i < 4; i++) {
        const size = estimatedTokens(result);
        result.budget.estimated_tokens = Math.max(
          result.budget.estimated_tokens,
          size,
        );
        result.budget.remaining_tokens = Math.max(
          0,
          remaining - result.budget.estimated_tokens,
        );
      }
      return Math.max(estimatedTokens(result), result.budget.estimated_tokens);
    };
    while (measure() > remaining && result.section.steps.length) {
      result.section.steps.pop();
      result.omitted_steps++;
    }
    while (measure() > remaining && safeLines.length) {
      safeLines.pop();
      result.omitted_body_lines++;
      result.section.body = safeLines.join('\n');
    }
    if (result.omitted_steps || result.omitted_body_lines)
      result.mode = 'preparation_only';
    const size = measure();
    if (
      size > remaining ||
      (!result.section.body && !result.section.steps.length)
    )
      return error(
        'PLAYBOOK_BUDGET_EXHAUSTED',
        'No cabe una sección íntegra útil en el presupuesto restante.',
        'Usa una sección más breve en un nuevo turno; no asumas que el contenido omitido fue cargado.',
      );
    state.active.set(document.id, {
      id: document.id,
      version: document.metadata.version,
      hash: document.hash,
      section: section.id,
    });
    state.spent.set(document.id, spent + size);
    return result;
  }

  /** Release-only B manifest: descriptions + sections, no customer data or executable authority. */
  getKnowledgeManifest(): ToolCatalogManifest {
    const documents: ToolDocument[] = this.loader
      .getPlaybooks()
      .flatMap((document) =>
        document.sections.map((section) => {
          const metadata = {
            entity_type: 'process',
            playbook_id: document.id,
            workflow_key: document.metadata.workflow_key,
            section: section.id,
            version: document.metadata.version,
            playbook_hash: document.hash,
            owner: document.metadata.owner,
            required_permissions: document.metadata.required_permissions,
            mode: document.contract.mode,
            gaps: document.contract.gaps,
            tool_names: document.metadata.tool_contracts.map(
              (tool) => tool.name,
            ),
          };
          const content = [
            document.name,
            document.description,
            section.title,
            section.body,
            ...section.steps.map((step) => step.instruction),
          ].join('\n');
          return {
            key: `process:${document.metadata.workflow_key}:${document.metadata.version}:${section.id}`,
            name: `${document.metadata.workflow_key}:${section.id}`,
            version: document.metadata.version,
            domain: 'playbooks',
            hash: catalogHash({ metadata, content }),
            content,
            lexicalText: normalized(content),
            aliases: [],
            dependencies: document.metadata.tool_contracts.map(
              (tool) => tool.name,
            ),
            metadata,
          };
        }),
      )
      .sort((a, b) => a.key.localeCompare(b.key));
    return {
      hash: catalogHash(
        documents.map((document) => [document.key, document.hash]),
      ),
      documents,
    };
  }

  private summary(document: PlaybookDocument, state: SessionState) {
    const pruning = this.prune(document, state);
    return {
      id: document.id,
      version: document.metadata.version,
      hash: document.hash,
      title: document.name,
      sections: document.sections.map(({ id, title }) => ({ id, title })),
      inputs: document.contract.inputs.map(({ key, required, source }) => ({
        key,
        required,
        source,
      })),
      estimated_tokens: Math.min(
        INITIAL_TOKENS,
        estimatedTokens(document.body),
      ),
      availability: {
        mode: pruning.gaps.length ? 'preparation_only' : document.contract.mode,
        available_steps: pruning.steps.length,
        unavailable_steps:
          document.contract.steps.length - pruning.steps.length,
        restrictions: pruning.gaps,
      },
    };
  }

  private state(session: PlaybookSession): SessionState {
    const state = this.sessions.get(session);
    if (!state) throw new Error('PLAYBOOK_SESSION_REQUIRED');
    this.assertScope(state.scope);
    return state;
  }

  private assertScope(scope: PlaybookScope): void {
    // Never RequestContextService.getContext(): its static fallback can belong to another tenant.
    const current = RequestContextService.asyncLocalStorage.getStore();
    if (
      !current ||
      !scope ||
      !(['organization_id', 'store_id', 'user_id'] as const).every(
        (key) =>
          Number.isSafeInteger(scope[key]) &&
          scope[key] > 0 &&
          current[key] === scope[key],
      )
    )
      throw new Error('PLAYBOOK_SCOPE_MISMATCH');
  }

  private isAllowed(name: string, state: SessionState): boolean {
    const canonical = this.registry.canonicalName(name);
    const tool = this.registry.get(canonical);
    const permissions =
      RequestContextService.asyncLocalStorage.getStore()?.permissions ?? [];
    return (
      state.allowed.has(canonical) &&
      !!tool &&
      (tool.requiredPermissions ?? []).every((permission) =>
        permissions.includes(permission),
      )
    );
  }

  private prune(
    document: PlaybookDocument,
    state: SessionState,
  ): { steps: PlaybookStep[]; gaps: string[] } {
    const gaps = [...document.contract.gaps];
    const blocked = new Set<string>();
    const permissions =
      RequestContextService.asyncLocalStorage.getStore()?.permissions ?? [];
    for (const step of document.contract.steps) {
      const tool = step.tool
        ? this.registry.get(this.registry.canonicalName(step.tool))
        : undefined;
      if (
        document.contract.mode === 'preparation_only' &&
        (tool?.requiresConfirmation ||
          (step.bridge && step.bridge.method !== 'GET'))
      ) {
        blocked.add(step.id);
        gaps.push(
          `preparation_only_write:${step.id}:${step.tool ?? step.bridge?.method}`,
        );
      }
      if (step.tool && !this.isAllowed(step.tool, state)) {
        blocked.add(step.id);
        gaps.push(`tool_unavailable:${step.id}:${step.tool}`);
      }
      if (step.bridge) {
        const endpoint = this.apiCatalog.find(
          step.bridge.path,
          step.bridge.method,
        );
        if (
          !endpoint ||
          !endpoint.requiredPermissions.every((permission) =>
            permissions.includes(permission),
          )
        ) {
          blocked.add(step.id);
          gaps.push(
            `endpoint_unavailable:${step.id}:${step.bridge.method}:${step.bridge.path}`,
          );
        }
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const step of document.contract.steps) {
        if (
          !blocked.has(step.id) &&
          step.depends_on.some((dependency) => blocked.has(dependency))
        ) {
          blocked.add(step.id);
          changed = true;
          gaps.push(
            `dependency_unavailable:${step.id}:${step.depends_on.filter((dependency) => blocked.has(dependency)).join(',')}`,
          );
        }
      }
    }
    return {
      steps: structuredClone(
        document.contract.steps.filter((step) => !blocked.has(step.id)),
      ),
      gaps,
    };
  }
}
