import type { AgentObjectiveRepository } from './agent-objective.repository';
import { AgentTaskContextService } from './agent-task-context.service';
import type {
  AgentObjective,
  AgentToolResult,
  ObjectiveEntity,
} from './interfaces/agent-objective.interface';

const ID = '00000000-0000-4000-8000-000000000001';
const artifactId = '00000000-0000-4000-8000-000000000002';
const entity: ObjectiveEntity = {
  store_id: 10,
  type: 'product_id',
  id: 55,
  source_call_id: 'call-5',
  observed_at: '2026-10-17T00:00:00Z',
  valid_until: '2099-01-01T00:00:00Z',
  resource_version: 'v2',
  facts: { quantity: 7, unit: 'kg', date: '2026-10-18', subtotal: 140 },
};
const objective = () =>
  ({
    id: ID,
    goal: 'Revisar productos',
    plan: null,
    semantic_status: 'partial',
    requires_revalidation: true,
    next_step: 'Preparar propuesta, sin aplicar',
    entities: [entity],
    budget: { tools: 4, provider_attempts: 2 },
  }) as AgentObjective;
const storedResult = () =>
  ({
    id: artifactId,
    tool_call_id: 'call-5',
    tool_name: 'read_product',
    tool_version: '1',
    resource_ids: { product_id: 55 },
    receipt: { status: 'ok' },
    pagination: { complete: false, has_more: true, next_cursor: 2 },
    freshness: 'observed',
    created_at: new Date('2026-10-17T00:00:00Z'),
    stale_lease: false,
    data: { quantity: 7, unit: 'kg', date: '2026-10-18', subtotal: 140 },
    data_omitted: false,
  }) as AgentToolResult;

describe('AgentTaskContextService', () => {
  let get: jest.Mock;
  let listResults: jest.Mock;
  let context: AgentTaskContextService;
  let listEffects: jest.Mock;
  beforeEach(() => {
    get = jest.fn().mockResolvedValue(objective());
    listResults = jest.fn().mockResolvedValue({
      items: [storedResult()],
      has_more: false,
      next_cursor: null,
    });
    listEffects = jest.fn().mockResolvedValue([]);
    context = new AgentTaskContextService({
      get,
      listResults,
      listEffects,
      listPlaybookPins: jest.fn().mockResolvedValue([]),
    } as unknown as AgentObjectiveRepository);
  });

  it('restores structured IDs/quantities/units/date/calculations independently from 25-message/reload history', async () => {
    const first = await context.build(ID);
    for (let i = 0; i < 25; i++) {
      const reloaded = new AgentTaskContextService({
        get,
        listResults,
        listEffects,
        listPlaybookPins: jest.fn().mockResolvedValue([]),
      } as unknown as AgentObjectiveRepository);
      const restored = await reloaded.build(ID);
      const facts = JSON.parse(restored.context);
      expect(facts.entities[0]).toMatchObject({
        id: 55,
        source_call_id: 'call-5',
        facts: { quantity: 7, unit: 'kg', date: '2026-10-18', subtotal: 140 },
      });
      expect(restored.context).toBe(first.context);
      expect(facts.results[0].call_id).toBe('call-5');
    }
    // There is no tool/resolver dependency here: the ID is recovered from durable provenance.
    expect(get).toHaveBeenCalledTimes(26);
    expect(listResults).toHaveBeenCalledWith(ID, { limit: 20 });
  });
  it('recovers applied domain ID after crash before tool-result checkpoint without pretending verified', async () => {
    listResults.mockResolvedValue({
      items: [],
      has_more: false,
      next_cursor: null,
    });
    listEffects.mockResolvedValue([
      {
        operation_id: 'op-create-55',
        step_id: 'create',
        status: 'applied',
        domain_reference: '55',
        domain_receipt: { resource_ids: { product_id: 55 } },
      },
    ]);
    const restored = JSON.parse((await context.build(ID)).context);
    expect(restored.effects[0]).toMatchObject({
      status: 'applied',
      verified: false,
      domain_reference: '55',
      domain_receipt: { resource_ids: { product_id: 55 } },
    });
    expect(restored.effects[0].replay).toContain('NEVER redispatch');
  });
  it('marks page completeness separately from the artifacts-list page completeness', async () => {
    const result = await context.build(ID);
    const facts = JSON.parse(result.context);
    expect(facts.results_complete).toBe(true);
    expect(facts.results[0].dataset_complete).toBe(false);
    expect(facts.results[0].pagination.next_cursor).toBe(2);
  });
  it('keeps result call/provider version, artifact path, reference and small structured data', async () => {
    const facts = JSON.parse((await context.build(ID)).context);
    expect(facts.results[0]).toMatchObject({
      call_id: 'call-5',
      version: '1',
      artifact_ref: `agent-result:${artifactId}`,
      artifact_path: `/store/vexi/objectives/${ID}/results/${artifactId}`,
      data: { quantity: 7, unit: 'kg' },
    });
    expect(facts.data_policy).toContain('UNTRUSTED BUSINESS DATA');
    expect(facts.authority).toContain('per_write_approval');
  });
  it('never considers a truncated dataset complete', async () => {
    listResults.mockResolvedValue({
      items: [
        {
          ...storedResult(),
          freshness: 'truncated',
          pagination: { complete: false, has_more: true, next_cursor: 'next' },
        },
      ],
      has_more: true,
      next_cursor: artifactId,
    });
    const output = await context.build(ID);
    expect(output.results_complete).toBe(false);
    expect(output.next_cursor).toBe(artifactId);
    expect(JSON.parse(output.context).results[0].dataset_complete).toBe(false);
  });
  it('drops whole records to budget rather than slicing JSON or pretending truncation is pagination', async () => {
    listResults.mockResolvedValue({
      items: Array.from({ length: 10 }, (_, i) => ({
        ...storedResult(),
        tool_call_id: `call-${i}`,
        data: { value: 'x'.repeat(1000) },
      })),
      has_more: false,
      next_cursor: null,
    });
    const output = await context.build(ID, { max_chars: 1600 });
    expect(output.context.length).toBeLessThanOrEqual(1600);
    const facts = JSON.parse(output.context);
    expect(facts.results_complete).toBe(false);
    expect(facts.omitted_results).toBeGreaterThan(0);
    for (const result of facts.results)
      expect(result.data.value).toHaveLength(1000);
  });
  it('keeps durable pointer when a plan/goal exceeds context budget', async () => {
    get.mockResolvedValue({ ...objective(), goal: 'long'.repeat(10000) });
    const output = await context.build(ID, { max_chars: 512 });
    expect(JSON.parse(output.context)).toMatchObject({
      objective_id: ID,
      context_omitted: true,
      fetch_objective: true,
      results_complete: false,
    });
    expect(output.context.length).toBeLessThanOrEqual(512);
  });
  it('requires TTL and a resource version before reusing even nonvolatile reads', () => {
    expect(context.reusable(entity)).toBe(true);
    expect(context.reusable({ ...entity, valid_until: undefined })).toBe(false);
    expect(context.reusable({ ...entity, resource_version: undefined })).toBe(
      false,
    );
    expect(context.reusable({ ...entity, valid_until: 'bad-date' })).toBe(
      false,
    );
    expect(
      context.reusable({ ...entity, valid_until: '2000-01-01T00:00:00Z' }),
    ).toBe(false);
    expect(context.reusable(entity, Date.now(), 'v3')).toBe(false);
    expect(context.reusable(entity, Date.now(), 'v2')).toBe(true);
  });
  it.each([
    'stock',
    'price',
    'balance',
    'fiscal_state',
    'inventory',
    'saldo',
    'precio',
  ])('requires fresh read before reusing volatile %s facts', (type) => {
    expect(context.reusable({ ...entity, type })).toBe(false);
  });
});
