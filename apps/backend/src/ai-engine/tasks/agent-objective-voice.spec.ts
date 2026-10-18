import { RequestContextService } from '../../common/context/request-context.service';
import { AgentObjectiveRepository } from './agent-objective.repository';
import { ObjectiveMemoryDatabase } from './testing/objective-memory-db';
const ctx = {
  user_id: 3,
  store_id: 1,
  organization_id: 2,
  permissions: ['write'],
  roles: ['owner'],
  is_owner: true,
  is_super_admin: false,
};
const scope = <T>(work: () => T) =>
  RequestContextService.runIsolated(ctx, work);
describe('G first voice attachment never supersedes objective', () => {
  const flag = process.env.AI_DURABLE_OBJECTIVES_ENABLED;
  beforeEach(() => (process.env.AI_DURABLE_OBJECTIVES_ENABLED = 'true'));
  afterEach(() => {
    if (flag === undefined) delete process.env.AI_DURABLE_OBJECTIVES_ENABLED;
    else process.env.AI_DURABLE_OBJECTIVES_ENABLED = flag;
  });
  function fixture() {
    const db = new ObjectiveMemoryDatabase();
    db.seedConversation(5, ctx, { agent_key: 'vex' });
    return { db, repo: new AgentObjectiveRepository(db.prisma) };
  }
  it('creates one empty goal with exact authority snapshot', () =>
    scope(async () => {
      const { repo } = fixture();
      const row = await repo.ensureForConversation(5, 'vex', 'Voz inicial');
      expect(row.goal).toBe('Voz inicial');
      expect(row.authority_snapshot).toEqual(['write']);
      expect(row.plan).toBeNull();
    }));
  it('concurrent attaches preserve SAME ID/version, not createOrReplace semantics', () =>
    scope(async () => {
      const { repo, db } = fixture();
      const [a, b] = await Promise.all([
        repo.ensureForConversation(5, 'vex', 'Voz A'),
        repo.ensureForConversation(5, 'vex', 'Voz B'),
      ]);
      expect(a.id).toBe(b.id);
      expect(a.version).toBe(b.version);
      expect((await repo.get(a.id)).semantic_status).toBe('active');
      expect(db.objectives.size).toBe(1);
    }));
  it('existing awaiting-approval goal is returned unchanged not resumed or replaced', () =>
    scope(async () => {
      const { repo } = fixture();
      const row = await repo.createOrReplace(5, null, 'vex', {
        goal: 'Original',
      });
      const leased = await repo.acquireLease(row.id, row.version);
      const checkpoint = await repo.checkpoint(
        row.id,
        { version: leased.version, lease_generation: leased.lease_generation },
        { semantic_status: 'awaiting_approval' },
      );
      expect(checkpoint?.semantic_status).toBe('awaiting_approval');
      const before = await repo.get(row.id);
      const attached = await repo.ensureForConversation(
        5,
        'vex',
        'Cambio no autorizado',
      );
      expect(attached.id).toBe(before.id);
      expect(attached.goal).toBe('Original');
      expect(attached.version).toBe(before.version);
    }));
  it('foreign conversation and corrupt durable pointer fail closed', () =>
    scope(async () => {
      const { repo, db } = fixture();
      await RequestContextService.runIsolated({ ...ctx, user_id: 99 }, () =>
        expect(repo.ensureForConversation(5, 'vex', 'x')).rejects.toBeDefined(),
      );
      db.seedConversation(6, ctx, { agent_objective_authority: 'durable' });
      await expect(
        repo.ensureForConversation(6, 'vex', 'x'),
      ).rejects.toBeDefined();
    }));
});
