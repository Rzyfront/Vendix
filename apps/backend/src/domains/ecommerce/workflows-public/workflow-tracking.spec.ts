import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { VendixHttpException } from '@common/errors';
import {
  publicFormDefinition,
  seedDefinition,
  seedPeople,
} from '../../../testing/workflows/workflow-test-kit';
import { WorkflowTrackingController } from '../../store/workflows/tracking/workflow-tracking.controller';
import { EcommerceWorkflowsTrackingController } from './ecommerce-workflows-tracking.controller';
import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';
import { buildPublicKit, pngOf } from './workflow-public.testkit';

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as VendixHttpException).errorCode;
  }
}

describe('Tracking portal (P3.5)', () => {
  let kit: ReturnType<typeof buildPublicKit>;
  let token: string; // public form link token
  let tracking: string; // raw tracking token of the first request
  let instanceId: number;

  const visitor = (store_id = 1) =>
    kit.as({ store_id, user_id: undefined, permissions: [], is_owner: false });
  const admin = (store_id = 1) =>
    kit.as({ store_id, user_id: 1, permissions: ['store:workflows:manage'], is_owner: true });
  const links = () => kit.db.table('workflow_tracking_links');
  const events = () => kit.db.table('workflow_instance_events');

  async function uploadCedula(data = pngOf(400), key = 'cedula') {
    const init = await kit.tracking.initUpload(tracking, key, {
      file_name: 'cedula.png', mime_type: 'image/png', size_bytes: data.length,
    });
    await kit.tracking.putPart(tracking, key, init.upload_id, 1, data);
    return { init, done: await kit.tracking.completeUpload(tracking, key, init.upload_id) };
  }

  beforeEach(async () => {
    kit = buildPublicKit();
    seedPeople(kit.db);
    kit.db.insert('organizations', { id: 1, slug: 'org' });
    kit.db.table('stores').forEach((st) => (st.slug = `tienda-${st.id}`));
    kit.db.table('stores').find((st) => st.id === 1)!.name = 'Taller Central';
    kit.db.insert('domain_settings', {
      store_id: 1, app_type: 'STORE_ECOMMERCE', status: 'active', is_primary: true, hostname: 'taller.example.com',
    });
    const def = publicFormDefinition();
    (def.stages[1] as any).requirements = [
      { kind: 'upload', key: 'cedula', label: 'Cédula', accept: ['image/png'], max_size_mb: 2, external: true },
      { kind: 'upload', key: 'interno', label: 'Informe interno' },
    ];
    const defId = seedDefinition(kit.db, def).definitionId;
    kit.as({ user_id: 1, permissions: ['store:workflows:design'] });
    token = (await kit.publicLinks.create(defId)).token;
    visitor();
    const r = await kit.form.submit(token, {
      submission_id: randomUUID(),
      values: { asunto: 'Secreto del cliente', tipo: 'a' },
      contact: { name: 'Carla Pérez', email: 'carla@example.com', phone: '3001234567' },
      accept_privacy: true,
    });
    tracking = r.tracking_url!.split('/').pop()!;
    instanceId = kit.db.table('workflow_instances')[0].id;
  });

  describe('GET', () => {
    it('shows reference, flow, status, current stage, dates, timeline and the pending external document', async () => {
      const r = await kit.tracking.get(tracking);
      expect(r).toMatchObject({
        store: { name: 'Taller Central' },
        reference: 'FLU-000001',
        flow: { name: 'Solicitud de servicio' },
        status: 'active',
        current_stage: { name: 'Revisión' },
        can_reply: true,
        pending: [{ key: 'cedula', label: 'Cédula', accept: ['image/png'], max_size_mb: 2 }],
      });
      expect(r.started_at).toBeInstanceOf(Date);
      expect(r.entered_at).toBeInstanceOf(Date);
      expect(r.timeline.map((t) => [t.type, t.label])).toEqual([
        ['started', 'Solicitud recibida'],
        ['stage', 'Pasó a «Revisión»'],
      ]);
      expect(links()[0].last_used_at).toBeInstanceOf(Date);
    });

    it('hides everything internal: data, contact e-mail and phone, assignees, comments', async () => {
      kit.db.insert('workflow_instance_comments', {
        store_id: 1, instance_id: instanceId, user_id: 2, body: 'Comentario INTERNO del gerente',
      });
      events().push({
        id: 999, store_id: 1, instance_id: instanceId, seq: 99, type: 'comment_added', actor_type: 'user',
        actor_id: 2, payload: { body: 'Comentario INTERNO del gerente' }, occurred_at: new Date(),
      });
      const text = JSON.stringify(await kit.tracking.get(tracking));
      for (const secret of ['Secreto del cliente', 'carla@example.com', '3001234567', 'INTERNO', 'assignee', 'role_key', 'idempotency']) {
        expect(text).not.toContain(secret);
      }
    });

    it('is a 404 for an unknown, revoked or expired token and for another store', async () => {
      expect(await codeOf(kit.tracking.get('x'.repeat(43)))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
      expect(await codeOf(kit.tracking.get('corto'))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
      visitor(2);
      expect(await codeOf(kit.tracking.get(tracking))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
      visitor(1);
      links()[0].expires_at = new Date(Date.now() - 1);
      expect(await codeOf(kit.tracking.get(tracking))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
      links()[0].expires_at = new Date(Date.now() + 60_000);
      links()[0].revoked_at = new Date();
      expect(await codeOf(kit.tracking.get(tracking))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
    });

    it('a finished request shows the outcome and nothing pending', async () => {
      const inst = kit.db.table('workflow_instances')[0];
      inst.status = 'completed';
      inst.completed_at = new Date();
      const r = await kit.tracking.get(tracking);
      expect(r.pending).toEqual([]);
      expect(r.can_reply).toBe(false);
      expect(r.timeline.at(-1)).toMatchObject({ type: 'completed', label: 'Solicitud completada' });
    });
  });

  describe('external upload', () => {
    it('lists the document as pending, then the upload joins the dossier under the requirement key', async () => {
      expect((await kit.tracking.get(tracking)).pending.map((p) => p.key)).toEqual(['cedula']);
      const { done } = await uploadCedula();
      expect(done).toMatchObject({ requirement_key: 'cedula', received: true });
      const item = kit.db.table('dossier_items')[0];
      expect(item).toMatchObject({
        kind: 'uploaded_file', requirement_key: 'cedula', stage_key: 'revision', status: 'received', added_by_type: 'public',
      });
      expect(kit.db.table('stored_files')[0]).toMatchObject({ source: 'public_form', uploaded_by_type: 'public' });
      const ev = events().find((e) => e.type === 'external_upload')!;
      expect(ev).toMatchObject({ actor_type: 'public', instance_id: instanceId });
      expect(ev.payload).toMatchObject({ requirement_key: 'cedula', label: 'Cédula', file_name: 'cedula.png' });
      const after = await kit.tracking.get(tracking);
      expect(after.pending).toEqual([]);
      expect(after.timeline.at(-1)).toMatchObject({ type: 'external_upload', label: 'Documento enviado', detail: 'Cédula' });
      // the engine's own evaluation agrees: the requirement is satisfied
      expect(await kit.requirements.pendingRequirements(kit.db.table('workflow_instances')[0], {
        key: 'revision', name: 'Revisión', type: 'approval',
        requirements: [{ kind: 'upload', key: 'cedula', label: 'Cédula', external: true }],
      } as never)).toEqual([]);
    });

    it('completing twice does not attach twice', async () => {
      const { init } = await uploadCedula();
      await kit.tracking.completeUpload(tracking, 'cedula', init.upload_id);
      expect(kit.db.table('dossier_items')).toHaveLength(1);
      expect(events().filter((e) => e.type === 'external_upload')).toHaveLength(1);
    });

    it('refuses a requirement that is not external or does not exist, a wrong type and an oversize file', async () => {
      const base = { file_name: 'a.png', mime_type: 'image/png', size_bytes: 100 };
      expect(await codeOf(kit.tracking.initUpload(tracking, 'interno', base))).toBe('DOCUMENT_TARGET_INVALID');
      expect(await codeOf(kit.tracking.initUpload(tracking, 'nada', base))).toBe('DOCUMENT_TARGET_INVALID');
      expect(
        await codeOf(kit.tracking.initUpload(tracking, 'cedula', { ...base, file_name: 'a.pdf', mime_type: 'application/pdf' })),
      ).toBe('DOCUMENT_TYPE_NOT_ALLOWED');
      expect(await codeOf(kit.tracking.initUpload(tracking, 'cedula', { ...base, size_bytes: 3 * 1024 * 1024 }))).toBe('DOCUMENT_TOO_LARGE');
      expect(kit.db.table('workflow_upload_sessions')).toHaveLength(0);
    });

    it('a revoked link or a closed request cannot upload; a session of another link is a 404', async () => {
      const init = await kit.tracking.initUpload(tracking, 'cedula', { file_name: 'a.png', mime_type: 'image/png', size_bytes: 100 });
      // a second tracking link of the same request cannot use the first one's session
      const second = await kit.trackingLinks.createForSubmit({
        store_id: 1, organization_id: 1, instance_id: instanceId, reference: 'FLU-000001', flow_name: 'x',
        contact_name: null, contact_email: null, send_email: false,
      });
      const otherToken = second.tracking_url!.split('/').pop()!;
      expect(await codeOf(kit.tracking.putPart(otherToken, 'cedula', init.upload_id, 1, pngOf(100)))).toBe('WORKFLOW_UPLOAD_NOT_FOUND');
      // the public form link cannot use it either
      expect(await codeOf(kit.form.putUploadPart(token, init.upload_id, 1, pngOf(100)))).toBe('WORKFLOW_UPLOAD_NOT_FOUND');
      links()[0].revoked_at = new Date();
      expect(await codeOf(kit.tracking.putPart(tracking, 'cedula', init.upload_id, 1, pngOf(100)))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
      links()[0].revoked_at = undefined;
      kit.db.table('workflow_instances')[0].status = 'cancelled';
      expect(await codeOf(kit.tracking.initUpload(tracking, 'cedula', { file_name: 'a.png', mime_type: 'image/png', size_bytes: 100 }))).toBe('WORKFLOW_INSTANCE_CLOSED');
    });
  });

  describe('reply', () => {
    it('records an external_message event shown as "Respuesta del solicitante"', async () => {
      await expect(kit.tracking.reply(tracking, '  Ya envié el documento  ')).resolves.toEqual({ received: true });
      const ev = events().find((e) => e.type === 'external_message')!;
      expect(ev).toMatchObject({ actor_type: 'public', instance_id: instanceId, payload: { message: 'Ya envié el documento' } });
      expect((await kit.tracking.get(tracking)).timeline.at(-1)).toMatchObject({
        type: 'external_message', label: 'Respuesta del solicitante', detail: 'Ya envié el documento',
      });
    });

    it('refuses an empty or too long message and a closed request; revoked → 404', async () => {
      expect(await codeOf(kit.tracking.reply(tracking, '   '))).toBe('SYS_VALIDATION_001');
      expect(await codeOf(kit.tracking.reply(tracking, 'x'.repeat(2001)))).toBe('SYS_VALIDATION_001');
      expect(events().filter((e) => e.type === 'external_message')).toHaveLength(0);
      links()[0].revoked_at = new Date();
      expect(await codeOf(kit.tracking.reply(tracking, 'hola'))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
      links()[0].revoked_at = undefined;
      kit.db.table('workflow_instances')[0].status = 'completed';
      expect(await codeOf(kit.tracking.reply(tracking, 'hola'))).toBe('WORKFLOW_INSTANCE_CLOSED');
    });
  });

  describe('admin: list and revoke', () => {
    it('lists the links of the request with their state, without the token or its hash', async () => {
      admin();
      const rows = await kit.trackingLinks.list(instanceId);
      expect(rows).toEqual([
        expect.objectContaining({ contact_name: 'Carla Pérez', contact_email: 'carla@example.com', state: 'active', revoked_at: undefined }),
      ]);
      expect(JSON.stringify(rows)).not.toContain('token');
    });

    it('revoke makes the public link answer 404', async () => {
      admin();
      const id = links()[0].id;
      await expect(kit.trackingLinks.revoke(instanceId, id)).resolves.toEqual({ id, revoked: true });
      expect((await kit.trackingLinks.list(instanceId))[0].state).toBe('revoked');
      visitor();
      expect(await codeOf(kit.tracking.get(tracking))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
    });

    it('another store sees and revokes nothing of this request (404)', async () => {
      admin(2);
      const id = links()[0].id;
      expect(await codeOf(kit.trackingLinks.list(instanceId))).toBe('WORKFLOW_NOT_FOUND');
      expect(await codeOf(kit.trackingLinks.revoke(instanceId, id))).toBe('WORKFLOW_NOT_FOUND');
      admin(1);
      expect(await codeOf(kit.trackingLinks.revoke(instanceId, 9999))).toBe('WORKFLOW_TRACKING_LINK_NOT_FOUND');
      expect(links()[0].revoked_at).toBeUndefined();
    });
  });

  describe('controllers', () => {
    it('the admin routes need store:workflows:manage; the public ones are @Public with throttle', () => {
      const A = WorkflowTrackingController;
      expect(Reflect.getMetadata('path', A)).toBe('store/workflows/instances/:id/tracking-links');
      expect(Reflect.getMetadata('permissions', A.prototype.list)).toEqual(['store:workflows:manage']);
      expect(Reflect.getMetadata('permissions', A.prototype.revoke)).toEqual(['store:workflows:manage']);
      const P = EcommerceWorkflowsTrackingController;
      expect(Reflect.getMetadata('path', P)).toBe('ecommerce/workflows/tracking');
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, P)).toBe(true);
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', P.prototype.reply)).toBe(10);
    });
  });
});
