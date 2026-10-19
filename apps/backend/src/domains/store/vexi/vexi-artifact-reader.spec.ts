import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RequestContextService } from '../../../common/context/request-context.service';
import { AgentObjectiveRepository } from '../../../ai-engine/tasks/agent-objective.repository';
import { emptyObjectiveBudget } from '../../../ai-engine/tasks/interfaces/agent-objective.interface';
import { ObjectiveMemoryDatabase } from '../../../ai-engine/tasks/testing/objective-memory-db';
import { compactRecoverableToolResult } from '../../../ai-engine/context/tool-result-compaction';
import {
  normalizeToolResult,
  toolReceipt,
} from '../../../ai-engine/tools/tool-result.normalizer';
import { VexiPlanStateService } from './vexi-plan-state.service';
import { AgentObjectiveResultsQueryDto } from './dto/resume-agent-objective.dto';

const ID = '00000000-0000-4000-8000-000000000001';
const scope = {
  store_id: 10,
  organization_id: 20,
  user_id: 30,
  is_owner: true,
  is_super_admin: false,
};
type Query = Parameters<VexiPlanStateService['getObjectiveArtifact']>[2];

describe('D1 real repository → H bounded Vexi artifact reader', () => {
  const flags = {};

  afterEach(() => {});

  function fixture() {
    const db = new ObjectiveMemoryDatabase();
    const now = new Date();
    db.objectives.set(ID, {
      id: ID,
      ...scope,
      conversation_id: 1,
      agent_id: 'vexi',
      legacy_plan_id: 'h-reader',
      goal: 'Consultar reporte',
      plan: null,
      entities: [],
      step_hashes: null,
      next_step: null,
      semantic_status: 'active',
      version: 1,
      lease_generation: 0,
      lease_until: null,
      budget: emptyObjectiveBudget(),
      authority_snapshot: [],
      requires_revalidation: true,
      expires_at: new Date(Date.now() + 60000),
      created_at: now,
      updated_at: now,
    });
    const repository = new AgentObjectiveRepository(db.prisma);
    const service = new VexiPlanStateService(db.prisma, repository);
    const save = async (value: unknown) => {
      const result = normalizeToolResult(
        JSON.stringify({ tool: 'read_sales', version: '1', data: value }),
      );
      return (
        await repository.appendToolResult(ID, null, {
          tool_call_id: `h-${db.results.size}`,
          tool_name: 'read_sales',
          args_hash: 'a'.repeat(64),
          receipt: toolReceipt(result),
          data: result.data,
        })
      ).result;
    };
    return { db, repository, service, save };
  }

  it.each(['rows', 'direct-array', 'escaped-text', 'giant-row'])(
    'full persisted %s → common compact envelope → owned reader reconstructs snapshot with no Vex block sink',
    async (kind) =>
      RequestContextService.runIsolated(scope, async () => {
        const { db, service, save } = fixture();
        const value =
          kind === 'escaped-text'
            ? '\0\n"\\'.repeat(4000)
            : kind === 'giant-row'
              ? { rows: [{ id: 1, memo: '\0'.repeat(9000) }] }
              : kind === 'direct-array'
                ? Array.from({ length: 400 }, (_, id) => ({
                    id,
                    amount: id + 1,
                    note: 'café'.repeat(10),
                  }))
                : {
                    rows: Array.from({ length: 400 }, (_, id) => ({
                      id,
                      amount: id + 1,
                      note: 'café'.repeat(10),
                    })),
                  };
        const raw = JSON.stringify({
          tool: 'read_sales',
          version: '1',
          data: value,
        });
        let resultId = '';
        const compacted = JSON.parse(
          await compactRecoverableToolResult('read_sales', raw, {
            persist: async () => {
              const stored = await save(value);
              resultId = stored.id;
              expect(db.results.get(resultId)?.data).toEqual(value);
              return {
                artifact_ref: {
                  objective_id: ID,
                  result_id: resultId,
                  path: `/store/vexi/objectives/${ID}/results/${resultId}`,
                },
              };
            },
          }),
        );
        expect(compacted.block_id).toBeNull();
        expect(compacted.artifact_ref.result_id).toBe(resultId);
        let query: Query = {};
        const rows: unknown[] = [];
        let text = '';
        let pages = 0;
        while (true) {
          const page: any = await service.getObjectiveArtifact(
            ID,
            resultId,
            query,
          );
          expect(JSON.stringify(page).length).toBeLessThanOrEqual(4200);
          expect(page).toMatchObject({
            artifact: true,
            bounded: true,
            reusable_for_write: false,
          });
          if (page.format === 'text') text += page.text;
          else
            rows.push(
              ...(Array.isArray(page.data) ? page.data : page.data.rows),
            );
          if (!page.has_more) break;
          expect(page.next_query.artifact_cursor).toBe(page.cursor);
          const repeated = await service.getObjectiveArtifact(
            ID,
            resultId,
            page.next_query,
          );
          expect(repeated).toEqual(
            await service.getObjectiveArtifact(ID, resultId, page.next_query),
          );
          query = page.next_query;
          expect(++pages).toBeLessThan(150);
        }
        expect(pages).toBeGreaterThan(1);
        expect(db.results.size).toBe(1);
        if (kind === 'rows' || kind === 'direct-array') {
          expect(kind === 'rows' ? { rows } : rows).toEqual(value);
          const summary: any = await service.getObjectiveArtifact(
            ID,
            resultId,
            {
              aggregate_field: 'amount',
              aggregate_function: 'sum',
            },
          );
          expect(summary.data.value).toBe((400 * 401) / 2);
          expect(summary.matched_records).toBe(400);
        } else
          expect(typeof value === 'string' ? text : JSON.parse(text)).toEqual(
            value,
          );
      }),
  );

  it('same saved snapshot returns 404 for foreign store, org, owner, and absent explicit ALS', async () => {
    const { service, save } = fixture();
    const saved = await RequestContextService.runIsolated(scope, () =>
      save({ rows: [{ id: 1 }] }),
    );
    for (const other of [
      { ...scope, store_id: 11 },
      { ...scope, organization_id: 21 },
      { ...scope, user_id: 31 },
    ])
      await expect(
        RequestContextService.runIsolated(other, () =>
          service.getObjectiveArtifact(ID, saved.id, {}),
        ),
      ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.getObjectiveArtifact(ID, saved.id, {}),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('binds projection cursors and rejects malformed reader query DTOs without changing UUID list cursor', async () => {
    const valid = plainToInstance(AgentObjectiveResultsQueryDto, {
      artifact_cursor: 'abc',
      columns: 'id,amount',
      text_limit: '3000',
      aggregate_function: 'sum',
      aggregate_field: 'amount',
    });
    expect(await validate(valid)).toHaveLength(0);
    expect(valid.columns).toEqual(['id', 'amount']);
    for (const invalid of [
      { artifact_cursor: 'x'.repeat(401) },
      { text_limit: 3001 },
      { text_offset: -1 },
      { columns: 'data.amount' },
      { columns: [] },
      { aggregate_function: 'eval' },
      { cursor: 'not-a-uuid' },
    ])
      expect(
        (
          await validate(
            plainToInstance(AgentObjectiveResultsQueryDto, invalid),
          )
        ).length,
      ).toBeGreaterThan(0);
    await RequestContextService.runIsolated(scope, async () => {
      const { service, save } = fixture();
      const saved = await save({
        rows: [
          { id: 1, amount: 3 },
          { id: 2, amount: 4 },
        ],
      });
      const page: any = await service.getObjectiveArtifact(ID, saved.id, {
        limit: 1,
        columns: ['id'],
      });
      await expect(
        service.getObjectiveArtifact(ID, saved.id, {
          artifact_cursor: page.cursor,
          columns: ['amount'],
        }),
      ).rejects.toThrow('changed snapshot/query');
      await expect(
        service.getObjectiveArtifact(ID, saved.id, {
          aggregate_field: 'amount',
        }),
      ).rejects.toThrow('Both aggregate');
    });
  });
});
