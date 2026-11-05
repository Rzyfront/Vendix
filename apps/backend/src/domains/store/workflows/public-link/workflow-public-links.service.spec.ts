import { VendixHttpException } from '@common/errors';
import {
  buildWorkflowKit,
  publicFormDefinition,
  purchaseDefinition,
  seedDefinition,
  seedPeople,
} from '../../../../testing/workflows/workflow-test-kit';
import { hashPublicToken, publicFormAvailability } from './workflow-public-link.rules';

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

  it('rechaza un flujo cuyo formulario inicial tiene un archivo obligatorio', async () => {
    const def = publicFormDefinition();
    def.fields[2].required = true;
    kit.db.table('workflow_versions')[0].definition = def;
    await expect(kit.publicLinks.create(defId)).rejects.toMatchObject({
      errorCode: 'WORKFLOW_PUBLIC_LINK_UNAVAILABLE',
      response: { details: { reason: 'required_file_field' } },
    });
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
});
