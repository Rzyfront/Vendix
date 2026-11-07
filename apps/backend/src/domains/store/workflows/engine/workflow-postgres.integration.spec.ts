import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import { EcommercePrismaService } from '../../../../prisma/services/ecommerce-prisma.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  assertDisposableDatabase,
  describeDestructiveE2E,
} from '../../../../testing/destructive-e2e.guard';
import { DossiersService } from '../../documents/dossiers.service';
import { WorkflowCommentsService } from '../instances/workflow-comments.service';
import { WorkflowInstancesService } from '../instances/workflow-instances.service';
import { WorkflowWebhookEmitter } from '../webhooks/workflow-webhook-emitter.service';
import { WorkGroupsService } from '../work-groups.service';
import { WorkflowAdvanceService } from './workflow-advance.service';
import { WorkflowAssignmentService } from './workflow-assignment.service';
import { WorkflowCompleteService } from './workflow-complete.service';
import { WorkflowEngineService } from './workflow-engine.service';
import { WorkflowEventsService } from './workflow-events.service';
import { WorkflowLoaderService } from './workflow-loader.service';
import { WorkflowOutboxDispatcher } from './workflow-outbox.dispatcher';
import { WorkflowReferenceService } from './workflow-reference.service';
import { DossierWorkflowRequirementsService } from './workflow-requirements.service';
import { WorkflowStageService } from './workflow-stage.service';
import { WorkflowStartService } from './workflow-start.service';
import { WorkflowTickService } from './workflow-tick.service';
import { WorkflowTriggerFanout } from './workflow-trigger.fanout';
import { recordTriggerEvent } from './workflow-trigger.outbox';

/**
 * M5: what an in-memory fake cannot prove. Runs against a real, disposable
 * Postgres whose schema comes from `prisma db push`:
 *
 *   VENDIX_DESTRUCTIVE_E2E=1 DATABASE_URL=postgresql://…/vendix_test \
 *     npx jest --runInBand src/domains/store/workflows/engine/workflow-postgres.integration.spec.ts
 *
 * The evidence triggers exist only in SQL, so the migration file is applied here.
 */
const TRIGGERS_MIGRATION = join(
  __dirname,
  '../../../../../prisma/migrations/20261116100000_evidence_append_only/migration.sql',
);

const definitionOf = (key: string, approve: object): WorkflowDefinitionV1 =>
  ({
    schema: 'vendix.workflow/v1',
    key,
    name: key,
    fields: [],
    triggers: [{ kind: 'event', event: 'order.created' }],
    stages: [
      {
        key: 'review',
        name: 'Revisión',
        type: 'approval',
        start: true,
        assignee: { kind: 'group', group_key: 'board', strategy: 'any' },
        transitions: [{ on: 'approve', to: 'done' }],
        ...approve,
      },
      { key: 'done', name: 'Fin', type: 'end', outcome: 'completed' },
    ],
  }) as unknown as WorkflowDefinitionV1;

describeDestructiveE2E('Flujos contra Postgres real (M5)', () => {
  jest.setTimeout(60_000);
  const prisma = new StorePrismaService();
  const db = prisma.withoutScope();
  const run = Date.now();
  let organizationId: number;
  let storeId: number;
  let users: number[];
  let groupId: number;

  const groups = new WorkGroupsService(prisma);
  const loader = new WorkflowLoaderService();
  const events = new WorkflowEventsService(new WorkflowWebhookEmitter());
  const assignment = new WorkflowAssignmentService(groups);
  const stages = new WorkflowStageService(assignment, events);
  const advancer = new WorkflowAdvanceService(stages, events);
  const dossiers = new DossiersService(prisma);
  const requirements = new DossierWorkflowRequirementsService(dossiers);
  const starter = new WorkflowStartService(
    loader,
    stages,
    events,
    new WorkflowReferenceService(),
    dossiers,
    advancer,
  );
  const engine = new WorkflowEngineService(
    prisma,
    loader,
    assignment,
    starter,
    new WorkflowCompleteService(loader, assignment, requirements, advancer, events),
    advancer,
    stages,
    events,
    new WorkflowTickService(prisma, loader, assignment, advancer, stages, events),
  );
  const instances = new WorkflowInstancesService(prisma, assignment, requirements, dossiers);
  const comments = new WorkflowCommentsService(prisma, instances, events);

  const as = <T>(userIndex: number | null, fn: () => Promise<T>): Promise<T> =>
    RequestContextService.runIsolated(
      {
        store_id: storeId,
        organization_id: organizationId,
        user_id: userIndex === null ? undefined : users[userIndex],
        is_super_admin: false,
        is_owner: true,
        permissions: ['store:workflows:task'],
      } as never,
      fn,
    );
  const outcome = (p: Promise<unknown>) =>
    p.then(
      () => 'ok',
      (e) => (e instanceof VendixHttpException ? e.errorCode : `OTHER:${e?.code ?? e?.message}`),
    );

  async function publish(definition: WorkflowDefinitionV1) {
    const def = await db.workflow_definitions.create({
      data: {
        organization_id: organizationId,
        store_id: storeId,
        key: definition.key,
        name: definition.name,
        status: 'active',
        created_by_user_id: users[0],
      },
    });
    const version = await db.workflow_versions.create({
      data: {
        store_id: storeId,
        definition_id: def.id,
        version: 1,
        schema_version: 'vendix.workflow/v1',
        definition: definition as never,
        definition_hash: 'x'.repeat(64),
        published_by_user_id: users[0],
      },
    });
    await db.workflow_definitions.update({
      where: { id: def.id },
      data: { published_version_id: version.id },
    });
    return def.id;
  }

  const seq = (instanceId: number) =>
    db.workflow_instance_events.findMany({
      where: { instance_id: instanceId },
      orderBy: { seq: 'asc' },
    });
  const openTask = async (instanceId: number) =>
    (await db.workflow_tasks.findFirstOrThrow({
      where: { instance_id: instanceId, status: { in: ['open', 'claimed'] } },
    })) as { id: number };

  /** Rows of other tests or runs must not reach a test's dispatcher. */
  const clearOutbox = () =>
    db.workflow_outbox.updateMany({
      where: { status: { in: ['pending', 'processing'] } },
      data: { status: 'done' },
    });

  beforeAll(async () => {
    assertDisposableDatabase();
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(readFileSync(TRIGGERS_MIGRATION, 'utf8'));
    await pool.end();
    const org = await db.organizations.create({
      data: { name: `IT ${run}`, slug: `it-${run}`, email: `it-${run}@example.com` },
    });
    organizationId = org.id;
    const store = await db.stores.create({
      data: {
        name: `IT ${run}`,
        slug: `it-${run}`,
        organization_id: org.id,
        industries: ['administration'],
      },
    });
    storeId = store.id;
    users = [];
    for (const n of [1, 2, 3, 4]) {
      const u = await db.users.create({
        data: {
          username: `it-${run}-${n}`,
          password: 'x',
          first_name: 'U',
          last_name: String(n),
          organization_id: org.id,
        },
      });
      users.push(u.id);
      await db.store_users.create({ data: { store_id: storeId, user_id: u.id } });
    }
    const group = await db.work_groups.create({
      data: { organization_id: org.id, store_id: storeId, key: 'board', name: 'Junta' },
    });
    groupId = group.id;
    for (const user_id of users) {
      await db.work_group_members.create({
        data: { store_id: storeId, work_group_id: groupId, user_id },
      });
    }
  });

  afterAll(() => prisma.$disconnect());

  describe('motor', () => {
    it('dos aprobaciones simultáneas: una gana, un solo avance, la otra recibe un error de negocio', async () => {
      const key = `single-${run}`;
      await publish(definitionOf(key, {}));
      const { instance } = await as(0, () => engine.start({ definitionKey: key }));
      const task = await openTask(instance.id);
      const results = await Promise.all(
        [1, 2].map((u) =>
          outcome(
            as(u, () =>
              engine.completeTask({
                taskId: task.id,
                outcome: 'approve',
                expectedRowVersion: instance.row_version,
              }),
            ),
          ),
        ),
      );
      expect(results.filter((r) => r === 'ok')).toHaveLength(1);
      expect(results.find((r) => r !== 'ok')).toMatch(/^WORKFLOW_(STALE|TASK_CLOSED)$/);
      const row = await db.workflow_instances.findUniqueOrThrow({ where: { id: instance.id } });
      expect(row).toMatchObject({ status: 'completed', current_stage_key: 'done' });
      const log = await seq(instance.id);
      expect(log.filter((e) => e.type === 'task_completed')).toHaveLength(1);
      expect(log.map((e) => e.seq)).toEqual(log.map((_, i) => i + 1));
    });

    it('B1: doble voto simultáneo de la misma persona: un voto, WORKFLOW_ALREADY_VOTED y nunca P2002', async () => {
      const key = `vote-${run}`;
      await publish(definitionOf(key, { quorum: { required: 2 } }));
      const { instance } = await as(0, () => engine.start({ definitionKey: key }));
      const task = await openTask(instance.id);
      const results = await Promise.all(
        ['a', 'b', 'c'].map((suffix) =>
          outcome(
            as(1, () =>
              engine.completeTask({
                taskId: task.id,
                outcome: 'approve',
                expectedRowVersion: instance.row_version,
                idempotencyKey: `${key}-${suffix}`,
              }),
            ),
          ),
        ),
      );
      expect(results.filter((r) => r === 'ok')).toHaveLength(1);
      expect(results.filter((r) => r === 'WORKFLOW_ALREADY_VOTED')).toHaveLength(2);
      expect(await db.workflow_task_votes.count({ where: { task_id: task.id } })).toBe(1);
    });

    it('quórum de 2 con tres votantes simultáneos: avanza una vez y la solicitud cierra', async () => {
      const key = `quorum-${run}`;
      await publish(definitionOf(key, { quorum: { required: 2 } }));
      const { instance } = await as(0, () => engine.start({ definitionKey: key }));
      const task = await openTask(instance.id);
      await Promise.all(
        [1, 2, 3].map((u) =>
          outcome(
            as(u, () =>
              engine.completeTask({
                taskId: task.id,
                outcome: 'approve',
                expectedRowVersion: instance.row_version,
              }),
            ),
          ),
        ),
      );
      const row = await db.workflow_instances.findUniqueOrThrow({ where: { id: instance.id } });
      expect(row).toMatchObject({ status: 'completed', current_stage_key: 'done' });
      const log = await seq(instance.id);
      expect(log.filter((e) => e.to_stage_key === 'done')).toHaveLength(1);
      expect(log.map((e) => e.seq)).toEqual(log.map((_, i) => i + 1));
    });

    it('B2: tomar la tarea y comentar a la vez no da un falso WORKFLOW_STALE', async () => {
      const key = `claim-${run}`;
      await publish(definitionOf(key, {}));
      const { instance } = await as(0, () => engine.start({ definitionKey: key }));
      const task = await openTask(instance.id);
      const results = await Promise.all([
        outcome(as(1, () => engine.claimTask(task.id))),
        ...[0, 1, 2, 3].map((n) => outcome(as(0, () => comments.add(instance.id, `nota ${n}`)))),
      ]);
      expect(results).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
      const log = await seq(instance.id);
      expect(log.map((e) => e.seq)).toEqual(log.map((_, i) => i + 1));
      const row = await db.workflow_instances.findUniqueOrThrow({ where: { id: instance.id } });
      expect(row.row_version).toBe(instance.row_version);
    });

    it('arranques simultáneos con claves distintas: todos entran, cada uno con su referencia', async () => {
      const key = `refs-${run}`;
      await publish(definitionOf(key, {}));
      const results = await Promise.all(
        [0, 1, 2, 3, 4].map((u) =>
          as(u % 4, () => engine.start({ definitionKey: key, idempotencyKey: `${key}-${u}` })),
        ),
      );
      const refs = results.map((r) => r.instance.reference);
      expect(new Set(refs).size).toBe(5);
    });

    it('dos arranques con la misma clave idempotente crean una sola solicitud', async () => {
      const key = `idem-${run}`;
      const definitionId = await publish(definitionOf(key, {}));
      const input = {
        definitionId,
        event: 'order.created',
        eventContext: {},
        idempotencyKey: `${key}-k`,
      };
      const results = await Promise.all(
        [1, 2, 3].map(() => outcome(as(null, () => engine.startSystem(input)))),
      );
      expect(results).toEqual(['ok', 'ok', 'ok']);
      expect(await db.workflow_instances.count({ where: { definition_id: definitionId } })).toBe(1);
    });
  });

  describe('aislamiento de los titulares de un rol', () => {
    it('un rol de sistema sin tienda solo alcanza a gente de esta tienda u organización, nunca a otra empresa', async () => {
      const role = await db.roles.create({
        data: { name: `owner-it-${run}`, organization_id: null },
      });
      const otherOrg = await db.organizations.create({
        data: { name: `Otra ${run}`, slug: `otra-${run}`, email: `otra-${run}@example.com` },
      });
      const stranger = await db.users.create({
        data: {
          username: `otra-${run}`,
          password: 'x',
          first_name: 'Otra',
          last_name: 'Empresa',
          organization_id: otherOrg.id,
        },
      });
      const notMember = await db.users.create({
        data: {
          username: `nomember-${run}`,
          password: 'x',
          first_name: 'Sin',
          last_name: 'Tienda',
          organization_id: organizationId,
        },
      });
      for (const user_id of [users[0], stranger.id, notMember.id]) {
        await db.user_roles.create({ data: { user_id, role_id: role.id } });
      }
      const instance = {
        id: 0,
        store_id: storeId,
        organization_id: organizationId,
      } as never;
      const task = {
        assignee_user_id: null,
        assignee_group_id: null,
        assignee_role_id: role.id,
      } as never;
      const recipients = await assignment.resolveUserIds(
        db as never,
        { def: { kind: 'role', role_key: role.name } } as never,
        instance,
      );
      expect(recipients).toEqual([users[0]]);
      expect(
        await assignment.canAct(db as never, task, stranger.id, storeId, organizationId),
      ).toBe(false);
      expect(
        await assignment.canAct(db as never, task, notMember.id, storeId, organizationId),
      ).toBe(false);
      expect(
        await assignment.canAct(db as never, task, users[0], storeId, organizationId),
      ).toBe(true);
    });
  });

  describe('outbox', () => {
    const dispatcherWith = (tick: jest.Mock) =>
      new WorkflowOutboxDispatcher(
        prisma,
        { tick } as never,
        assignment,
        { sendToUser: jest.fn() } as never,
        { send: jest.fn(async () => 'sent') } as never,
        {} as never,
        {} as never,
        new WorkflowTriggerFanout(prisma),
      );

    it('dos workers a la vez: SKIP LOCKED no entrega ninguna fila dos veces', async () => {
      await clearOutbox();
      const ids: bigint[] = [];
      for (let n = 0; n < 30; n++) {
        const row = await db.workflow_outbox.create({
          data: {
            store_id: storeId,
            kind: 'advance',
            payload: { instance_id: 1000 + n },
            status: 'pending',
          },
        });
        ids.push(row.id);
      }
      const tick = jest.fn(async () => undefined);
      const [a, b] = await Promise.all([
        dispatcherWith(tick).dispatchBatch(20),
        dispatcherWith(tick).dispatchBatch(20),
      ]);
      expect(a.claimed + b.claimed).toBe(30);
      const handled = tick.mock.calls.map((c: unknown[]) => c[0]);
      expect(new Set(handled).size).toBe(30);
      const rows = await db.workflow_outbox.findMany({ where: { id: { in: ids } } });
      expect(rows.every((r) => r.status === 'done' && r.attempts === 1)).toBe(true);
    });

    describe('P0.2: el evento vive y muere con la transacción del dominio', () => {
      const order = (id: number) => ({
        store_id: storeId,
        order_id: id,
        order_number: `IT-${id}`,
        grand_total: 3000000,
        currency: 'COP',
      });
      const rowsOf = (orderId: number) =>
        db.workflow_outbox.findMany({
          where: {
            store_id: storeId,
            kind: 'business_event',
            payload: { path: ['business_id'], equals: String(orderId) },
          },
        });

      it('la transacción con alcance de ecommerce (checkout) también escribe la fila', async () => {
        await publish(definitionOf(`ecommerce-${run}`, {}));
        const ecommerce = new EcommercePrismaService();
        await as(null, () =>
          ecommerce.$transaction((tx: never) =>
            recordTriggerEvent(tx, 'order.created', order(910003)),
          ),
        );
        expect(await rowsOf(910003)).toHaveLength(1);
        await ecommerce.$disconnect();
      });

      it('si el dominio revierte, no queda fila', async () => {
        await expect(
          prisma.withoutScope().$transaction(async (tx) => {
            await recordTriggerEvent(tx, 'order.created', order(910001));
            throw new Error('domain failed');
          }),
        ).rejects.toThrow('domain failed');
        expect(await rowsOf(910001)).toHaveLength(0);
      });

      it('tras el commit y la caída, otro proceso inicia el flujo una sola vez', async () => {
        await clearOutbox();
        const key = `durable-${run}`;
        const definitionId = await publish(definitionOf(key, {}));
        await prisma.withoutScope().$transaction(async (tx) => {
          await recordTriggerEvent(tx, 'order.created', order(910002));
        });
        expect(await rowsOf(910002)).toHaveLength(1);
        expect(await db.workflow_instances.count({ where: { definition_id: definitionId } })).toBe(0);

        const worker = () =>
          new WorkflowOutboxDispatcher(
            prisma,
            engine,
            assignment,
            { sendToUser: jest.fn() } as never,
            { send: jest.fn(async () => 'sent') } as never,
            {} as never,
            {} as never,
            new WorkflowTriggerFanout(prisma),
          );
        await worker().dispatchBatch();
        await worker().dispatchBatch();
        expect(await db.workflow_instances.count({ where: { definition_id: definitionId } })).toBe(1);

        // El mismo hecho otra vez no duplica la solicitud.
        await prisma.withoutScope().$transaction(async (tx) => {
          await recordTriggerEvent(tx, 'order.created', order(910002));
        });
        await worker().dispatchBatch();
        await worker().dispatchBatch();
        expect(await db.workflow_instances.count({ where: { definition_id: definitionId } })).toBe(1);
      });
    });
  });

  describe('M4: evidencia append-only', () => {
    let dossierId: number;
    let fileId: number;
    let itemId: number;

    const newFile = (name: string) =>
      db.stored_files.create({
        data: {
          organization_id: organizationId,
          store_id: storeId,
          s3_key: `it/${run}/${name}`,
          original_name: name,
          mime_type: 'application/pdf',
          size_bytes: 10,
          sha256: 'a'.repeat(64),
          uploaded_by_type: 'user',
          uploaded_by_id: users[0],
        },
      });

    beforeAll(async () => {
      const dossier = await db.dossiers.create({
        data: {
          organization_id: organizationId,
          store_id: storeId,
          reference: 'EXP-1',
          title: 'Expediente',
        },
      });
      dossierId = dossier.id;
      fileId = (await newFile('referenced.pdf')).id;
      const item = await db.dossier_items.create({
        data: {
          store_id: storeId,
          dossier_id: dossierId,
          kind: 'uploaded_file',
          stage_key: 'review',
          file_id: fileId,
          added_by_type: 'user',
          added_by_id: users[0],
        },
      });
      itemId = item.id;
    });

    it('workflow_instance_events no admite UPDATE ni DELETE', async () => {
      const key = `events-${run}`;
      await publish(definitionOf(key, {}));
      const { instance } = await as(0, () => engine.start({ definitionKey: key }));
      const [event] = await seq(instance.id);
      await expect(
        db.workflow_instance_events.update({
          where: { id: event.id },
          data: { type: 'tampered' as never },
        }),
      ).rejects.toThrow(/EVIDENCE_APPEND_ONLY|type/);
      await expect(
        db.$executeRawUnsafe(
          `UPDATE workflow_instance_events SET payload = '{}' WHERE id = ${event.id}`,
        ),
      ).rejects.toThrow(/EVIDENCE_APPEND_ONLY/);
      await expect(
        db.workflow_instance_events.delete({ where: { id: event.id } }),
      ).rejects.toThrow(/EVIDENCE_APPEND_ONLY/);
    });

    it('dossier_items solo pasa a superseded, y nunca se borra', async () => {
      await expect(
        db.dossier_items.update({ where: { id: itemId }, data: { note: 'cambiada' } }),
      ).rejects.toThrow(/EVIDENCE_APPEND_ONLY/);
      await expect(
        db.dossier_items.update({
          where: { id: itemId },
          data: { status: 'superseded', note: 'de paso' },
        }),
      ).rejects.toThrow(/EVIDENCE_APPEND_ONLY/);
      await expect(db.dossier_items.delete({ where: { id: itemId } })).rejects.toThrow(
        /EVIDENCE_APPEND_ONLY/,
      );
      const ok = await db.dossier_items.update({
        where: { id: itemId },
        data: { status: 'superseded' },
      });
      expect(ok.status).toBe('superseded');
    });

    it('stored_files: identidad inmutable; hold y retención editables', async () => {
      await expect(
        db.stored_files.update({ where: { id: fileId }, data: { sha256: 'b'.repeat(64) } }),
      ).rejects.toThrow(/EVIDENCE_APPEND_ONLY/);
      const held = await db.stored_files.update({
        where: { id: fileId },
        data: { legal_hold: true },
      });
      expect(held.legal_hold).toBe(true);
      await db.stored_files.update({ where: { id: fileId }, data: { legal_hold: false } });
    });

    it('stored_files: no se borra si un expediente lo usa, si tiene hold o retención; un huérfano sí', async () => {
      await expect(db.stored_files.delete({ where: { id: fileId } })).rejects.toThrow(
        /EVIDENCE_APPEND_ONLY/,
      );
      const held = await newFile('held.pdf');
      await db.stored_files.update({ where: { id: held.id }, data: { legal_hold: true } });
      await expect(db.stored_files.delete({ where: { id: held.id } })).rejects.toThrow(
        /EVIDENCE_APPEND_ONLY/,
      );
      const retained = await newFile('retained.pdf');
      await db.stored_files.update({
        where: { id: retained.id },
        data: { retention_until: new Date(Date.now() + 86_400_000) },
      });
      await expect(db.stored_files.delete({ where: { id: retained.id } })).rejects.toThrow(
        /EVIDENCE_APPEND_ONLY/,
      );
      const orphan = await newFile('orphan.pdf');
      await db.stored_files.delete({ where: { id: orphan.id } });
      expect(await db.stored_files.findUnique({ where: { id: orphan.id } })).toBeNull();
    });
  });
});
