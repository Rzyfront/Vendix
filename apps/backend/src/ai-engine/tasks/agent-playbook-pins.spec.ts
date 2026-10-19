import { RequestContextService } from '../../common/context/request-context.service';
import { AgentObjectiveRepository } from './agent-objective.repository';
import { AgentTaskContextService } from './agent-task-context.service';
import { ObjectiveMemoryDatabase } from './testing/objective-memory-db';
import {
  emptyObjectiveBudget,
  type AgentObjective,
  type AgentToolResult,
} from './interfaces/agent-objective.interface';

const id = '00000000-0000-4000-8000-000000000001';
const scope = {
  organization_id: 3,
  store_id: 7,
  user_id: 11,
  permissions: ['read'],
  is_super_admin: false,
  is_owner: false,
};
const run = <T>(callback: () => T) =>
  RequestContextService.runIsolated(scope, callback);
const pin = (name = 'reponer-inventario', section = 'steps') => ({
  id: name,
  version: '1.0.0',
  hash: 'a'.repeat(64),
  section: { id: section },
  section_body: 'NEVER restore historical instructions',
});

describe('C release pins over real D1 repository/context (in-memory SQL transport)', () => {
  let db: ObjectiveMemoryDatabase;
  let repo: AgentObjectiveRepository;
  function add(
    index: number,
    data: unknown,
    patch: Partial<AgentToolResult> = {},
  ) {
    const result = {
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      ...scope,
      objective_id: id,
      tool_name: 'load_playbook',
      tool_version: '1',
      tool_call_id: `call-${index}`,
      receipt: { status: 'ok' },
      freshness: 'observed',
      stale_lease: false,
      created_at: new Date(index * 1000),
      data,
      resource_ids: {},
      evidence_refs: [],
      pagination: null,
      ...patch,
    } as AgentToolResult;
    db.results.set(result.id, result);
  }
  beforeEach(() => {
    db = new ObjectiveMemoryDatabase();
    repo = new AgentObjectiveRepository(db.prisma);
    db.objectives.set(id, {
      id,
      ...scope,
      conversation_id: 1,
      agent_id: 'vexi',
      goal: 'Reposición',
      plan: null,
      entities: [],
      budget: emptyObjectiveBudget(),
      semantic_status: 'partial',
      requires_revalidation: true,
      next_step: null,
      version: 1,
      lease_generation: 1,
      expires_at: new Date(Date.now() + 60000),
      created_at: new Date(),
      updated_at: new Date(),
    } as unknown as AgentObjective);
  });
  afterAll(() => {});
  it('restores newest two distinct release identities after >25 unrelated messages/results, never bodies', async () =>
    run(async () => {
      add(1, pin());
      for (let i = 2; i <= 30; i++)
        add(i, { body: 'unrelated' }, { tool_name: 'get_stock_levels' });
      add(31, pin('cerrar-caja'));
      add(32, pin('reponer-inventario', 'supplier'));
      add(33, pin('cerrar-caja', 'verification'));
      const contexts = new AgentTaskContextService(repo);
      const restored = await contexts.build(id, { max_results: 2 });
      expect(restored.playbook_pins).toEqual([
        {
          id: 'cerrar-caja',
          version: '1.0.0',
          hash: 'a'.repeat(64),
          section: 'verification',
        },
        {
          id: 'reponer-inventario',
          version: '1.0.0',
          hash: 'a'.repeat(64),
          section: 'supplier',
        },
      ]);
      expect(JSON.stringify(restored.playbook_pins)).not.toContain('NEVER');
      const query = db.statements.find((q) => q.sql.includes('DISTINCT ON'))!;
      expect(query.sql).toContain("tool_name='load_playbook'");
      expect(query.sql).toContain('stale_lease=false');
      expect(query.values).toEqual(expect.arrayContaining([id, 3, 7, 11]));
    }));
  it('does not reintroduce small historical playbook bodies as durable facts while ON or OFF', async () =>
    run(async () => {
      add(1, pin());
      for (const enabled of ['true', 'false']) {
        const context = await new AgentTaskContextService(repo).build(id);
        const result = JSON.parse(context.context).results[0];
        expect(result.data).toBeNull();
        expect(result.data_omitted).toBe(true);
        expect(context.context).not.toContain(
          'NEVER restore historical instructions',
        );
      }
    }));
  it('ignores pending/error/stale/unobserved/foreign result identities', async () =>
    run(async () => {
      add(1, pin());
      add(2, pin('cerrar-caja'), { stale_lease: true });
      add(3, pin('facturar-venta'), { freshness: 'truncated' });
      add(4, pin('registrar-gasto'), {
        receipt: { status: 'blocked' } as AgentToolResult['receipt'],
      });
      add(5, pin('crear-cliente'), { user_id: 88 });
      add(6, pin('recibir-compra'), { organization_id: 88 });
      add(7, pin('compra-proveedor'), { store_id: 88 });
      expect(await repo.listPlaybookPins(id)).toHaveLength(1);
    }));
  it.each([
    { hash: 'bad' },
    { id: '../../arbitrary' },
    { version: 'floating-latest' },
    { section: { id: '../..' } },
  ])('rejects malformed persisted pin %p', async (change) =>
    run(async () => {
      add(1, { ...pin(), ...change });
      expect(await repo.listPlaybookPins(id)).toEqual([]);
    }),
  );
  it('owner mismatch is the same not-found and static ALS fallback cannot restore pins', async () => {
    add(1, pin());
    await expect(
      RequestContextService.runIsolated({ ...scope, user_id: 99 }, () =>
        repo.listPlaybookPins(id),
      ),
    ).rejects.toThrow('Objective not found');
    RequestContextService.run(scope, () => undefined);
    await expect(repo.listPlaybookPins(id)).rejects.toThrow('explicit tenant');
  });
});
