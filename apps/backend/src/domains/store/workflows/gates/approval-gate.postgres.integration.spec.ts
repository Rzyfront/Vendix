import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  assertDisposableDatabase,
  describeDestructiveE2E,
} from '../../../../testing/destructive-e2e.guard';
import {
  GateDecision,
  consumeApproval,
  enforceApproval,
  requestApproval,
} from './approval-gate';
import { resolveInstanceGates } from './gate-resolution';

/**
 * P1.3 concurrency against a real, disposable Postgres (what the fake cannot
 * prove): the unique (store, operation, record, revision) makes concurrent
 * openers share ONE gate, and the conditional update makes an approval usable
 * once even when many requests race to use it.
 *
 *   VENDIX_DESTRUCTIVE_E2E=1 DATABASE_URL=postgresql://…/vendix_test \
 *     npx jest --runInBand src/domains/store/workflows/gates/approval-gate.postgres.integration.spec.ts
 */
const governing = (key: string): WorkflowDefinitionV1 =>
  ({
    schema: 'vendix.workflow/v1',
    key,
    name: key,
    subject: { type: 'purchase_order' },
    governs: { operation: 'purchase_order.approve', min_amount: 100 },
    fields: [],
    stages: [
      {
        key: 'review',
        name: 'Revisión',
        type: 'approval',
        start: true,
        assignee: { kind: 'user', user_id: 1 },
        transitions: [
          { on: 'approve', to: 'ok' },
          { on: 'reject', to: 'no' },
        ],
      },
      { key: 'ok', name: 'Aprobada', type: 'end', outcome: 'completed' },
      { key: 'no', name: 'Rechazada', type: 'end', outcome: 'rejected' },
    ],
  }) as unknown as WorkflowDefinitionV1;

describeDestructiveE2E(
  'Candado de aprobación contra Postgres real (P1.3)',
  () => {
    jest.setTimeout(60_000);
    const prisma = new StorePrismaService();
    const db = prisma.withoutScope();
    const run = Date.now();
    let organizationId: number;
    let storeId: number;
    let userId: number;
    let definitionId: number;

    const as = <T>(fn: () => Promise<T>): Promise<T> =>
      RequestContextService.runIsolated(
        {
          store_id: storeId,
          organization_id: organizationId,
          user_id: userId,
          is_super_admin: false,
          is_owner: false,
        } as never,
        fn,
      );
    const input = (entityId: number, amount = 500) => ({
      operation: 'purchase_order.approve' as const,
      entity_id: entityId,
      amount,
      context: { purchase_order_id: entityId, total_amount: String(amount) },
    });

    beforeAll(async () => {
      assertDisposableDatabase();
      const org = await db.organizations.create({
        data: {
          name: `GT ${run}`,
          slug: `gt-${run}`,
          email: `gt-${run}@example.com`,
        },
      });
      organizationId = org.id;
      const store = await db.stores.create({
        data: {
          name: `GT ${run}`,
          slug: `gt-${run}`,
          organization_id: org.id,
          industries: ['administration'],
        },
      });
      storeId = store.id;
      const user = await db.users.create({
        data: {
          username: `gt-${run}`,
          password: 'x',
          first_name: 'G',
          last_name: 'T',
          organization_id: org.id,
        },
      });
      userId = user.id;
      const def = await db.workflow_definitions.create({
        data: {
          organization_id: organizationId,
          store_id: storeId,
          key: `gate-${run}`,
          name: 'Gate',
          status: 'active',
          created_by_user_id: userId,
        },
      });
      const version = await db.workflow_versions.create({
        data: {
          store_id: storeId,
          definition_id: def.id,
          version: 1,
          schema_version: 'vendix.workflow/v1',
          definition: governing(`gate-${run}`) as never,
          definition_hash: 'x'.repeat(64),
          published_by_user_id: userId,
        },
      });
      await db.workflow_definitions.update({
        where: { id: def.id },
        data: { published_version_id: version.id },
      });
      definitionId = def.id;
    });

    afterAll(() => prisma.$disconnect());

    it('ten concurrent attempts on the same record open ONE gate and ONE request row', async () => {
      const decisions = await Promise.all(
        Array.from({ length: 10 }, () =>
          as(() => requestApproval(prisma, input(1001))),
        ),
      );
      const gates = await db.workflow_approval_gates.findMany({
        where: { store_id: storeId, entity_id: 1001 },
      });
      expect(gates).toHaveLength(1);
      expect(gates[0]).toMatchObject({
        status: 'pending',
        revision: 1,
        definition_id: definitionId,
      });
      expect(
        new Set(decisions.map((d) => (d.status === 'free' ? 0 : d.gate.id))),
      ).toEqual(new Set([gates[0].id]));
      const starts = await db.workflow_outbox.findMany({
        where: { store_id: storeId, kind: 'gate_start' },
      });
      expect(
        starts.filter(
          (s) => (s.payload as { gate_id: number }).gate_id === gates[0].id,
        ),
      ).toHaveLength(1);
    });

    it('an approval raced by ten operations is used exactly once', async () => {
      const opened = await as(() => requestApproval(prisma, input(1002)));
      if (opened.status === 'free') throw new Error('expected a gate');
      await db.workflow_approval_gates.update({
        where: { id: opened.gate.id },
        data: { status: 'approved', resolved_at: new Date() },
      });
      const decision: GateDecision = await as(() =>
        enforceApproval(prisma, input(1002)),
      );
      expect(decision.status).toBe('approved');
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          db
            .$transaction((tx) => consumeApproval(tx as never, decision))
            .then(
              () => 'ok',
              (e) =>
                e instanceof VendixHttpException ? e.errorCode : String(e),
            ),
        ),
      );
      expect(results.filter((r) => r === 'ok')).toHaveLength(1);
      expect(
        results.filter((r) => r === 'WORKFLOW_APPROVAL_PENDING'),
      ).toHaveLength(9);
    });

    it('closing the request and a second close race: the gate is resolved once, with one outbox row', async () => {
      const opened = await as(() => requestApproval(prisma, input(1003)));
      if (opened.status === 'free') throw new Error('expected a gate');
      const instance = await db.workflow_instances.create({
        data: {
          organization_id: organizationId,
          store_id: storeId,
          definition_id: definitionId,
          version_id: (
            await db.workflow_definitions.findUniqueOrThrow({
              where: { id: definitionId },
            })
          ).published_version_id as number,
          reference: `GT-${run}`,
          title: 'Gate',
          current_stage_key: 'review',
          stage_entered_at: new Date(),
          started_by_type: 'system',
        },
      });
      await db.workflow_approval_gates.update({
        where: { id: opened.gate.id },
        data: { instance_id: instance.id },
      });
      const counts = await Promise.all([
        db.$transaction((tx) =>
          resolveInstanceGates(tx as never, instance, 'approved', null),
        ),
        db.$transaction((tx) =>
          resolveInstanceGates(tx as never, instance, 'rejected', 'x'),
        ),
      ]);
      const gate = await db.workflow_approval_gates.findUniqueOrThrow({
        where: { id: opened.gate.id },
      });
      expect(['approved', 'rejected']).toContain(gate.status);
      const resolvedRows = (
        await db.workflow_outbox.findMany({
          where: { store_id: storeId, kind: 'gate_resolved' },
        })
      ).filter((r) => (r.payload as { gate_id: number }).gate_id === gate.id);
      expect(resolvedRows).toHaveLength(1);
      expect(counts.length).toBe(2);
    });

    it('a store without the administration industry is never held, even with a governing flow', async () => {
      await db.stores.update({
        where: { id: storeId },
        data: { industries: ['retail'] },
      });
      try {
        expect(await as(() => requestApproval(prisma, input(1004)))).toEqual({
          status: 'free',
        });
      } finally {
        await db.stores.update({
          where: { id: storeId },
          data: { industries: ['administration'] },
        });
      }
    });
  },
);
