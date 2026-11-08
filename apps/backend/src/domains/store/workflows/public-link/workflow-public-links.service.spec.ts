import { VendixHttpException } from '@common/errors';
import {
  buildWorkflowKit,
  publicFormDefinition,
  purchaseDefinition,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';
import { hashPublicToken, publicFormAvailability } from './workflow-public-link.rules';
import { WorkflowPublicFormService } from '../../../ecommerce/workflows-public/workflow-public-form.service';

/** `get` only reads the link and the version: the P3 collaborators are not reached. */
const buildPublicFormOn = (kit: ReturnType<typeof buildWorkflowKit>) =>
  new WorkflowPublicFormService(kit.prisma, kit.engine, null as never, null as never, null as never, kit.dossiers);

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as VendixHttpException).errorCode;
  }
}

describe('WorkflowPublicLinksService', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  let defId: number;

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    defId = seedDefinition(kit.db, publicFormDefinition()).definitionId;
    kit.as({ user_id: 1, permissions: ['store:workflows:design'] });
  });
  afterEach(() => jest.restoreAllMocks());

  const links = () => kit.db.table('workflow_public_links');

  it('crea el enlace, devuelve el token una sola vez y guarda solo su sha256', async () => {
    const r = await kit.publicLinks.create(defId);
    expect(r.url_path).toBe(`/flujos/${r.token}`);
    expect(r.token.length).toBeGreaterThanOrEqual(40);
    expect(links()).toHaveLength(1);
    expect(links()[0]).toMatchObject({
      store_id: 1, organization_id: 1, definition_id: defId, is_active: true,
      token_hash: hashPublicToken(r.token), created_by_user_id: 1,
    });
    expect(JSON.stringify(links())).not.toContain(r.token);
    expect(await kit.publicLinks.status(defId)).toMatchObject({ active: true, last_used_at: null });
    expect(JSON.stringify(await kit.publicLinks.status(defId))).not.toContain(r.token);
  });

  it('rotar revoca el anterior: queda un solo enlace activo', async () => {
    const a = await kit.publicLinks.create(defId);
    const b = await kit.publicLinks.create(defId);
    expect(a.token).not.toBe(b.token);
    expect(links().map((l) => l.is_active)).toEqual([false, true]);
    expect(links().filter((l) => l.is_active)).toHaveLength(1);
  });

  it('DELETE revoca; sin enlace activo no hace nada', async () => {
    await kit.publicLinks.create(defId);
    expect(await kit.publicLinks.revoke(defId)).toEqual({ revoked: 1 });
    expect(await kit.publicLinks.status(defId)).toMatchObject({ active: false });
    expect(await kit.publicLinks.revoke(defId)).toEqual({ revoked: 0 });
  });

  it('exige que la versión publicada tenga el disparador public_form', async () => {
    const d = kit.db.insert('workflow_definitions', {
      store_id: 1, organization_id: 1, key: 'compra', name: 'Compra', status: 'active', created_by_user_id: 1,
    });
    const v = kit.db.insert('workflow_versions', {
      store_id: 1, definition_id: d.id, version: 1, definition: purchaseDefinition(),
    });
    d.published_version_id = v.id;
    expect(await codeOf(kit.publicLinks.create(d.id))).toBe('WORKFLOW_PUBLIC_LINK_UNAVAILABLE');
    expect(links()).toHaveLength(0);
  });

  it('P3.4: acepta un flujo cuyo formulario inicial tiene un archivo obligatorio (se sube por partes)', async () => {
    const def = publicFormDefinition();
    def.fields[2].required = true;
    kit.db.table('workflow_versions')[0].definition = def;
    await expect(kit.publicLinks.create(defId)).resolves.toBeDefined();
  });

  it('flujo no publicado o de otra tienda: errores claros', async () => {
    kit.db.table('workflow_definitions')[0].status = 'draft';
    expect(await codeOf(kit.publicLinks.create(defId))).toBe('WORKFLOW_NOT_ACTIVE');
    kit.as({ store_id: 2, user_id: 7 });
    expect(await codeOf(kit.publicLinks.create(defId))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
    expect(await codeOf(kit.publicLinks.revoke(defId))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
  });

  describe('publicFormAvailability', () => {
    it('cubre cada motivo', () => {
      const base = publicFormDefinition();
      expect(publicFormAvailability(base)).toEqual({ available: true });
      expect(publicFormAvailability({ ...base, triggers: [{ kind: 'manual' }] })).toEqual({ available: false, reason: 'no_public_form_trigger' });
      const notForm = publicFormDefinition();
      (notForm.stages[0] as any).assignee = { kind: 'role', role_key: 'manager' };
      expect(publicFormAvailability(notForm)).toEqual({ available: false, reason: 'start_stage_not_form' });
      const blocking = publicFormDefinition();
      (blocking.stages[0] as any).requirements = [{ kind: 'upload', key: 'd', label: 'D' }];
      expect(publicFormAvailability(blocking)).toEqual({ available: false, reason: 'blocking_requirement' });
      const comment = publicFormDefinition();
      (comment.stages[0] as any).transitions[0].require_comment = true;
      expect(publicFormAvailability(comment)).toEqual({ available: false, reason: 'comment_required' });
    });
  });
  describe('settings: captcha and expiry (P3.4)', () => {
    it('rotating keeps the captcha and the expiry of the link it replaces', async () => {
      await kit.publicLinks.create(defId);
      const when = new Date(Date.now() + 86_400_000).toISOString();
      await kit.publicLinks.updateSettings(defId, { captcha_required: true, expires_at: when });
      await kit.publicLinks.create(defId);
      const active = links().filter((l: any) => l.is_active);
      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ captcha_required: true });
      expect(new Date(active[0].expires_at).toISOString()).toBe(when);
    });

    it('stores captcha_required and a future expiry on the active link and reports them in status', async () => {
      await kit.publicLinks.create(defId);
      const when = new Date(Date.now() + 86_400_000).toISOString();
      const r = await kit.publicLinks.updateSettings(defId, { captcha_required: true, expires_at: when });
      expect(r).toMatchObject({ active: true, captcha_required: true });
      expect(new Date(r.expires_at as Date).toISOString()).toBe(when);
      expect(links()[0]).toMatchObject({ captcha_required: true });
      // null clears the expiry and an omitted key keeps the rest
      const cleared = await kit.publicLinks.updateSettings(defId, { expires_at: null });
      expect(cleared).toMatchObject({ captcha_required: true, expires_at: null });
    });

    it('create returns the full URL on the public domain of the store (null without one)', async () => {
      expect((await kit.publicLinks.create(defId)).url).toBeNull();
      kit.db.insert('domain_settings', {
        store_id: 1, app_type: 'STORE_ADMIN', status: 'active', is_primary: true, hostname: 'admin.example.com',
      });
      kit.db.insert('domain_settings', {
        store_id: 1, app_type: 'STORE_ECOMMERCE', status: 'active', is_primary: false, hostname: 'tienda.example.com',
      });
      const r = await kit.publicLinks.create(defId);
      expect(r.url).toBe(`https://tienda.example.com/flujos/${r.token}`);
    });

    it('refuses a past expiry, answers 404 without an active link and never touches another store', async () => {
      await kit.publicLinks.create(defId);
      expect(await codeOf(kit.publicLinks.updateSettings(defId, { expires_at: new Date(Date.now() - 1000).toISOString() }))).toBe(
        'WORKFLOW_PUBLIC_LINK_UNAVAILABLE',
      );
      await kit.publicLinks.revoke(defId);
      expect(await codeOf(kit.publicLinks.updateSettings(defId, { captcha_required: true }))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
      kit.as({ store_id: 2, user_id: 7, permissions: ['store:workflows:design'] });
      expect(await codeOf(kit.publicLinks.updateSettings(defId, { captcha_required: true }))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
    });

    it('an expired link and a deactivated one answer the same 404 to the public', async () => {
      const { token } = await kit.publicLinks.create(defId);
      kit.as({ store_id: 1, user_id: undefined, permissions: [] });
      links()[0].expires_at = new Date(Date.now() - 1);
      const publicForm = buildPublicFormOn(kit);
      const expired = await codeOf(publicForm.get(token));
      links()[0].expires_at = null;
      links()[0].is_active = false;
      const inactive = await codeOf(publicForm.get(token));
      expect([expired, inactive]).toEqual(['WORKFLOW_PUBLIC_NOT_FOUND', 'WORKFLOW_PUBLIC_NOT_FOUND']);
    });
  });

  describe('flow permissions (P7.3)', () => {
    const ADMINS_ONLY = { roles: ['owner'], user_ids: [] };
    const restrict = (access: unknown) =>
      Object.assign(kit.db.table('workflow_definitions').find((d) => d.id === defId)!, { access });

    it('a designer outside "Quién diseña" cannot create, rotate, revoke or edit the link', async () => {
      const live = await kit.publicLinks.create(defId);
      restrict({ design: ADMINS_ONLY });
      // u2 holds `manager` and `store:workflows:design`, but not the flow's design group.
      kit.as({ user_id: 2, permissions: ['store:workflows:design'] });
      expect(await codeOf(kit.publicLinks.create(defId))).toBe('WORKFLOW_DESIGN_FORBIDDEN');
      expect(await codeOf(kit.publicLinks.revoke(defId))).toBe('WORKFLOW_DESIGN_FORBIDDEN');
      expect(await codeOf(kit.publicLinks.updateSettings(defId, { captcha_required: true }))).toBe(
        'WORKFLOW_DESIGN_FORBIDDEN',
      );
      expect(links()).toHaveLength(1);
      expect(links()[0]).toMatchObject({
        is_active: true,
        token_hash: hashPublicToken(live.token),
        captcha_required: false,
      });
      // The state only needs "Quién ve", open here.
      expect(await kit.publicLinks.status(defId)).toMatchObject({ active: true });
    });

    it('a role in "Quién diseña" still rotates it', async () => {
      restrict({ design: ADMINS_ONLY });
      kit.as({ user_id: 1, permissions: ['store:workflows:design'] });
      expect((await kit.publicLinks.create(defId)).token).toBeTruthy();
    });

    it('a flow hidden by "Quién ve" answers 404 on the state', async () => {
      restrict({ view: ADMINS_ONLY });
      kit.as({ user_id: 2, permissions: ['store:workflows:design'] });
      expect(await codeOf(kit.publicLinks.status(defId))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
      expect(await codeOf(kit.publicLinks.create(defId))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
    });
  });
});
