import { readFileSync } from 'node:fs';
import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { catalogHash, stableJson } from '../tools/tool-catalog';
import { AIToolRegistry } from '../tools/ai-tool-registry';
import { PlaybookLoaderService } from '../playbooks/playbook-loader.service';
import { PLAYBOOK_VERIFIERS } from '../playbooks/playbook-verifiers';
import {
  AgentRecipe,
  RecipeReview,
  RecipeTemplate,
  RECIPE_POLICY_VERSION,
} from './recipe.interface';

@Injectable()
export class RecipeQualityService {
  constructor(
    private readonly playbooks: PlaybookLoaderService,
    private readonly registry: AIToolRegistry,
  ) {}

  /** Whitelist projection from RELEASE code. No goal, args, outputs, names or prose from traces. */
  template(workflow: string): RecipeTemplate {
    const document = this.playbooks
      .getPlaybooks()
      .find((d) => d.metadata.workflow_key === workflow);
    if (
      !document ||
      document.contract.mode !== 'executable' ||
      !document.metadata.verifier_ids.length
    )
      throw new Error('RECIPE_UNSUPPORTED_WORKFLOW');
    const tools = document.metadata.tool_contracts.map((pin) => {
      const tool = this.registry.get(pin.name);
      if (!tool || this.registry.getToolVersion(pin.name) !== pin.version)
        throw new Error('RECIPE_TOOL_DRIFT');
      return {
        ...pin,
        hash: catalogHash({
          parameters: tool.parameters,
          permissions: tool.requiredPermissions ?? [],
          readOnly: tool.readOnly === true,
          confirmation: tool.requiresConfirmation === true,
          clientSide: tool.clientSide === true,
        }),
      };
    });
    const verifierRelease = catalogHash([
      readFileSync(require.resolve('../playbooks/playbook-verifiers'), 'utf8'),
      readFileSync(require.resolve('../tasks/agent-verifier.service'), 'utf8'),
    ]);
    const verifiers = document.metadata.verifier_ids.map((id) => {
      const verifier = PLAYBOOK_VERIFIERS[id];
      if (!verifier) throw new Error('RECIPE_VERIFIER_DRIFT');
      return { id, hash: catalogHash([verifierRelease, verifier.toString()]) };
    });
    return structuredClone({
      kind: 'declarative',
      workflow,
      playbook: {
        id: document.id,
        version: document.metadata.version,
        hash: document.hash,
      },
      policy: `${RECIPE_POLICY_VERSION}:${catalogHash([
        readFileSync(__filename, 'utf8'),
        readFileSync(require.resolve('./procedural-memory.service'), 'utf8'),
        readFileSync(require.resolve('./recipe.repository'), 'utf8'),
        readFileSync(require.resolve('./recipe.interface'), 'utf8'),
        this.reviewTtlDays(),
      ])}`,
      industry: document.metadata.industry,
      inputs: document.contract.inputs,
      steps: document.contract.steps,
      verifiers,
      tools,
      required_permissions: document.metadata.required_permissions,
      preconditions: [
        'fresh_setup',
        'resolve_all_inputs_again',
        'fresh_stock_price_balance_fiscal_reads',
        'new_preview_and_individual_approval_for_every_write',
      ],
      known_failures: [
        'permission_revoked',
        'setup_changed',
        'verifier_failed',
        'unknown_effect_requires_reconciliation',
      ],
      examples: document.contract.examples.map((e) => ({
        kind: e.kind,
        synthetic: true as const,
        expected: e.expected,
      })),
    });
  }

  compatible(recipe: AgentRecipe): boolean {
    try {
      return (
        recipe.template.kind === 'declarative' &&
        recipe.content_hash === catalogHash(recipe.template) &&
        catalogHash(this.template(recipe.template.workflow)) ===
          recipe.content_hash
      );
    } catch {
      return false;
    }
  }

  /** No regex scrub can make arbitrary model text safe: reject anything not the exact release projection. */
  assertClean(template: RecipeTemplate): void {
    if (catalogHash(template) !== catalogHash(this.template(template.workflow)))
      throw new Error('RECIPE_UNTRUSTED_TEMPLATE');
  }

  validateReview(
    recipe: AgentRecipe,
    review: RecipeReview,
    global = false,
  ): void {
    this.assertClean(recipe.template);
    if (!review || Buffer.byteLength(JSON.stringify(review), 'utf8') > 64000)
      throw new Error('RECIPE_REVIEW_INVALID');
    const exactKeys = (value: object, keys: string[]) =>
      Object.keys(value).sort().join(',') === [...keys].sort().join(',');
    if (
      !exactKeys(review, [
        'stage',
        'recipe_id',
        'content_hash',
        'reviewer_id',
        'process_owner',
        'reviewed_at',
        'expires_at',
        'evaluation_version',
        'on_off_comparable',
        'runs',
        'signature',
      ])
    )
      throw new Error('RECIPE_REVIEW_INVALID');
    const key = process.env.AI_RECIPE_REVIEW_KEY;
    if (!key || !/^[a-f0-9]{64}$/i.test(key))
      throw new Error('RECIPE_REVIEW_AUTHORITY_UNAVAILABLE');
    const { signature, ...signed } = review ?? {};
    if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature))
      throw new Error('RECIPE_REVIEW_SIGNATURE');
    const expected = createHmac('sha256', Buffer.from(key, 'hex'))
      .update(stableJson(signed))
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
      throw new Error('RECIPE_REVIEW_SIGNATURE');
    const at = Date.parse(review.reviewed_at),
      until = Date.parse(review.expires_at);
    const ttlDays = this.reviewTtlDays();
    if (
      review.recipe_id !== recipe.id ||
      review.content_hash !== recipe.content_hash ||
      !Number.isSafeInteger(review.reviewer_id) ||
      review.reviewer_id <= 0 ||
      review.process_owner !== this.owner(recipe.template.workflow) ||
      !/^[a-zA-Z0-9._-]{1,80}$/.test(review.evaluation_version) ||
      review.on_off_comparable !== true ||
      !Number.isFinite(at) ||
      at > Date.now() ||
      Date.now() - at > 86400000 ||
      !Number.isFinite(until) ||
      until <= Date.now() ||
      until - at > ttlDays * 86400000 ||
      !['reviewed', 'approved', 'global'].includes(review.stage) ||
      (global &&
        (review.stage !== 'global' ||
          review.reviewer_id === recipe.review?.reviewer_id))
    )
      throw new Error('RECIPE_REVIEW_INVALID');
    const runs = review.runs;
    if (
      !Array.isArray(runs) ||
      runs.length < 8 ||
      runs.length > 100 ||
      new Set(runs.map((r) => r.fixture_hash)).size !== runs.length ||
      runs.filter((r) => r.split === 'replay').length < 5 ||
      runs.filter((r) => r.split === 'holdout').length < 3
    )
      throw new Error('RECIPE_HOLDOUT_REQUIRED');
    for (const run of runs) {
      if (
        !exactKeys(run, [
          'fixture_hash',
          'split',
          'synthetic_tenant',
          'provider',
          'model_fingerprint',
          'verified',
          'violations',
          'duplicates',
          'recipe_discovery_calls',
          'control_discovery_calls',
          'recipe_cost_usd',
          'control_cost_usd',
          'control_verified',
        ]) ||
        !/^[a-f0-9]{64}$/.test(run.model_fingerprint) ||
        !/^[a-f0-9]{64}$/.test(run.fixture_hash) ||
        !/^synthetic-[a-z0-9-]{1,40}$/.test(run.synthetic_tenant) ||
        !['replay', 'holdout'].includes(run.split) ||
        !['openai-compatible', 'anthropic-compatible'].includes(run.provider) ||
        run.verified !== true ||
        run.violations !== 0 ||
        run.duplicates !== 0 ||
        run.control_verified !== true ||
        run.control_cost_usd <= 0 ||
        run.control_discovery_calls <= 0 ||
        ![run.recipe_discovery_calls, run.control_discovery_calls].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        ) ||
        ![run.recipe_cost_usd, run.control_cost_usd].every(
          (n) => Number.isFinite(n) && n >= 0,
        )
      )
        throw new Error('RECIPE_REPLAY_FAILED');
    }
    const totals = runs.reduce(
      (a, r) => ({
        recipe: a.recipe + r.recipe_discovery_calls,
        control: a.control + r.control_discovery_calls,
        cost: a.cost + r.recipe_cost_usd,
        controlCost: a.controlCost + r.control_cost_usd,
      }),
      { recipe: 0, control: 0, cost: 0, controlCost: 0 },
    );
    if (
      !totals.control ||
      !totals.controlCost ||
      totals.recipe > totals.control * 0.8 ||
      totals.cost > totals.controlCost * 0.8
    )
      throw new Error('RECIPE_ON_OFF_GATE');
    if (
      global &&
      (new Set(runs.map((r) => r.synthetic_tenant)).size < 2 ||
        new Set(runs.map((r) => r.provider)).size < 2 ||
        new Set(runs.map((r) => `${r.synthetic_tenant}:${r.provider}`)).size <
          4)
    )
      throw new Error('RECIPE_GLOBAL_COVERAGE');
  }
  /** Persisted approval is independently authenticated on retrieval, including its two human review stages. */
  publicationValid(recipe: AgentRecipe): boolean {
    try {
      const key = process.env.AI_RECIPE_REVIEW_KEY;
      if (
        !key ||
        !/^[a-f0-9]{64}$/i.test(key) ||
        recipe.status !== 'approved' ||
        !recipe.review ||
        !recipe.review_history ||
        recipe.review_history.length < 2
      )
        return false;
      const history = recipe.review_history;
      if (history.length > 100) return false;
      for (const review of history) {
        const { signature, ...signed } = review;
        if (
          !/^[a-f0-9]{64}$/.test(signature) ||
          review.recipe_id !== recipe.id ||
          review.content_hash !== recipe.content_hash ||
          review.process_owner !== this.owner(recipe.template.workflow) ||
          !timingSafeEqual(
            Buffer.from(signature, 'hex'),
            createHmac('sha256', Buffer.from(key, 'hex'))
              .update(stableJson(signed))
              .digest(),
          )
        )
          return false;
      }
      const prior = history[history.length - 2],
        last = history[history.length - 1];
      if (
        catalogHash(last) !== catalogHash(recipe.review) ||
        prior.stage !== 'reviewed' ||
        last.stage !==
          (recipe.knowledge_scope === 'global' ? 'global' : 'approved') ||
        (recipe.knowledge_scope === 'global' &&
          prior.reviewer_id === last.reviewer_id) ||
        !recipe.expires_at ||
        Date.parse(last.expires_at) !== new Date(recipe.expires_at).getTime()
      )
        return false;
      if (recipe.knowledge_scope === 'global')
        return (
          recipe.store_id === null &&
          recipe.organization_id === null &&
          recipe.user_id === null &&
          [
            recipe.source_trace_ids,
            recipe.source_objective_ids,
            recipe.source_evidence_refs,
            recipe.source_script_refs,
          ].every((refs) => Array.isArray(refs) && refs.length === 0)
        );
      return (
        recipe.source_objective_ids.length > 0 &&
        recipe.source_evidence_refs.length > 0
      );
    } catch {
      return false;
    }
  }

  private reviewTtlDays(): number {
    const ttl =
      process.env.AI_RECIPE_REVIEW_TTL_DAYS === undefined
        ? 30
        : Number(process.env.AI_RECIPE_REVIEW_TTL_DAYS);
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 30)
      throw new Error('RECIPE_REVIEW_POLICY_INVALID');
    return ttl;
  }
  private owner(workflow: string): string | undefined {
    return this.playbooks
      .getPlaybooks()
      .find((d) => d.metadata.workflow_key === workflow)?.metadata.owner;
  }
}
