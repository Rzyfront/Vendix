import { VendixHttpException } from '@common/errors';
import {
  buildWorkflowKit,
  purchaseDefinition,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as VendixHttpException).errorCode;
  }
}

describe('WorkflowCommentsService', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let id: number; // started by u4, waiting for a manager (u2, u3)

  beforeEach(async () => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    seedDefinition(kit.db, purchaseDefinition());
    kit.db.insert('users', { id: 4, first_name: 'Ana', last_name: 'Ruiz' });
    kit.db.insert('users', { id: 2, first_name: 'Luis', last_name: 'Mora' });
    kit.as({ user_id: 4, permissions: [] });
    const s = await kit.engine.start({ definitionKey: 'purchase', idempotencyKey: 'k' });
    const task = kit.db.table('workflow_tasks').find((t) => t.status === 'open')!;
    await kit.engine.completeTask({
      taskId: task.id, outcome: 'submit', values: { amount: 5000 },
      expectedRowVersion: s.instance.row_version, idempotencyKey: 'c',
    });
    id = s.instance.id;
  });
  afterEach(() => jest.restoreAllMocks());

  const events = () => kit.db.table('workflow_instance_events').filter((e) => e.instance_id === id);
  const lastNotify = () => kit.db.table('workflow_outbox').filter((o) => o.kind === 'notify').pop()!;

  it('publica el comentario, escribe el evento `comment` con seq y devuelve autor', async () => {
    kit.as({ user_id: 4 });
    const before = events().length;
    const c = await kit.comments.add(id, '  Falta la cotización  ');
    expect(c).toMatchObject({ body: 'Falta la cotización', author: { id: 4, name: 'Ana Ruiz' } });
    const ev = events();
    expect(ev).toHaveLength(before + 1);
    expect(ev[ev.length - 1]).toMatchObject({
      type: 'comment', actor_type: 'user', actor_id: 4, idempotency_key: null,
      payload: { comment_id: c.id, excerpt: 'Falta la cotización' },
    });
    expect(ev[ev.length - 1].seq).toBe(Math.max(...ev.map((e) => e.seq)));
    expect(new Set(ev.map((e) => e.seq)).size).toBe(ev.length);
  });

  it('avisa a los demás participantes por el outbox (sin el autor) y el detalle trae los comentarios', async () => {
    kit.as({ user_id: 2, permissions: [] });
    await kit.comments.add(id, 'Lo reviso hoy');
    const payload = lastNotify().payload;
    expect(payload).toMatchObject({
      title: expect.stringContaining('FLU-000001'),
      message: 'Nuevo comentario: Lo reviso hoy',
      user_ids: [4],
      exclude_user_ids: [2],
    });
    expect(payload.task_ids).toHaveLength(1); // the open manager task expands to its role holders
    kit.as({ user_id: 4 });
    const detail = await kit.instances.get(id);
    expect(detail.comments).toEqual([
      expect.objectContaining({ body: 'Lo reviso hoy', author: { id: 2, name: 'Luis Mora' } }),
    ]);
    expect(detail.timeline.some((e: any) => e.type === 'comment')).toBe(true);
  });

  it('list devuelve los últimos en orden cronológico y before_id pagina hacia atrás', async () => {
    kit.as({ user_id: 4 });
    const made: number[] = [];
    for (let i = 1; i <= 5; i++) made.push((await kit.comments.add(id, `c${i}`)).id);
    expect((await kit.comments.list(id, { limit: 3 })).map((c: any) => c.body)).toEqual(['c3', 'c4', 'c5']);
    expect((await kit.comments.list(id, { limit: 3, before_id: made[2] })).map((c: any) => c.body)).toEqual(['c1', 'c2']);
    expect((await kit.instances.get(id)).comments).toHaveLength(5);
  });

  it('valida el largo: vacío o más de 2000 caracteres se rechaza', async () => {
    kit.as({ user_id: 4 });
    expect(await codeOf(kit.comments.add(id, '   '))).toBe('SYS_VALIDATION_001');
    expect(await codeOf(kit.comments.add(id, 'x'.repeat(2001)))).toBe('SYS_VALIDATION_001');
    await expect(kit.comments.add(id, 'x'.repeat(2000))).resolves.toBeTruthy();
  });

  it('aislamiento: quien no ve la solicitud no lee ni comenta; otra tienda no existe', async () => {
    kit.as({ user_id: 4 });
    await kit.comments.add(id, 'privado');
    kit.as({ user_id: 6, permissions: [] });
    expect(await codeOf(kit.comments.list(id))).toBe('WORKFLOW_NOT_FOUND');
    expect(await codeOf(kit.comments.add(id, 'intruso'))).toBe('WORKFLOW_NOT_FOUND');
    kit.as({ user_id: 7, store_id: 2, is_owner: true, permissions: [] });
    expect(await codeOf(kit.comments.list(id))).toBe('WORKFLOW_NOT_FOUND');
    expect(await codeOf(kit.comments.add(id, 'x'))).toBe('WORKFLOW_NOT_FOUND');
    expect(kit.db.table('workflow_instance_comments')).toHaveLength(1);
  });

  it('reintenta el seq cuando choca con otro escritor del historial', async () => {
    kit.as({ user_id: 4 });
    const append = jest.spyOn((kit.comments as any).events, 'append');
    append.mockRejectedValueOnce(new VendixHttpException({ code: 'WORKFLOW_STALE', httpStatus: 409, devMessage: 's' } as any));
    const c = await kit.comments.add(id, 'reintento');
    expect(append).toHaveBeenCalledTimes(2);
    // the failed attempt rolled back its comment row
    expect(kit.db.table('workflow_instance_comments')).toHaveLength(1);
    expect(c.body).toBe('reintento');
  });
});
