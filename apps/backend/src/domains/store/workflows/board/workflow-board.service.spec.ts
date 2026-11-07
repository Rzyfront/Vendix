import { VendixHttpException } from '@common/errors';
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
});
