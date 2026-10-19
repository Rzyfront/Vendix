/** Deterministic SYNTHETIC transport fixtures. Never production recipes/review evidence. */
import { AIToolRegistry } from '../../src/ai-engine/tools/ai-tool-registry';
import { RecipeQualityService } from '../../src/ai-engine/memory/recipe-quality.service';
import {
  catalogHash,
  stableJson,
} from '../../src/ai-engine/tools/tool-catalog';
import { createHmac } from 'node:crypto';
import {
  AgentRecipe,
  RecipeReview,
} from '../../src/ai-engine/memory/recipe.interface';
import type { PlaybookDocument } from '../../src/ai-engine/playbooks/playbook.interface';
import { PlaybookLoaderService } from '../../src/ai-engine/playbooks/playbook-loader.service';
export const scope = { store_id: 7, organization_id: 3, user_id: 11 };
export const objectiveId = '00000000-0000-4000-8000-000000000001';
export const evidenceId = '00000000-0000-4000-8000-000000000002';
export const context = {
  ...scope,
  is_owner: true,
  is_super_admin: false,
  permissions: ['customers:read', 'customers:write'],
};
export function fixture() {
  const registry = new AIToolRegistry({} as never);
  registry.registerMany([
    {
      name: 'lookup_customer',
      domain: 'customers',
      readOnly: true,
      version: '1',
      requiredPermissions: ['customers:read'],
      parameters: {
        type: 'object',
        properties: { documento: { type: 'string' } },
      },
      description: 'Read',
      handler: async () => JSON.stringify({ id: 99, stock: 1 }),
    },
    {
      name: 'upsert_customer',
      domain: 'customers',
      version: '1',
      requiresConfirmation: true,
      requiredPermissions: ['customers:write'],
      parameters: { type: 'object', properties: {} },
      description: 'Write',
      preview: async () => ({}) as never,
      handler: async () => {
        throw new Error('MUST_NOT_EXECUTE');
      },
    },
  ]);
  const doc = {
    id: 'crear-cliente',
    name: 'Crear cliente',
    description: 'Crear cliente',
    hash: catalogHash('synthetic-release'),
    body: 'release',
    source: 'release',
    sections: [],
    metadata: {
      version: '1.0.0',
      owner: 'process-owner',
      industry: ['all'],
      workflow_key: 'crear-cliente',
      tool_contracts: [
        { name: 'lookup_customer', version: '1' },
        { name: 'upsert_customer', version: '1' },
      ],
      required_permissions: context.permissions,
      verifier_ids: ['crear-cliente:v1'],
    },
    contract: {
      schema_version: '1',
      mode: 'executable',
      gaps: [],
      inputs: [
        {
          key: 'documento',
          source: 'user',
          required: true,
          description: 'Nuevo documento',
        },
      ],
      steps: [
        {
          id: 'read',
          section: 'steps',
          tool: 'lookup_customer',
          arguments: { documento: '${inputs.documento}' },
          instruction: 'Lee documento nuevo',
          depends_on: [],
          approval: 'none',
        },
        {
          id: 'write',
          section: 'steps',
          tool: 'upsert_customer',
          instruction: 'Proponer; aprobación individual NUEVA',
          depends_on: ['read'],
          approval: 'individual',
        },
      ],
      examples: [
        { kind: 'happy', expected: 'verified' },
        { kind: 'sad', expected: 'not_verified' },
      ],
    },
  } as unknown as PlaybookDocument;
  const loader = {
    getPlaybooks: () => [doc],
  } as unknown as PlaybookLoaderService;
  const quality = new RecipeQualityService(loader, registry),
    template = quality.template('crear-cliente');
  const recipe = {
    id: 41,
    knowledge_scope: 'store',
    ...scope,
    recipe_key: 'workflow:crear-cliente',
    version: '1.0.0-test',
    template,
    content_hash: catalogHash(template),
    status: 'approved',
    source_trace_ids: ['private-trace'],
    source_objective_ids: [objectiveId],
    source_evidence_refs: [`agent-result:${evidenceId}`],
    source_script_refs: [],
    review: null,
    review_history: [],
    approved_at: new Date(),
    expires_at: new Date(Date.now() + 86400000),
    usage_count: 0,
    success_count: 0,
    failure_count: 0,
    invalidation_count: 0,
    created_at: new Date(),
  } as AgentRecipe;
  if (process.env.AI_RECIPE_REVIEW_KEY) {
    const reviewed = signReview(recipe),
      approved = signReview(recipe, { stage: 'approved' });
    recipe.review = approved;
    recipe.review_history = [reviewed, approved];
    recipe.expires_at = new Date(approved.expires_at);
  }
  return { registry, quality, recipe, doc, loader };
}
export function signReview(
  recipe: AgentRecipe,
  overrides: Partial<RecipeReview> = {},
): RecipeReview {
  const value = {
    stage: 'reviewed',
    recipe_id: recipe.id,
    content_hash: recipe.content_hash,
    reviewer_id: 11,
    process_owner: 'process-owner',
    reviewed_at: new Date(Date.now() - 1000).toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    evaluation_version: 'synthetic-test-v1',
    on_off_comparable: true,
    runs: Array.from({ length: 8 }, (_, i) => ({
      fixture_hash: catalogHash(i),
      split: i < 5 ? 'replay' : 'holdout',
      synthetic_tenant: `synthetic-${i % 2 ? 'b' : 'a'}`,
      provider: i % 4 < 2 ? 'openai-compatible' : 'anthropic-compatible',
      model_fingerprint: catalogHash('test-model'),
      verified: true,
      violations: 0,
      duplicates: 0,
      recipe_discovery_calls: 2,
      control_discovery_calls: 4,
      recipe_cost_usd: 0.01,
      control_cost_usd: 0.02,
      control_verified: true,
    })),
    ...overrides,
  } as RecipeReview;
  const { signature, ...unsigned } = value;
  return {
    ...unsigned,
    signature: createHmac(
      'sha256',
      Buffer.from(process.env.AI_RECIPE_REVIEW_KEY!, 'hex'),
    )
      .update(stableJson(unsigned))
      .digest('hex'),
  };
}
