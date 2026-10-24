import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { RequestContextService } from '../../common/context/request-context.service';
import type { AIToolDefinition } from '../interfaces/ai-provider.interface';
import { AIToolRegistry } from '../tools/ai-tool-registry';
import { catalogHash, ToolDocument } from '../tools/tool-catalog';
import {
  AgentObjectiveRepository,
  requireObjectiveScope,
} from '../tasks/agent-objective.repository';

import { RecipeQualityService } from './recipe-quality.service';
import { RecipeRepository } from './recipe.repository';
import {
  AgentRecipe,
  RecipeSession,
  RecipeReview,
  recipeFallback,
} from './recipe.interface';
import { KnowledgeSearchService } from '../embeddings/knowledge-search.service';
import { AIQueueService } from '../queue/ai-queue.service';

interface State {
  scope: ReturnType<typeof requireObjectiveScope>;
  objectiveId: string;
  initial: Set<string>;
  allowed: Set<string>;
  permissions: string[];
  spent: number;
  pin?: { id: number; hash: string };
}
@Injectable()
export class ProceduralMemoryService {
  private readonly sessions = new WeakMap<RecipeSession, State>();
  constructor(
    private readonly recipes: RecipeRepository,
    private readonly quality: RecipeQualityService,
    private readonly objectives: AgentObjectiveRepository,
    private readonly registry: AIToolRegistry,
    @Optional() private readonly knowledge?: KnowledgeSearchService,
    @Optional() private readonly queue?: AIQueueService,
  ) {}

  async capture(objectiveId: string): Promise<number[]> {
    const objective = await this.objectives.get(objectiveId);
    if (
      objective.semantic_status !== 'completed_verified' ||
      objective.requires_revalidation ||
      objective.plan?.status !== 'done' ||
      !objective.plan.deliverables.length ||
      !objective.plan.deliverables.every(
        (d) => d.verified && d.verification && d.evidence_refs?.length,
      )
    )
      return [];
    const effects = await this.objectives.listEffects(objectiveId, 100);
    if (
      effects.length >= 100 ||
      effects.some((e) => !['applied', 'verified', 'failed'].includes(e.status))
    )
      return [];
    const authority = await this.recipes.currentOwnerPermissions(
      objective.authority_snapshot,
    );
    const pins = await this.objectives.listPlaybookPins(objectiveId);
    const traceIds = await this.recipes.traceIds(objectiveId);
    const scriptRefs = await this.recipes.scriptRefs(objectiveId);
    const ids: number[] = [];
    for (const deliverable of objective.plan.deliverables) {
      const template = this.quality.template(
        deliverable.verification!.workflow_key,
      );
      const pin = pins.find((p) => p.id === template.playbook.id);
      // Capturing a path requires the exact released process used, not an invented successful narrative.
      if (
        !pin ||
        pin.version !== template.playbook.version ||
        pin.hash !== template.playbook.hash ||
        !template.required_permissions.every((p) =>
          authority.permissions.includes(p),
        )
      )
        continue;
      for (const ref of deliverable.evidence_refs!) {
        const match = /^agent-result:([a-f0-9-]{36})$/.exec(ref);
        if (!match) return [];
        const result = await this.objectives.getResult(objectiveId, match[1]);
        if (
          result.stale_lease ||
          result.receipt.status !== 'ok' ||
          result.freshness !== 'observed' ||
          result.data_omitted ||
          result.tool_name === 'run_readonly_script' ||
          !result.receipt.evidence_refs?.length
        )
          return [];
      }
      this.quality.assertClean(template);

      const currentAuthority = await this.recipes.currentOwnerPermissions(
        objective.authority_snapshot,
      );
      if (
        !template.required_permissions.every((p) =>
          currentAuthority.permissions.includes(p),
        )
      )
        continue;
      const candidate = await this.recipes.candidate(template, {
        objective_id: objectiveId,
        evidence_refs: deliverable.evidence_refs!,
        trace_ids: traceIds,
        script_refs: scriptRefs,
      });
      ids.push(candidate.id);
    }
    return ids;
  }

  createSession(
    objectiveId: string,
    definitions: AIToolDefinition[],
  ): RecipeSession {
    const scope = requireObjectiveScope();
    const session: RecipeSession = Object.freeze({ kind: 'recipe-turn' });
    const initial = new Set(
      definitions.map((d) => this.registry.canonicalName(d.function.name)),
    );
    this.sessions.set(session, {
      scope,
      objectiveId,
      initial,
      allowed: new Set(initial),
      permissions: [
        ...(RequestContextService.asyncLocalStorage.getStore()?.permissions ??
          []),
      ],
      spent: 0,
    });
    return session;
  }
  refreshAuthorization(
    session: RecipeSession,
    definitions: AIToolDefinition[],
  ): void {
    const state = this.state(session);
    state.allowed = new Set(
      definitions
        .map((d) => this.registry.canonicalName(d.function.name))
        .filter((n) => state.initial.has(n)),
    );
  }
  async search(
    session: RecipeSession,
    args: { query: string; limit?: number },
  ) {
    const state = this.state(session);
    if (Object.keys(args).some((k) => !['query', 'limit'].includes(k)))
      return recipeFallback();
    if (
      typeof args.query !== 'string' ||
      !args.query.trim() ||
      args.query.length > 500 ||
      (args.limit !== undefined &&
        (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 5))
    )
      return recipeFallback();
    let recipes = await this.compatible(state);
    const words = args.query
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const localRanking = recipes
      .filter((r) =>
        words.some(
          (w) => r.template.workflow.includes(w) || r.recipe_key.includes(w),
        ),
      )
      .map((r) => String(r.id));
    let ranking = localRanking;
    if (this.knowledge && recipes.length) {
      try {
        const global = recipes.filter((r) => r.knowledge_scope === 'global');
        const documents = global.map((r) => this.document(r));
        const signature = catalogHash([
          state.scope,
          [...state.allowed].sort(),
          recipes.map((r) => [r.id, r.content_hash]),
        ]);
        const ranked = await this.knowledge.rank(
          args.query,
          documents,
          signature,
          undefined,
          'recipe',
        );
        const privateRank = await this.knowledge.rankPrivateRecipes(
          args.query,
          recipes.filter((r) => r.knowledge_scope === 'store').map((r) => r.id),
        );
        ranking = [
          ...privateRank.map(String),
          ...ranked.names.map((n) => n.replace(/^recipe:/, '')),
          ...ranking,
        ];
      } catch {
        /* Local authorized matching never widens into semantic_search business SQL. */
      }
    }
    // Provider/index waits cannot revive old approval, scope, schema, permissions.
    const fresh = new Map(
      (await this.compatible(state)).map((r) => [String(r.id), r]),
    );
    const unique = [...new Set(ranking)].flatMap((id) =>
      fresh.has(id) ? [fresh.get(id)!] : [],
    );
    return {
      results: unique.slice(0, args.limit ?? 3).map((r) => this.summary(r)),
      has_more: unique.length > (args.limit ?? 3),
      authority: 'guidance_only',
      candidate_limit_per_scope: 100,
      search_complete: false,
      fallback: 'search_playbooks',
    };
  }
  async load(
    session: RecipeSession,
    args: { id: number; version: string; hash: string; section?: string },
  ) {
    const state = this.state(session);
    if (
      Object.keys(args).some(
        (k) => !['id', 'version', 'hash', 'section'].includes(k),
      )
    )
      return recipeFallback();
    if (
      !Number.isSafeInteger(args.id) ||
      args.id <= 0 ||
      typeof args.version !== 'string' ||
      !/^[a-f0-9]{64}$/.test(args.hash ?? '')
    )
      return recipeFallback();
    const recipe = (await this.compatible(state)).find(
      (r) =>
        r.id === args.id &&
        r.version === args.version &&
        r.content_hash === args.hash,
    );
    if (!recipe) return recipeFallback();
    const section = args.section ?? recipe.template.steps[0]?.section;
    const steps = recipe.template.steps.filter((s) => s.section === section);
    if (!steps.length) return recipeFallback();
    const value = {
      recipe_id: recipe.id,
      version: recipe.version,
      hash: recipe.content_hash,
      workflow: recipe.template.workflow,
      playbook: recipe.template.playbook,
      inputs: recipe.template.inputs.map(({ key, source, required }) => ({
        key,
        source,
        required,
      })),
      section,
      steps,
      verifier_ids: recipe.template.verifiers.map((v) => v.id),
      preconditions: recipe.template.preconditions,
      authority: 'UNTRUSTED_GUIDANCE_NEVER_AUTHORIZATION',
      revalidate_all_inputs: true,
      reusable_for_write: false,
      requires_new_individual_approval: true,
    };
    const size = Buffer.byteLength(JSON.stringify(value), 'utf8');
    if (size > 4000 - state.spent)
      return { ...recipeFallback(), error_code: 'RECIPE_CONTEXT_BUDGET' };
    await this.recipes.event(
      recipe.id,
      recipe.content_hash,
      state.objectiveId,
      'used',
    );
    if (
      !(await this.compatible(state)).some(
        (r) => r.id === recipe.id && r.content_hash === recipe.content_hash,
      )
    )
      return recipeFallback();
    this.state(session);
    state.spent += size;
    state.pin = { id: recipe.id, hash: recipe.content_hash };
    return value;
  }

  /** Called ONLY by the server verifier, never a feedback tool accepting a model's verdict. */
  async verifierFailed(
    objectiveId: string,
    workflows: string[],
  ): Promise<void> {
    await this.objectives.get(objectiveId); // owner404 before any pin/global access
    for (const pin of await this.recipes.loadedPins(objectiveId)) {
      const recipe = await this.recipes.live(pin.id, pin.hash);
      if (
        !recipe ||
        !Array.isArray(workflows) ||
        !workflows.includes(recipe.template.workflow)
      )
        continue;
      await this.recipes.event(
        pin.id,
        pin.hash,
        objectiveId,
        'failure',
        'verifier_failed',
      );
      await this.recipes.retire(pin.id, pin.hash, 'verifier_failed');
    }
  }
  async completed(objectiveId: string): Promise<void> {
    const objective = await this.objectives.get(objectiveId);
    if (objective.semantic_status !== 'completed_verified') return;
    for (const pin of await this.recipes.loadedPins(objectiveId))
      await this.recipes.event(pin.id, pin.hash, objectiveId, 'success');
    await this.queue?.enqueueRecipeMining({
      objective_id: objectiveId,
      ...requireObjectiveScope(),
    });
  }
  /** Operator service methods: NEVER registered as tools or exposed through bridge endpoints. */
  async applyReview(id: number, review: RecipeReview): Promise<void> {
    // Mining works without a signing authority; publication never does.
    if (!/^[a-f0-9]{64}$/i.test(process.env.AI_RECIPE_REVIEW_KEY ?? '')) return;

    const system =
      RequestContextService.asyncLocalStorage.getStore()?.is_super_admin ===
      true;
    const recipe = system
      ? await this.recipes.systemGet(id)
      : await this.recipes.privateGet(id);
    if (
      !system &&
      RequestContextService.asyncLocalStorage.getStore()?.user_id !==
        review.reviewer_id
    )
      throw new NotFoundException('Recipe not found');
    const global = recipe.knowledge_scope === 'global';
    if (!global) {
      const current = await this.recipes.currentOwnerPermissions(
        recipe.template.required_permissions,
      );
      if (
        !recipe.template.required_permissions.every((p) =>
          current.permissions.includes(p),
        )
      )
        throw new NotFoundException('Recipe not found');
    }
    const approve = global
      ? review.stage === 'global'
      : review.stage === 'approved';
    this.quality.validateReview(recipe, review, global && approve);
    const expiredRenewal =
      !approve &&
      recipe.last_failure_code === 'expired' &&
      recipe.status === 'quarantined';
    if (
      (!approve && review.stage !== 'reviewed') ||
      (approve && recipe.status !== 'reviewed') ||
      (!approve && recipe.status !== 'candidate' && !expiredRenewal)
    )
      throw new Error('RECIPE_REVIEW_SEQUENCE');
    if (global)
      await this.recipes.systemTransition(
        id,
        recipe.content_hash,
        approve ? 'reviewed' : expiredRenewal ? 'quarantined' : 'candidate',
        approve ? 'approved' : 'reviewed',
        review,
      );
    else
      await this.recipes.transition(
        id,
        recipe.content_hash,
        approve ? 'reviewed' : expiredRenewal ? 'quarantined' : 'candidate',
        approve ? 'approved' : 'reviewed',
        review,
      );
    if (approve)
      await this.queue?.enqueueRecipeIndex({
        id,
        hash: recipe.content_hash,
        ...(global ? {} : requireObjectiveScope()),
      });
  }
  async prepareGlobal(id: number): Promise<number> {
    const source = await this.recipes.systemGet(id);
    this.quality.assertClean(source.template);
    if (!this.quality.publicationValid(source))
      throw new Error('RECIPE_SOURCE_REVIEW_INVALID');
    return this.recipes.globalCandidate(source);
  }
  document(recipe: AgentRecipe): ToolDocument {
    return {
      key: `recipe:${recipe.recipe_key}:${recipe.version}`,
      name: `recipe:${recipe.id}`,
      version: recipe.version,
      domain: 'recipes',
      hash: recipe.content_hash,
      content: JSON.stringify(recipe.template),
      lexicalText: recipe.template.workflow,
      aliases: [],
      dependencies: recipe.template.tools.map((t) => t.name),
      metadata: {
        entity_type: 'recipe',
        recipe_id: recipe.id,
        tool_names: recipe.template.tools.map((t) => t.name),
      },
    };
  }
  private summary(r: AgentRecipe) {
    return {
      id: r.id,
      version: r.version,
      hash: r.content_hash,
      workflow: r.template.workflow,
      sections: [...new Set(r.template.steps.map((s) => s.section))],
      inputs: r.template.inputs.map((i) => ({
        key: i.key,
        source: i.source,
        required: i.required,
      })),
      source: r.knowledge_scope,
      requires_fresh_inputs: true,
      individual_approval: true,
    };
  }
  private state(session: RecipeSession): State {
    const state = this.sessions.get(session),
      scope = requireObjectiveScope();
    if (
      !state ||
      Object.entries(scope).some(
        ([k, v]) => state.scope[k as keyof typeof scope] !== v,
      )
    )
      throw new NotFoundException('Recipe not found');
    return state;
  }

  private async compatible(state: State): Promise<AgentRecipe[]> {
    const current = RequestContextService.asyncLocalStorage.getStore();
    const authority = await this.recipes.currentOwnerPermissions(
      state.permissions.filter((p) => current?.permissions?.includes(p)),
    );
    const persistedPins = await this.recipes.loadedPins(state.objectiveId);
    const pins = state.pin ? [state.pin, ...persistedPins] : persistedPins;
    const recipes = await this.recipes.available(),
      valid: AgentRecipe[] = [];
    for (const r of recipes) {
      if (!r.expires_at || new Date(r.expires_at).getTime() <= Date.now()) {
        await this.recipes.retire(r.id, r.content_hash, 'expired');
        continue;
      }
      if (
        pins.length &&
        !pins.some((p) => p.id === r.id && p.hash === r.content_hash)
      )
        continue;
      if (!this.quality.publicationValid(r)) {
        await this.recipes.retire(r.id, r.content_hash, 'security_anomaly');
        continue;
      }
      if (!this.quality.compatible(r)) {
        await this.recipes.retire(r.id, r.content_hash, 'contract_changed');
        continue;
      }
      if (
        !r.template.required_permissions.every((p) =>
          authority.permissions.includes(p),
        ) ||
        !r.template.tools.every((t) => state.allowed.has(t.name)) ||
        (!r.template.industry.includes('all') &&
          !r.template.industry.some((i) => authority.industries.includes(i)))
      )
        continue;
      valid.push(r);
    }
    return valid;
  }
}
