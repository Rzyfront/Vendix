import { VendixHttpException } from '@common/errors';
import type { WorkflowBoardService } from './workflow-board.service';
import {
  buildWorkflowKit,
  purchaseDefinition,
  seedDefinition,
  seedPeople,
  seedWorkGroup,
} from '../../../../testing/workflows/workflow-test-kit';

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as VendixHttpException).errorCode;
  }
}

describe('WorkflowBoardService', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let defId: number;
  const DAY = 86_400_000;

  async function request(userId: number, amount: number | null, key: string) {
    kit.as({ user_id: userId, permissions: ['store:workflows:task'] });
    const s = await kit.engine.start({ definitionKey: 'purchase', idempotencyKey: `s-${key}` });
    if (amount !== null) {
      const task = kit.db.table('workflow_tasks').find((t) => t.instance_id === s.instance.id && t.status === 'open')!;
      await kit.engine.completeTask({
        taskId: task.id, outcome: 'submit', values: { amount },
        expectedRowVersion: s.instance.row_version, idempotencyKey: `c-${key}`,
      });
    }
    return s.instance.id as number;
  }
  const owner = () => kit.as({ user_id: 1, store_id: 1, is_owner: true, permissions: [] });
  const col = (r: any, key: string) => r.columns.find((c: any) => c.stage_key === key);
  const table = (name: string) => kit.db.table(name);
  const row = (id: number) => table('workflow_instances').find((i) => i.id === id)!;

  let inForm: number[];
  let inManager: number;
  let inBoard: number;
  let done: number;

  beforeEach(async () => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    seedWorkGroup(kit.db, 'board', [4, 5]);
    defId = seedDefinition(kit.db, purchaseDefinition()).definitionId;
    kit.db.insert('users', { id: 6, first_name: 'Sol', last_name: 'Vega' });
    inForm = [await request(6, null, 'f1'), await request(5, null, 'f2'), await request(6, null, 'f3')];
    inManager = await request(6, 5000, 'm');
    inBoard = await request(6, 50000, 'b');
    done = await request(6, 100, 'd');
  });
  afterEach(() => jest.restoreAllMocks());

  it('una columna por etapa de la versión publicada, con conteos y contrato de tarjeta', async () => {
    owner();
    const r = await kit.board.board(defId);
    expect(r.definition).toEqual({ id: defId, name: 'Compra', version: 1 });
    expect(r.columns.map((c: any) => c.stage_key)).toEqual(['request', 'manager', 'board', 'done', 'rejected']);
    expect(r.columns.map((c: any) => c.count)).toEqual([3, 1, 1, 1, 0]);
    expect(col(r, 'request')).toMatchObject({ name: 'Solicitud', type: 'form', overdue_count: 0, next_cursor: null });
    expect(col(r, 'request').cards.map((c: any) => c.id)).toEqual([...inForm].reverse());
    expect(col(r, 'rejected').cards).toEqual([]);
    expect(col(r, 'manager').cards[0]).toEqual({
      id: inManager,
      reference: row(inManager).reference,
      title: 'Compra',
      status: 'active',
      version: 1,
      stage_entered_at: row(inManager).stage_entered_at,
      stage_due_at: null,
      overdue: false,
      assignee: { type: 'role', id: 2, name: 'manager' },
      has_pending_requirements: false,
      row_version: row(inManager).row_version,
    });
    expect(col(r, 'request').cards[0].assignee).toMatchObject({ type: 'user', id: 6, name: 'Sol Vega' });
    expect(col(r, 'board').cards[0].assignee).toMatchObject({ type: 'group', name: 'board' });
  });

  it('pagina por cursor (id) de a limit y `column` devuelve solo esa columna', async () => {
    owner();
    const p1 = await kit.board.board(defId, { column: 'request', limit: 2 });
    expect(p1.columns).toHaveLength(1);
    expect(p1.columns[0].count).toBe(3);
    expect(p1.columns[0].cards.map((c: any) => c.id)).toEqual([inForm[2], inForm[1]]);
    expect(p1.columns[0].next_cursor).toBe(inForm[1]);
    const p2 = await kit.board.board(defId, { column: 'request', limit: 2, cursor: p1.columns[0].next_cursor });
    expect(p2.columns[0].cards.map((c: any) => c.id)).toEqual([inForm[0]]);
    expect(p2.columns[0].next_cursor).toBeNull();
  });

  it('el tablero sin `column` trae como máximo 20 tarjetas por columna', async () => {
    owner();
    for (let i = 0; i < 22; i++) {
      kit.db.insert('workflow_instances', {
        store_id: 1, organization_id: 1, definition_id: defId, version_id: 1, reference: `FLU-9${i}`,
        title: 'x', current_stage_key: 'manager', stage_entered_at: new Date(), started_by_type: 'user', started_by_id: 6,
      });
    }
    const c = col(await kit.board.board(defId), 'manager');
    expect(c.count).toBe(23);
    expect(c.cards).toHaveLength(20);
    expect(c.next_cursor).toBe(c.cards[19].id);
  });

  it('instancias de una clave que ya no existe van a una columna legacy marcada', async () => {
    owner();
    kit.db.insert('workflow_instances', {
      store_id: 1, organization_id: 1, definition_id: defId, version_id: 1, reference: 'FLU-0900',
      title: 'vieja', current_stage_key: 'revision_vieja', stage_entered_at: new Date(), started_by_type: 'user', started_by_id: 6,
    });
    const r = await kit.board.board(defId);
    const legacy = r.columns[r.columns.length - 1];
    expect(legacy).toMatchObject({
      stage_key: 'revision_vieja', name: 'revision_vieja (versión anterior)', legacy: true, count: 1, moves: [],
    });
    expect(legacy.cards).toHaveLength(1);
    expect(col(r, 'request').legacy).toBeUndefined();
  });

  it('moves: indica cuándo el arrastre debe abrir el modal', async () => {
    owner();
    const r = await kit.board.board(defId);
    // form stage with fields, branches by `when`
    expect(col(r, 'request').moves).toEqual([
      { to_stage_key: 'board', outcome: 'submit', requires_modal: true },
      { to_stage_key: 'manager', outcome: 'submit', requires_modal: true },
      { to_stage_key: 'done', outcome: 'submit', requires_modal: true },
    ]);
    // approve is a plain click, reject requires a comment
    expect(col(r, 'manager').moves).toEqual([
      { to_stage_key: 'done', outcome: 'approve', requires_modal: false },
      { to_stage_key: 'rejected', outcome: 'reject', requires_modal: true },
    ]);
    // quorum 2: an approve is only a vote, so it cannot be a drop
    expect(col(r, 'board').moves).toEqual([
      { to_stage_key: 'done', outcome: 'approve', requires_modal: true },
      { to_stage_key: 'rejected', outcome: 'reject', requires_modal: false },
    ]);
    expect(col(r, 'done').moves).toEqual([]);
  });

  it('moves: un requisito bloqueante obliga al modal en approve/submit pero no en reject', async () => {
    const def = purchaseDefinition();
    const manager = def.stages.find((s) => s.key === 'manager') as any;
    manager.requirements = [{ kind: 'upload', key: 'doc', label: 'Documento' }];
    manager.transitions[1].require_comment = false;
    table('workflow_versions')[0].definition = def;
    owner();
    const c = col(await kit.board.board(defId), 'manager');
    expect(c.moves).toEqual([
      { to_stage_key: 'done', outcome: 'approve', requires_modal: true },
      { to_stage_key: 'rejected', outcome: 'reject', requires_modal: false },
    ]);
    expect(c.cards[0].has_pending_requirements).toBe(true);
  });

  it('terminadas: solo los últimos 30 días; canceladas no aparecen', async () => {
    owner();
    expect(col(await kit.board.board(defId), 'done').count).toBe(1);
    row(done).completed_at = new Date(Date.now() - 31 * DAY);
    expect(col(await kit.board.board(defId), 'done').count).toBe(0);
    row(done).completed_at = new Date(Date.now() - 29 * DAY);
    expect(col(await kit.board.board(defId), 'done').count).toBe(1);
    await kit.engine.cancel({ instanceId: inManager, reason: 'x' });
    const r = await kit.board.board(defId);
    expect(col(r, 'manager').count).toBe(0);
    expect(r.columns.reduce((n: number, c: any) => n + c.count, 0)).toBe(5);
  });

  it('filtros: vencidas, responsable y rango de fechas; overdue_count cuenta las vencidas', async () => {
    owner();
    row(inForm[0]).stage_due_at = new Date(Date.now() - 3_600_000);
    const all = await kit.board.board(defId);
    expect(col(all, 'request').overdue_count).toBe(1);
    expect(col(all, 'request').cards.find((c: any) => c.id === inForm[0]).overdue).toBe(true);
    const late = await kit.board.board(defId, { overdue: true });
    expect(late.columns.map((c: any) => c.count)).toEqual([1, 0, 0, 0, 0]);
    const mine = await kit.board.board(defId, { assignee_user_id: 5 });
    expect(mine.columns.map((c: any) => c.count)).toEqual([1, 0, 0, 0, 0]);
    expect(col(mine, 'request').cards[0].id).toBe(inForm[1]);
    const future = await kit.board.board(defId, { from: new Date(Date.now() + DAY) });
    expect(future.columns.every((c: any) => c.count === 0)).toBe(true);
  });

  it('visibilidad: quien no es manager solo ve lo suyo; otra tienda no existe', async () => {
    kit.as({ user_id: 5, store_id: 1, permissions: ['store:workflows:read'] });
    const r = await kit.board.board(defId);
    // u5 started f2 and belongs to group `board` that holds the quorum task
    expect(r.columns.map((c: any) => c.count)).toEqual([1, 0, 1, 0, 0]);
    kit.as({ user_id: 7, store_id: 2, is_owner: true, permissions: [] });
    expect(await codeOf(kit.board.board(defId))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
  });

  it('un flujo sin versión publicada devuelve el tablero vacío', async () => {
    owner();
    table('workflow_definitions')[0].published_version_id = null;
    expect(await kit.board.board(defId)).toEqual({ definition: { id: defId, name: 'Compra', version: null }, columns: [] });
  });
  describe('boardAll (P5.5)', () => {
    type BoardAll = Awaited<ReturnType<WorkflowBoardService['boardAll']>>;
    type BoardAllCol = BoardAll['columns'][number];
    const colAll = (r: BoardAll, key: string): BoardAllCol => r.columns.find((c) => c.key === key)!;
    const ids = (r: BoardAll, key: string) => colAll(r, key).cards.map((c) => c.id).sort();

    beforeEach(() => {
      table('inventory_locations').push(
        { id: 1, store_id: 1, name: 'Bodega principal', is_active: true },
        { id: 2, store_id: 2, name: 'Sede ajena', is_active: true },
      );
      row(inManager).location_id = 1;
    });

    it('cuatro columnas con tarjetas de varios flujos, sede y etapa', async () => {
      owner();
      const r = await kit.board.boardAll();
      expect(r.columns.map((c) => [c.key, c.name])).toEqual([
        ['pending', 'Por atender'],
        ['in_progress', 'En curso'],
        ['system', 'En espera (sistema)'],
        ['closed', 'Cerradas (30 días)'],
      ]);
      expect(r.columns.map((c) => c.count)).toEqual([5, 0, 0, 1]);
      expect(ids(r, 'closed')).toEqual([done]);
      const card = colAll(r, 'pending').cards.find((c) => c.id === inManager);
      expect(card).toEqual({
        id: inManager,
        reference: row(inManager).reference,
        title: 'Compra',
        status: 'active',
        definition: { id: defId, name: 'Compra' },
        stage_key: 'manager',
        stage_name: expect.any(String),
        assignee: { type: 'role', id: 2, name: 'manager' },
        stage_due_at: null,
        overdue: false,
        location: { id: 1, name: 'Bodega principal' },
      });
    });

    it('una tarea tomada va a "En curso"; sin tarea humana va a "En espera (sistema)"', async () => {
      owner();
      const task = table('workflow_tasks').find((t) => t.instance_id === inManager && t.status === 'open')!;
      task.status = 'claimed';
      task.assignee_user_id = 2;
      table('workflow_instances').push({
        id: 900, store_id: 1, organization_id: 1, definition_id: defId, version_id: 1, reference: 'FLU-0900',
        title: 'auto', status: 'active', current_stage_key: 'request', stage_entered_at: new Date(),
        started_by_type: 'system', started_by_id: null,
      });
      const r = await kit.board.boardAll();
      expect(ids(r, 'in_progress')).toEqual([inManager]);
      expect(ids(r, 'system')).toEqual([900]);
      expect(colAll(r, 'pending').count).toBe(4);
    });

    it('filtra por rol, sede y vencidas', async () => {
      owner();
      const byRole = await kit.board.boardAll({ role_id: 2 });
      expect(byRole.columns.map((c) => c.count)).toEqual([1, 0, 0, 0]);
      expect(ids(byRole, 'pending')).toEqual([inManager]);
      const bySede = await kit.board.boardAll({ location_id: 1 });
      expect(bySede.columns.map((c) => c.count)).toEqual([1, 0, 0, 0]);
      row(inForm[0]).stage_due_at = new Date(Date.now() - 3_600_000);
      const late = await kit.board.boardAll({ overdue: true });
      expect(ids(late, 'pending')).toEqual([inForm[0]]);
      expect(colAll(late, 'pending').cards[0].overdue).toBe(true);
    });

    it('pagina una columna por cursor', async () => {
      owner();
      const p1 = await kit.board.boardAll({ column: 'pending', limit: 2 });
      expect(p1.columns).toHaveLength(1);
      expect(p1.columns[0].cards).toHaveLength(2);
      const p2 = await kit.board.boardAll({ column: 'pending', limit: 2, cursor: p1.columns[0].next_cursor });
      expect(p2.columns[0].cards[0].id).toBeLessThan(p1.columns[0].next_cursor);
    });

    it('ids ajenos dan 404 y otra tienda no ve tarjetas', async () => {
      owner();
      expect(await codeOf(kit.board.boardAll({ location_id: 2 }))).toBe('WORKFLOW_NOT_FOUND');
      expect(await codeOf(kit.board.boardAll({ role_id: 999 }))).toBe('WORKFLOW_NOT_FOUND');
      expect(await codeOf(kit.board.boardAll({ definition_id: 999 }))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
      kit.as({ user_id: 7, store_id: 2, is_owner: true, permissions: [] });
      const other = await kit.board.boardAll();
      expect(other.columns.every((c) => c.count === 0)).toBe(true);
      expect(await codeOf(kit.board.boardAll({ definition_id: defId }))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
    });

    it('quien no es manager solo ve lo suyo', async () => {
      kit.as({ user_id: 5, store_id: 1, permissions: ['store:workflows:read'] });
      const r = await kit.board.boardAll();
      expect(r.columns.map((c) => c.count)).toEqual([2, 0, 0, 0]);
    });

    it('filters: flujos, roles y sedes activas de la tienda', async () => {
      owner();
      const f = await kit.board.filters();
      expect(f.definitions).toEqual([{ id: defId, name: 'Compra' }]);
      expect(f.roles.map((x) => x.name)).toEqual(expect.arrayContaining(['manager', 'owner']));
      expect(f.locations).toEqual([{ id: 1, name: 'Bodega principal' }]);
    });
  });
});

describe('WorkflowBoardService flow permissions (P7.3)', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let defId: number;
  let mine: number;

  const as = (user_id: number, extra: Parameters<typeof kit.as>[0] = {}) =>
    kit.as({
      user_id,
      is_owner: false,
      is_super_admin: false,
      permissions: ['store:workflows:read'],
      ...extra,
    });
  const restrict = (access: unknown) =>
    Object.assign(kit.db.table('workflow_definitions').find((d) => d.id === defId)!, { access });

  beforeEach(async () => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    seedWorkGroup(kit.db, 'board', [4, 5]);
    defId = seedDefinition(kit.db, purchaseDefinition()).definitionId;
    as(6, { permissions: ['store:workflows:task'] });
    mine = (await kit.engine.start({ definitionKey: 'purchase', idempotencyKey: 'own' })).instance.id;
  });
  afterEach(() => jest.restoreAllMocks());

  it('without access the open flow keeps its board, filters and general board', async () => {
    as(6);
    expect((await kit.board.board(defId)).definition.id).toBe(defId);
    expect((await kit.board.filters()).definitions).toEqual([{ id: defId, name: 'Compra' }]);
    expect((await kit.board.boardAll({ definition_id: defId })).columns.length).toBeGreaterThan(0);
  });

  it('a restricted flow has no board, no filter option and no definition filter for people outside', async () => {
    restrict({ view: { roles: ['manager'], user_ids: [] } });
    as(6);
    expect(await codeOf(kit.board.board(defId))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
    expect(await codeOf(kit.board.boardAll({ definition_id: defId }))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
    expect((await kit.board.filters()).definitions).toEqual([]);
  });

  it('whoever is in `view` or holds the bypass sees the board and the filter option', async () => {
    restrict({ view: { roles: ['manager'], user_ids: [] } });
    as(2);
    expect((await kit.board.board(defId)).definition.id).toBe(defId);
    expect((await kit.board.filters()).definitions).toHaveLength(1);
    as(6, { permissions: ['store:workflows:manage'] });
    expect((await kit.board.board(defId)).definition.id).toBe(defId);
  });

  it('a participant keeps seeing their own request on the general board', async () => {
    restrict({ view: { roles: ['manager'], user_ids: [] } });
    as(6);
    const r = await kit.board.boardAll({});
    const ids = r.columns.flatMap((c: any) => c.cards.map((x: any) => x.id));
    expect(ids).toContain(mine);
  });
});
