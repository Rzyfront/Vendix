import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import {
  buildWorkflowKit,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';
import { TIMERS_BATCH, WorkflowTimersCron } from './workflow-timers.cron';

const slowDefinition = (
  onOverdue: Record<string, unknown> | undefined,
  key = 'slow',
): WorkflowDefinitionV1 =>
  ({
    schema: 'vendix.workflow/v1',
    key,
    name: 'Lento',
    fields: [],
    stages: [
      {
        key: 'review',
        name: 'Revisión',
        type: 'approval',
        start: true,
        assignee: { kind: 'role', role_key: 'manager' },
        due: { hours: 24, on_overdue: onOverdue },
        transitions: [
          { on: 'approve', to: 'end' },
          { on: 'reject', to: 'end' },
        ],
      },
      { key: 'end', name: 'Fin', type: 'end', outcome: 'completed' },
    ],
  }) as WorkflowDefinitionV1;

describe('WorkflowTimersCron', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let cron: WorkflowTimersCron;
  const HOUR = 3_600_000;
  const notifies = () => kit.db.table('workflow_outbox').filter((o) => o.kind === 'notify');
  const instance = () => kit.db.table('workflow_instances')[0];

  async function startOverdue(onOverdue: Record<string, unknown>) {
    seedDefinition(kit.db, slowDefinition(onOverdue));
    await kit.engine.start({ definitionKey: 'slow' });
    instance().stage_due_at = new Date(Date.now() - HOUR);
    kit.db.table('workflow_outbox').length = 0; // solo interesan los avisos del vencimiento
  }

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    cron = new WorkflowTimersCron(kit.prisma, kit.engine);
  });
  afterEach(() => jest.restoreAllMocks());

  it('al entrar a la etapa guarda stage_due_at = ahora + due.hours', async () => {
    seedDefinition(kit.db, slowDefinition({ remind_every_hours: 12 }));
    const before = Date.now();
    await kit.engine.start({ definitionKey: 'slow' });
    const due = instance().stage_due_at.getTime();
    expect(due).toBeGreaterThanOrEqual(before + 24 * HOUR);
    expect(due).toBeLessThanOrEqual(Date.now() + 24 * HOUR);
  });

  it('no toca instancias que aún no vencen', async () => {
    seedDefinition(kit.db, slowDefinition({ remind_every_hours: 12 }));
    await kit.engine.start({ definitionKey: 'slow' });
    expect(await cron.runOnce(new Date())).toBe(0);
  });

  it('recordatorio cada remind_every_hours (y no antes)', async () => {
    await startOverdue({ remind_every_hours: 12 });
    const now = new Date();
    expect(await cron.runOnce(now)).toBe(1);
    expect(notifies()).toHaveLength(1);
    expect(notifies()[0].payload).toMatchObject({ task_ids: [expect.any(Number)] });
    expect(instance().stage_last_reminded_at).toEqual(now);

    // Recién recordada (menos de 1 h): ni siquiera se selecciona.
    expect(await cron.runOnce(new Date(now.getTime() + 30 * 60_000))).toBe(0);
    // A las 2 h se revisa, pero faltan 10 h para el siguiente recordatorio.
    await cron.runOnce(new Date(now.getTime() + 2 * HOUR));
    expect(notifies()).toHaveLength(1);
    // A las 13 h ya corresponde otro recordatorio.
    expect(await cron.runOnce(new Date(now.getTime() + 13 * HOUR))).toBe(1);
    expect(notifies()).toHaveLength(2);
  });

  it('escalamiento una sola vez: reasigna las tareas abiertas a escalate_to y deja el evento', async () => {
    await startOverdue({ escalate_to: { kind: 'user', user_id: 1 } });
    const task = kit.db.table('workflow_tasks')[0];
    task.status = 'claimed';
    task.assignee_user_id = 2;
    const now = new Date();
    expect(await cron.runOnce(now)).toBe(1);
    expect(kit.db.table('workflow_tasks')[0]).toMatchObject({
      status: 'open',
      assignee_user_id: 1,
      assignee_role_id: null,
      claimed_at: null,
    });
    expect(instance().stage_escalated_at).toEqual(now);
    const ev = kit.db.table('workflow_instance_events').filter((e) => e.type === 'escalated');
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ resolved: true });
    expect(notifies()).toHaveLength(1);

    // Un segundo barrido no vuelve a escalar.
    await cron.runOnce(new Date(now.getTime() + 2 * HOUR));
    expect(kit.db.table('workflow_instance_events').filter((e) => e.type === 'escalated')).toHaveLength(1);
  });

  it('escalamiento y recordatorio juntos: primero escala, luego recuerda', async () => {
    await startOverdue({ remind_every_hours: 12, escalate_to: { kind: 'user', user_id: 1 } });
    const now = new Date();
    await cron.runOnce(now);
    expect(notifies()).toHaveLength(1); // aviso de escalamiento
    await cron.runOnce(new Date(now.getTime() + HOUR + 1));
    expect(notifies()).toHaveLength(2); // primer recordatorio
    expect(instance().stage_last_reminded_at).not.toBeNull();
  });

  it('una instancia ya cerrada no se avanza', async () => {
    await startOverdue({ remind_every_hours: 12 });
    instance().status = 'cancelled';
    expect(await cron.runOnce(new Date())).toBe(0);
  });

  it('los errores de una instancia no frenan el resto del lote', async () => {
    await startOverdue({ remind_every_hours: 12 });
    jest.spyOn(kit.engine, 'tick').mockRejectedValueOnce(new Error('boom'));
    expect(await cron.runOnce(new Date())).toBe(0);
  });

  it('una instancia cuyo tick siempre falla se aplaza y no deja sin turno a las demás', async () => {
    await startOverdue({ remind_every_hours: 12 });
    await kit.engine.start({ definitionKey: 'slow' });
    const [first, second] = kit.db.table('workflow_instances');
    second.stage_due_at = new Date(Date.now() - HOUR / 2); // vence después: iría segunda
    const realTick = kit.engine.tick.bind(kit.engine);
    const ticked: number[] = [];
    jest.spyOn(kit.engine, 'tick').mockImplementation((async (id: number, o: any) => {
      ticked.push(id);
      if (id === first.id) throw new Error('boom');
      return realTick(id, o);
    }) as any);
    const now = new Date();
    // Lote de 1: la primera falla; en la siguiente corrida ya no bloquea.
    await cron.runOnce(now, 1);
    expect(first.stage_last_reminded_at).toEqual(now);
    await cron.runOnce(new Date(now.getTime() + HOUR + 1), 1);
    expect(ticked).toEqual([first.id, second.id]);
  });
  describe('una instancia vencida sin nada que enviar no ocupa el lote', () => {
    it(`${TIMERS_BATCH}+ vencidas sin on_overdue no impiden que la siguiente reciba su recordatorio`, async () => {
      seedDefinition(kit.db, slowDefinition(undefined, 'mute'));
      seedDefinition(kit.db, slowDefinition({ remind_every_hours: 12 }));
      const now = new Date();
      for (let i = 0; i < TIMERS_BATCH + 5; i++) {
        await kit.engine.start({ definitionKey: 'mute' });
      }
      for (const row of kit.db.table('workflow_instances')) {
        row.stage_due_at = new Date(now.getTime() - 3 * HOUR); // vencen antes: encabezan el lote
      }
      await kit.engine.start({ definitionKey: 'slow' });
      const target = kit.db.table('workflow_instances').at(-1)!;
      target.stage_due_at = new Date(now.getTime() - HOUR);
      kit.db.table('workflow_outbox').length = 0;

      await cron.runOnce(now);
      expect(notifies()).toHaveLength(0); // el lote entero se lo llevaron las mudas…
      const mute = kit.db.table('workflow_instances').filter((i) => i.id !== target.id);
      expect(mute.filter((i) => i.stage_last_reminded_at?.getTime() === now.getTime())).toHaveLength(TIMERS_BATCH);

      // …pero quedaron selladas: al minuto siguiente la 201+ tiene turno.
      await cron.runOnce(new Date(now.getTime() + 60_000));
      expect(notifies()).toHaveLength(1);
      expect(notifies()[0].instance_id).toBe(target.id);
      expect(target.stage_last_reminded_at).not.toBeNull();
    });

    it('sin on_overdue: se sella el no-op y no se notifica nada', async () => {
      await startOverdue(undefined as any);
      const now = new Date();
      await cron.runOnce(now);
      expect(notifies()).toHaveLength(0);
      expect(instance().stage_last_reminded_at).toEqual(now);
      // dentro de la hora ni se selecciona
      expect(await cron.runOnce(new Date(now.getTime() + 60_000))).toBe(0);
    });

    it('sin tareas abiertas: se sella el no-op', async () => {
      await startOverdue({ remind_every_hours: 12 });
      for (const t of kit.db.table('workflow_tasks')) t.status = 'completed';
      const now = new Date();
      await cron.runOnce(now);
      expect(notifies()).toHaveLength(0);
      expect(instance().stage_last_reminded_at).toEqual(now);
    });

    it('ya escalada y sin recordatorios: tras escalar, el siguiente barrido sella el no-op', async () => {
      await startOverdue({ escalate_to: { kind: 'user', user_id: 1 } });
      const now = new Date();
      await cron.runOnce(now);
      expect(instance().stage_last_reminded_at).toBeNull(); // escalar no sella el recordatorio
      const later = new Date(now.getTime() + 60_000);
      await cron.runOnce(later);
      expect(instance().stage_last_reminded_at).toEqual(later);
      expect(notifies()).toHaveLength(1); // solo el aviso de escalamiento
    });

    it('con recordatorio configurado que aún no toca no se re-sella (la cadencia se conserva)', async () => {
      await startOverdue({ remind_every_hours: 12 });
      const now = new Date();
      await cron.runOnce(now);
      await cron.runOnce(new Date(now.getTime() + 2 * HOUR));
      expect(instance().stage_last_reminded_at).toEqual(now);
    });
  });
});
