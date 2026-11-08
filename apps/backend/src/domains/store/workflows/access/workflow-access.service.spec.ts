import { VendixHttpException } from '@common/errors';
import { WorkflowDefinitionsService } from '../definitions/workflow-definitions.service';
import { WorkflowSimulatorService } from '../definitions/workflow-simulator.service';
import { WorkflowAuditService } from '../audit/workflow-audit.service';
import { WorkflowAccessPolicy } from './workflow-access.policy';
import { WorkflowAccessService } from './workflow-access.service';
import {
  buildWorkflowKit,
  purchaseDefinition,
  seedDefinition,
  seedPeople,
  seedWorkGroup,
} from '../../../../testing/workflows/workflow-test-kit';

async function fail(p: Promise<unknown>) {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e as VendixHttpException;
  }
}
const codeOf = async (p: Promise<unknown>) => (await fail(p))?.errorCode;

/**
 * Users: u1 owner, u2/u3 role `manager`, u4/u5 work group `board`, u6 nobody.
 * Everyone but the bypass holders has `store:workflows:design`, so the flow
 * permissions are the only thing that can stop a write.
 */
describe('flow permissions (P7.3)', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let defs: WorkflowDefinitionsService;
  let access: WorkflowAccessService;
  let defId: number;

  const as = (user_id: number, extra: Parameters<typeof kit.as>[0] = {}) =>
    kit.as({
      user_id,
      is_owner: false,
      is_super_admin: false,
      permissions: ['store:workflows:read', 'store:workflows:design'],
      ...extra,
    });
  const flow = (patch: Record<string, unknown>) =>
    Object.assign(kit.db.table('workflow_definitions').find((d) => d.id === defId)!, patch);
  const listed = async () => (await defs.list({ limit: 100 })).data.map((d: any) => d.id);
  const auditRows = (action?: string) =>
    kit.db.table('workflow_audit_log').filter((r) => !action || r.action === action);

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    seedWorkGroup(kit.db, 'board', [4, 5]);
    for (const [id, first] of [[1, 'Rafa'], [2, 'Ana'], [3, 'Beto'], [4, 'Caro'], [5, 'Dani'], [6, 'Eli']] as const) {
      kit.db.insert('users', { id, first_name: first, last_name: 'Pérez', email: `${first}@t.co` });
    }
    defId = seedDefinition(kit.db, purchaseDefinition()).definitionId;
    defs = new WorkflowDefinitionsService(kit.prisma);
    access = new WorkflowAccessService(
      kit.prisma,
      new WorkflowAuditService(kit.prisma),
      new WorkflowAccessPolicy(kit.prisma),
    );
  });
  afterEach(() => jest.restoreAllMocks());

  describe('who sees a flow', () => {
    it('without access everybody sees it (as today)', async () => {
      as(6);
      expect(await listed()).toEqual([defId]);
      expect((await defs.get(defId)).id).toBe(defId);
      expect((await defs.versions(defId)).length).toBe(1);
    });

    it('`view` hides the flow from everyone else in every read, by URL included', async () => {
      flow({ access: { view: { roles: ['manager'], user_ids: [] } } });
      as(6);
      expect(await listed()).toEqual([]);
      expect((await defs.list({})).total).toBe(0);
      expect(await codeOf(defs.get(defId))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
      expect(await codeOf(defs.getDraft(defId))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
      expect(await codeOf(defs.versions(defId))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
      expect(await codeOf(defs.version(defId, 1))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
      expect(await codeOf(defs.export(defId))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
      expect(await codeOf(access.get(defId))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
      // The editor helpers too, even when the body brings its own definition.
      expect(await codeOf(defs.validate(defId))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
      const simulator = new WorkflowSimulatorService(defs, kit.stages);
      expect(await codeOf(simulator.simulate(defId, {}))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
      expect(
        await codeOf(simulator.simulate(defId, { definition: purchaseDefinition() as never })),
      ).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
    });

    it('a role in `view` sees it', async () => {
      flow({ access: { view: { roles: ['manager'], user_ids: [] } } });
      as(2);
      expect(await listed()).toEqual([defId]);
      expect((await defs.get(defId)).id).toBe(defId);
    });

    it('a person in `view` sees it', async () => {
      flow({ access: { view: { roles: [], user_ids: [6] } } });
      as(6);
      expect(await listed()).toEqual([defId]);
    });

    it('a person in `design` sees it even when `view` does not list them', async () => {
      flow({ access: { design: { roles: [], user_ids: [6] }, view: { roles: ['manager'], user_ids: [] } } });
      as(6);
      expect(await listed()).toEqual([defId]);
    });

    it('whoever can start it by the published `start_roles` sees it', async () => {
      kit.db.table('workflow_versions')[0].definition = purchaseDefinition({ start_roles: ['manager'] });
      flow({ access: { view: { roles: ['owner'], user_ids: [] } } });
      as(3);
      expect(await listed()).toEqual([defId]);
      as(6);
      expect(await listed()).toEqual([]);
    });

    it('a flow with start_roles but no `view` is hidden from people who cannot start it', async () => {
      kit.db.table('workflow_versions')[0].definition = purchaseDefinition({ start_roles: ['manager'] });
      flow({ access: { design: { roles: ['owner'], user_ids: [] } } });
      as(6);
      expect(await listed()).toEqual([]);
    });

    it('a flow with neither `view` nor `start_roles` stays visible to everyone', async () => {
      flow({ access: { design: { roles: ['manager'], user_ids: [] } } });
      as(6);
      expect(await listed()).toEqual([defId]);
    });

    it.each([
      ['owner', { is_owner: true }],
      ['superadmin', { is_super_admin: true }],
      ['holder of store:workflows:manage', { permissions: ['store:workflows:read', 'store:workflows:manage'] }],
    ])('%s always sees it', async (_n, extra) => {
      flow({ access: { view: { roles: [], user_ids: [3] } } });
      as(6, extra as any);
      expect(await listed()).toEqual([defId]);
      expect((await defs.get(defId)).id).toBe(defId);
    });

    it('only hides the restricted flow and keeps the open ones listed', async () => {
      const other = seedDefinition(kit.db, purchaseDefinition({ key: 'other', name: 'Otro' })).definitionId;
      flow({ access: { view: { roles: ['manager'], user_ids: [] } } });
      as(6);
      expect(await listed()).toEqual([other]);
      expect((await defs.list({})).total).toBe(1);
    });
  });

  describe('who starts a flow (same rule as reading it)', () => {
    const instances = () => kit.db.table('workflow_instances');
    const start = () => kit.engine.start({ definitionId: defId });
    const starter = (user_id: number, extra: Parameters<typeof kit.as>[0] = {}) =>
      as(user_id, { permissions: ['store:workflows:read', 'store:workflows:start'], ...extra });

    it('a flow hidden by `view` cannot be started by API: 404 and no request', async () => {
      flow({ access: { view: { roles: ['manager'], user_ids: [] } } });
      starter(6);
      expect(await codeOf(start())).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
      expect(await codeOf(kit.engine.start({ definitionKey: 'purchase' }))).toBe(
        'WORKFLOW_DEFINITION_NOT_FOUND',
      );
      expect(instances()).toHaveLength(0);
    });

    it('a hidden flow reads as missing even when it is switched off', async () => {
      flow({ access: { view: { roles: ['manager'], user_ids: [] } }, is_enabled: false });
      starter(6);
      expect(await codeOf(start())).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
      starter(2);
      expect(await codeOf(start())).toBe('WORKFLOW_DISABLED');
    });

    it('whoever sees it still starts it: a role in `view` and the owner', async () => {
      flow({ access: { view: { roles: ['manager'], user_ids: [] } } });
      starter(2);
      expect((await start()).instance.id).toBeGreaterThan(0);
      starter(6, { is_owner: true });
      expect((await start()).instance.id).toBeGreaterThan(0);
      expect(instances()).toHaveLength(2);
    });

    it('a flow without permissions starts as before', async () => {
      starter(6);
      expect((await start()).instance.id).toBeGreaterThan(0);
    });
  });

  describe('flows left out of store-wide content (AI summary)', () => {
    const policy = () => new WorkflowAccessPolicy(kit.prisma);

    it('lists the flows some staff member may not see, whoever asks', async () => {
      const startOnly = seedDefinition(kit.db, purchaseDefinition({ key: 'start', name: 'Inicio', start_roles: ['manager'] }));
      const designOnly = seedDefinition(kit.db, purchaseDefinition({ key: 'design', name: 'Diseño' })).definitionId;
      const openStart = seedDefinition(kit.db, purchaseDefinition({ key: 'open', name: 'Abierto', start_roles: ['manager'] })).definitionId;
      flow({ access: { view: { roles: ['manager'], user_ids: [] } } });
      Object.assign(kit.db.table('workflow_definitions').find((d) => d.id === startOnly.definitionId)!, {
        access: { design: { roles: ['owner'], user_ids: [] } },
      });
      Object.assign(kit.db.table('workflow_definitions').find((d) => d.id === designOnly)!, {
        access: { design: { roles: ['manager'], user_ids: [] } },
      });
      as(1, { is_owner: true });
      const asOwner = await policy().restrictedDefinitionIds();
      expect([...asOwner].sort()).toEqual([defId, startOnly.definitionId].sort());
      as(6);
      expect([...(await policy().restrictedDefinitionIds())].sort()).toEqual([...asOwner].sort());
      expect(asOwner).not.toContain(designOnly);
      expect(asOwner).not.toContain(openStart);
    });
  });

  describe('who designs a flow', () => {
    const writes: Array<[string, () => Promise<unknown>]> = [
      ['saveDraft', () => defs.saveDraft(defId, { definition: purchaseDefinition() as any })],
      ['publish', () => defs.publish(defId, {})],
      ['archive', () => defs.archive(defId)],
      ['unarchive', () => defs.unarchive(defId)],
      ['setEnabled', () => defs.setEnabled(defId, false)],
      ['access update', () => access.update(defId, { view: { roles: ['manager'], user_ids: [] } })],
    ];

    it.each(writes)('%s by someone outside `design` is WORKFLOW_DESIGN_FORBIDDEN', async (_n, run) => {
      flow({ access: { design: { roles: ['manager'], user_ids: [] } } });
      as(6);
      const err = await fail(run());
      expect(err?.errorCode).toBe('WORKFLOW_DESIGN_FORBIDDEN');
      expect(err?.getStatus()).toBe(403);
      expect(err?.message).toContain('No tienes permiso para diseñar este flujo');
      expect(auditRows()).toHaveLength(0);
    });

    it('a member of `design` can save, publish, switch and archive', async () => {
      flow({ access: { design: { roles: ['manager'], user_ids: [] } } });
      as(2);
      await defs.saveDraft(defId, { definition: purchaseDefinition({ name: 'Compra 2' }) as any });
      expect((await defs.publish(defId, {})).unchanged).toBe(false);
      expect(auditRows('definition.published')).toHaveLength(1);
      await defs.setEnabled(defId, false);
      await defs.archive(defId);
      await defs.unarchive(defId);
    });

    it.each([
      ['owner', { is_owner: true }],
      ['superadmin', { is_super_admin: true }],
      ['holder of manage', { permissions: ['store:workflows:design', 'store:workflows:manage'] }],
    ])('%s designs without being in `design`', async (_n, extra) => {
      flow({ access: { design: { roles: [], user_ids: [3] } } });
      as(6, extra as any);
      await defs.saveDraft(defId, { definition: purchaseDefinition() as any });
    });

    it('a flow the caller cannot see answers 404 before 403', async () => {
      flow({ access: { view: { roles: ['manager'], user_ids: [] }, design: { roles: ['manager'], user_ids: [] } } });
      as(6);
      expect(await codeOf(defs.publish(defId, {}))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
    });

    it('creating and importing new flows is not limited by another flow`s design group', async () => {
      flow({ access: { design: { roles: ['manager'], user_ids: [] } } });
      as(6);
      expect((await defs.create({ name: 'Nuevo' })).status).toBe('draft');
      expect((await defs.import({ definition: purchaseDefinition() as any })).definition.status).toBe('draft');
    });
  });

  describe('Permisos panel API', () => {
    it('returns the access with the stages, the start roles and the options to pick from', async () => {
      kit.db.table('workflow_versions')[0].definition = purchaseDefinition({ start_roles: ['manager'] });
      flow({ access: { view: { roles: ['manager'], user_ids: [] } } });
      as(2);
      const r = await access.get(defId);
      expect(r.access).toEqual({ view: { roles: ['manager'], user_ids: [] } });
      expect(r.start_roles).toEqual(['manager']);
      expect(r.stages.map((s: any) => s.key)).toEqual(['request', 'manager', 'board']);
      expect(r.options.roles).toEqual(expect.arrayContaining(['manager', 'owner']));
      expect(r.options.users.map((u: any) => u.id).sort()).toEqual([1, 2, 3, 4, 5, 6]);
      expect(r.options.users.find((u: any) => u.id === 2)!.name).toBe('Ana Pérez');
    });

    it('someone who can only read the flow gets its rules and the names in them, not the whole staff', async () => {
      flow({ access: { view: { roles: ['manager'], user_ids: [6] } } });
      as(6, { permissions: ['store:workflows:read'] });
      const r = await access.get(defId);
      expect(r.access).toEqual({ view: { roles: ['manager'], user_ids: [6] } });
      expect(r.options).toEqual({ roles: ['manager'], users: [{ id: 6, name: 'Eli Pérez' }] });
    });

    it('someone outside the `design` group gets only the names in the rules too', async () => {
      flow({ access: { design: { roles: ['manager'], user_ids: [] } } });
      as(6);
      expect((await access.get(defId)).options).toEqual({ roles: ['manager'], users: [] });
      as(2);
      expect((await access.get(defId)).options.users.map((u: any) => u.id).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('offers staff only: no customer-only member and no customer or super_admin role', async () => {
      kit.db.insert('roles', { id: 3, name: 'customer', organization_id: null, store_id: null });
      kit.db.insert('roles', { id: 4, name: 'super_admin', organization_id: null, store_id: null });
      kit.db.insert('users', { id: 8, first_name: 'Cliente', last_name: 'Web', email: 'cliente@t.co' });
      kit.db.insert('store_users', { id: 8, store_id: 1, user_id: 8 });
      kit.db.insert('user_roles', { user_id: 8, role_id: 3, store_id: 1 });
      // A staff member who also bought online keeps their place.
      kit.db.insert('user_roles', { user_id: 3, role_id: 3, store_id: 1 });
      as(2);
      const r = await access.get(defId);
      expect(r.options.roles).not.toContain('customer');
      expect(r.options.roles).not.toContain('super_admin');
      expect(r.options.roles).toEqual(expect.arrayContaining(['manager', 'owner']));
      const ids = r.options.users.map((u: { id: number }) => u.id);
      expect(ids).not.toContain(8);
      expect(ids).toContain(3);
      expect(await codeOf(access.update(defId, { view: { roles: [], user_ids: [8] } }))).toBe('WORKFLOW_ACCESS_INVALID');
      expect(await codeOf(access.update(defId, { view: { roles: ['customer'], user_ids: [] } }))).toBe(
        'WORKFLOW_ACCESS_INVALID',
      );
      expect(kit.db.table('workflow_definitions').find((d) => d.id === defId)!.access ?? null).toBeNull();
    });

    it('a customer of this store who is staff only in another store is not offered', async () => {
      kit.db.insert('roles', { id: 3, name: 'customer', organization_id: null, store_id: null });
      kit.db.insert('users', { id: 9, first_name: 'Otra', last_name: 'Tienda', email: 'otra@t.co' });
      kit.db.insert('store_users', { id: 9, store_id: 1, user_id: 9 });
      kit.db.insert('user_roles', { user_id: 9, role_id: 3, store_id: 1 });
      kit.db.insert('user_roles', { user_id: 9, role_id: 2, store_id: 2 });
      as(2);
      const ids = (await access.get(defId)).options.users.map((u: { id: number }) => u.id);
      expect(ids).not.toContain(9);
      expect(ids).toContain(3);
    });

    it('a flow of another store is 404', async () => {
      const foreign = seedDefinition(kit.db, purchaseDefinition({ key: 'x' }), 2).definitionId;
      as(1, { is_owner: true });
      expect(await codeOf(access.get(foreign))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
      expect(await codeOf(access.update(foreign, null))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
    });

    it('saves immediately, without a new version, and audits before and after', async () => {
      as(2);
      const r = await access.update(defId, {
        view: { roles: ['manager'], user_ids: [] },
        stages: { manager: { act: { roles: [], user_ids: [3] } } },
      });
      expect(r.access?.stages?.manager.act.user_ids).toEqual([3]);
      expect(kit.db.table('workflow_versions')).toHaveLength(1);
      as(6);
      expect(await listed()).toEqual([]);
      const [row] = auditRows('definition.access_changed');
      expect(row).toMatchObject({
        category: 'definition',
        definition_id: defId,
        actor_id: 2,
        summary: 'Cambió los permisos de «Compra»',
      });
      expect(row.details.before).toBeNull();
      expect(row.details.after.view).toEqual({ roles: ['manager'], user_ids: [] });
    });

    it('an empty document opens the flow again', async () => {
      flow({ access: { view: { roles: ['manager'], user_ids: [] } } });
      as(2);
      await access.update(defId, {});
      expect((await access.get(defId)).access).toBeNull();
      as(6);
      expect(await listed()).toEqual([defId]);
    });

    it.each([
      ['an unknown role', { view: { roles: ['ghost'], user_ids: [] } }],
      ['a person of another store', { view: { roles: [], user_ids: [7] } }],
      ['an unknown stage', { stages: { nope: { act: { roles: ['manager'], user_ids: [] } } } }],
      ['a malformed document', { view: 'manager' }],
    ])('rejects %s with 422 and writes nothing', async (_n, body) => {
      as(2);
      const err = await fail(access.update(defId, body));
      expect(err?.errorCode).toBe('WORKFLOW_ACCESS_INVALID');
      expect(err?.getStatus()).toBe(422);
      expect((await access.get(defId)).access).toBeNull();
      expect(auditRows()).toHaveLength(0);
    });
  });
});
