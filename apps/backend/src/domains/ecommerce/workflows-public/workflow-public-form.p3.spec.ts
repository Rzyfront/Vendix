import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { VendixHttpException } from '@common/errors';
import { WORKFLOW_LIMITS } from '@common/workflows/contract';
import {
  publicFormDefinition,
  seedDefinition,
  seedPeople,
} from '../../../testing/workflows/workflow-test-kit';
import { UPLOAD_CHUNK_BYTES } from '../../store/workflows/public-link/workflow-public-uploads.service';
import { buildPublicKit, pngOf, solveCaptcha } from './workflow-public.testkit';

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as VendixHttpException).errorCode;
  }
}

describe('Public form P3.4: steps, captcha and chunked uploads', () => {
  let kit: ReturnType<typeof buildPublicKit>;
  let defId: number;
  let token: string;

  const visitor = (store_id = 1) =>
    kit.as({ store_id, user_id: undefined, permissions: [], is_owner: false });
  const body = (extra: Record<string, any> = {}) => ({
    submission_id: randomUUID(),
    values: { asunto: 'Mi moto no enciende', tipo: 'a' },
    contact: { name: 'Carla Pérez', email: 'carla@example.com' },
    accept_privacy: true as const,
    ...extra,
  });
  const instances = () => kit.db.table('workflow_instances');
  const links = () => kit.db.table('workflow_public_links');
  const sessions = () => kit.db.table('workflow_upload_sessions');

  async function setup(definition = publicFormDefinition()) {
    kit = buildPublicKit();
    seedPeople(kit.db);
    kit.db.insert('organizations', { id: 1, slug: 'org' });
    kit.db.table('stores').forEach((st) => (st.slug = `tienda-${st.id}`));
    kit.db.insert('domain_settings', {
      store_id: 1, app_type: 'STORE_ECOMMERCE', status: 'active', is_primary: true, hostname: 'taller.example.com',
    });
    defId = seedDefinition(kit.db, definition).definitionId;
    kit.as({ user_id: 1, permissions: ['store:workflows:design'] });
    token = (await kit.publicLinks.create(defId)).token;
    visitor();
  }

  /** Full chunked upload of `data` into `fieldKey`; returns the upload id. */
  async function upload(data: Buffer, opts: { field?: string; name?: string; mime?: string } = {}) {
    const init = await kit.form.initUpload(token, {
      field_key: opts.field ?? 'adjunto',
      file_name: opts.name ?? 'foto.png',
      mime_type: opts.mime ?? 'image/png',
      size_bytes: data.length,
    });
    for (let n = 1; n <= init.total_parts; n++) {
      await kit.form.putUploadPart(token, init.upload_id, n, data.subarray((n - 1) * init.chunk_size, n * init.chunk_size));
    }
    await kit.form.completeUpload(token, init.upload_id);
    return init.upload_id;
  }

  describe('GET', () => {
    it('returns the declared steps and keeps the file fields with accept and max size', async () => {
      const def = publicFormDefinition();
      def.fields[2] = { ...def.fields[2], accept: ['image/png'], max_size_mb: 40 } as never;
      (def.stages[0] as any).form.steps = [
        { title: 'Tu caso', fields: ['asunto', 'tipo'] },
        { title: 'Evidencia', fields: ['adjunto'] },
      ];
      await setup(def);
      const r = (await kit.form.get(token)) as any;
      expect(r.steps).toEqual([
        { title: 'Tu caso', fields: ['asunto', 'tipo'] },
        { title: 'Evidencia', fields: ['adjunto'] },
      ]);
      expect(r.fields.find((f: any) => f.key === 'adjunto')).toMatchObject({
        type: 'file', accept: ['image/png'], max_size_mb: 40,
      });
      expect(r.captcha_required).toBe(false);
    });

    it('reports captcha_required from the link', async () => {
      await setup();
      links()[0].captcha_required = true;
      expect(((await kit.form.get(token)) as any).captcha_required).toBe(true);
    });
  });

  describe('captcha', () => {
    beforeEach(async () => {
      await setup();
      links()[0].captcha_required = true;
    });

    it('rejects a submit without or with a wrong proof and creates nothing', async () => {
      expect(await codeOf(kit.form.submit(token, body()))).toBe('WORKFLOW_PUBLIC_CAPTCHA_INVALID');
      const proof = solveCaptcha(await kit.form.captchaChallenge(token));
      expect(await codeOf(kit.form.submit(token, body({ captcha: { ...proof, number: proof.number + 1 } })))).toBe(
        'WORKFLOW_PUBLIC_CAPTCHA_INVALID',
      );
      expect(instances()).toHaveLength(0);
    });

    it('accepts a valid proof once; the same proof cannot be reused', async () => {
      const proof = solveCaptcha(await kit.form.captchaChallenge(token));
      const r = await kit.form.submit(token, body({ captcha: proof }));
      expect(r.reference).toBe('FLU-000001');
      expect(await codeOf(kit.form.submit(token, body({ captcha: proof })))).toBe('WORKFLOW_PUBLIC_CAPTCHA_INVALID');
      expect(instances()).toHaveLength(1);
    });

    it('a proof issued for another link does not open this one', async () => {
      kit.as({ user_id: 1, permissions: ['store:workflows:design'] });
      const other = (await kit.publicLinks.create(defId)).token;
      visitor();
      links().find((l) => l.token_hash !== links()[0].token_hash)!.captcha_required = true;
      const proof = solveCaptcha(await kit.form.captchaChallenge(other));
      expect(await codeOf(kit.form.submit(token, body({ captcha: proof })))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
    });

    it('a link without captcha_required ignores the proof entirely', async () => {
      links()[0].captcha_required = false;
      expect((await kit.form.submit(token, body())).reference).toBe('FLU-000001');
    });

    it('the challenge answers 404 for an unknown token', async () => {
      expect(await codeOf(kit.form.captchaChallenge('x'.repeat(43)))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
    });
  });

  describe('chunked uploads', () => {
    beforeEach(async () => {
      const def = publicFormDefinition();
      def.fields[2] = { ...def.fields[2], accept: ['image/png'], max_size_mb: 20 } as never;
      def.fields.push({ key: 'otro', type: 'file', label: 'Otro', max_size_mb: 1 } as never);
      (def.stages[0] as any).form.fields.push('otro');
      def.fields.push({ key: 'fuera', type: 'text', label: 'Fuera' } as never);
      await setup(def);
    });

    it('opens a session of 5 MiB parts for a file field', async () => {
      const init = await kit.form.initUpload(token, {
        field_key: 'adjunto', file_name: 'foto.png', mime_type: 'image/png', size_bytes: UPLOAD_CHUNK_BYTES + 10,
      });
      expect(init).toMatchObject({ chunk_size: UPLOAD_CHUNK_BYTES, total_parts: 2 });
      expect(init.upload_id.length).toBeGreaterThanOrEqual(20);
      expect(sessions()[0]).toMatchObject({
        store_id: 1, public_link_id: links()[0].id, field_key: 'adjunto', status: 'open', mime_type: 'image/png',
      });
      expect(sessions()[0].expires_at.getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);
    });

    it('refuses a field that is not a file field, a type outside accept, and a size over max_size_mb', async () => {
      const base = { file_name: 'foto.png', mime_type: 'image/png', size_bytes: 100 };
      expect(await codeOf(kit.form.initUpload(token, { ...base, field_key: 'asunto' }))).toBe('WORKFLOW_UPLOAD_INVALID');
      expect(await codeOf(kit.form.initUpload(token, { ...base, field_key: 'nope' }))).toBe('WORKFLOW_UPLOAD_INVALID');
      expect(
        await codeOf(kit.form.initUpload(token, { ...base, field_key: 'adjunto', file_name: 'a.pdf', mime_type: 'application/pdf' })),
      ).toBe('DOCUMENT_TYPE_NOT_ALLOWED');
      expect(await codeOf(kit.form.initUpload(token, { ...base, field_key: 'otro', size_bytes: 2 * 1024 * 1024 }))).toBe(
        'DOCUMENT_TOO_LARGE',
      );
      expect(
        await codeOf(kit.form.initUpload(token, { ...base, field_key: 'adjunto', size_bytes: (WORKFLOW_LIMITS.maxFileSizeMb + 1) * 1024 * 1024 })),
      ).toBe('DOCUMENT_TOO_LARGE');
      expect(await codeOf(kit.form.initUpload(token, { ...base, field_key: 'adjunto', file_name: 'foto.exe' }))).toBe(
        'DOCUMENT_TYPE_MISMATCH',
      );
      expect(sessions()).toHaveLength(0);
    });

    it('validates the part size, the order of completion and the magic bytes of the first part', async () => {
      const data = pngOf(UPLOAD_CHUNK_BYTES + 100);
      const init = await kit.form.initUpload(token, {
        field_key: 'adjunto', file_name: 'foto.png', mime_type: 'image/png', size_bytes: data.length,
      });
      expect(await codeOf(kit.form.putUploadPart(token, init.upload_id, 1, data.subarray(0, 10)))).toBe('WORKFLOW_UPLOAD_INVALID');
      expect(await codeOf(kit.form.putUploadPart(token, init.upload_id, 3, Buffer.alloc(1)))).toBe('WORKFLOW_UPLOAD_INVALID');
      await kit.form.putUploadPart(token, init.upload_id, 1, data.subarray(0, UPLOAD_CHUNK_BYTES));
      expect(await codeOf(kit.form.completeUpload(token, init.upload_id))).toBe('WORKFLOW_UPLOAD_INVALID'); // part 2 missing
      await kit.form.putUploadPart(token, init.upload_id, 2, data.subarray(UPLOAD_CHUNK_BYTES));
      await expect(kit.form.completeUpload(token, init.upload_id)).resolves.toMatchObject({ file_name: 'foto.png', size_bytes: data.length });

      const fake = await kit.form.initUpload(token, {
        field_key: 'adjunto', file_name: 'falsa.png', mime_type: 'image/png', size_bytes: 20,
      });
      expect(await codeOf(kit.form.putUploadPart(token, fake.upload_id, 1, Buffer.alloc(20, 1)))).toBe('DOCUMENT_TYPE_MISMATCH');
      expect(sessions().find((s) => s.public_id === fake.upload_id)!.status).toBe('aborted');
    });

    it('complete stores the file (public_form, actor public) with its size and sha256', async () => {
      const data = pngOf(UPLOAD_CHUNK_BYTES + 100);
      const id = await upload(data);
      const file = kit.db.table('stored_files')[0];
      expect(file).toMatchObject({
        store_id: 1, source: 'public_form', uploaded_by_type: 'public', uploaded_by_id: null,
        size_bytes: data.length, mime_type: 'image/png', original_name: 'foto.png',
      });
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(sessions().find((s) => s.public_id === id)).toMatchObject({ status: 'completed', stored_file_id: file.id });
      // asking again is idempotent
      await kit.form.completeUpload(token, id);
      expect(kit.db.table('stored_files')).toHaveLength(1);
    });

    it('a size that differs from the declared one is refused and the object removed', async () => {
      const init = await kit.form.initUpload(token, {
        field_key: 'adjunto', file_name: 'foto.png', mime_type: 'image/png', size_bytes: 50,
      });
      await kit.form.putUploadPart(token, init.upload_id, 1, pngOf(50));
      kit.s3Multipart.hashObject.mockResolvedValueOnce({ sha256: 'a'.repeat(64), size: 49 });
      expect(await codeOf(kit.form.completeUpload(token, init.upload_id))).toBe('WORKFLOW_UPLOAD_INVALID');
      expect(kit.db.table('stored_files')).toHaveLength(0);
      expect(kit.s3Multipart.deleteFile).toHaveBeenCalled();
    });

    it('a session of another link or another store is a 404', async () => {
      const id = (
        await kit.form.initUpload(token, { field_key: 'adjunto', file_name: 'foto.png', mime_type: 'image/png', size_bytes: 20 })
      ).upload_id;
      kit.as({ user_id: 1, permissions: ['store:workflows:design'] });
      const rotated = (await kit.publicLinks.create(defId)).token;
      visitor();
      expect(await codeOf(kit.form.putUploadPart(rotated, id, 1, pngOf(20)))).toBe('WORKFLOW_UPLOAD_NOT_FOUND');
      expect(await codeOf(kit.form.completeUpload(rotated, id))).toBe('WORKFLOW_UPLOAD_NOT_FOUND');
      visitor(2);
      expect(await codeOf(kit.form.putUploadPart(token, id, 1, pngOf(20)))).toBe('WORKFLOW_PUBLIC_NOT_FOUND');
    });

    it('an expired session cannot take parts', async () => {
      const id = (
        await kit.form.initUpload(token, { field_key: 'adjunto', file_name: 'foto.png', mime_type: 'image/png', size_bytes: 20 })
      ).upload_id;
      sessions()[0].expires_at = new Date(Date.now() - 1);
      expect(await codeOf(kit.form.putUploadPart(token, id, 1, pngOf(20)))).toBe('WORKFLOW_UPLOAD_NOT_FOUND');
      expect(await kit.uploads.sweepExpired()).toBe(1);
      expect(sessions()[0].status).toBe('aborted');
      expect(kit.s3Multipart.abortMultipartUpload).toHaveBeenCalled();
    });

    it('the submit with an upload id attaches the file to the dossier of the new request and consumes the session', async () => {
      const id = await upload(pngOf(300));
      const r = await kit.form.submit(token, body({ values: { asunto: 'Con foto', adjunto: id } }));
      expect(r.reference).toBe('FLU-000001');
      const item = kit.db.table('dossier_items')[0];
      expect(item).toMatchObject({
        kind: 'uploaded_file', field_key: 'adjunto', stage_key: 'formulario', status: 'received',
        added_by_type: 'public', file_id: kit.db.table('stored_files')[0].id,
      });
      expect(sessions()[0].status).toBe('consumed');
      expect(instances()[0].data).toEqual({ asunto: 'Con foto' });
      // the same upload cannot back a second, different submission
      expect(
        await codeOf(kit.form.submit(token, body({ values: { asunto: 'otra', adjunto: id } }))),
      ).toBe('WORKFLOW_UPLOAD_INVALID');
      expect(kit.db.table('dossier_items')).toHaveLength(1);
      expect(instances()).toHaveLength(1);
    });

    it('a retry of the accepted submission (same submission_id) returns the same request without attaching twice', async () => {
      const id = await upload(pngOf(300));
      const b = body({ values: { asunto: 'Con foto', adjunto: id } });
      const one = await kit.form.submit(token, b);
      const two = await kit.form.submit(token, b);
      expect(two.reference).toBe(one.reference);
      expect(kit.db.table('dossier_items')).toHaveLength(1);
      expect(instances()).toHaveLength(1);
    });

    it('refuses an upload id that is unknown, still open, for another field or for a field outside the form', async () => {
      const open = (
        await kit.form.initUpload(token, { field_key: 'adjunto', file_name: 'foto.png', mime_type: 'image/png', size_bytes: 20 })
      ).upload_id;
      const done = await upload(pngOf(300));
      for (const values of [
        { asunto: 'x', adjunto: 'no-existe-este-id-xyz' },
        { asunto: 'x', adjunto: open },
        { asunto: 'x', otro: done },
      ]) {
        expect(await codeOf(kit.form.submit(token, body({ values })))).toBe('WORKFLOW_UPLOAD_INVALID');
      }
      expect(instances()).toHaveLength(0);
      expect(kit.db.table('dossier_items')).toHaveLength(0);
    });
  });

  describe('tracking link on submit', () => {
    beforeEach(() => setup());

    it('creates a link (only the sha256 stored, 90 days), returns tracking_url and e-mails the contact', async () => {
      const r = await kit.form.submit(token, body());
      expect(r.tracking_url).toMatch(/^https:\/\/taller\.example\.com\/flujos\/seguimiento\/[A-Za-z0-9_-]{43}$/);
      const raw = r.tracking_url!.split('/').pop()!;
      const row = kit.db.table('workflow_tracking_links')[0];
      expect(row).toMatchObject({
        store_id: 1, instance_id: instances()[0].id, contact_name: 'Carla Pérez', contact_email: 'carla@example.com',
      });
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(kit.db.tables)).not.toContain(raw);
      const days = (row.expires_at.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(89.9);
      expect(days).toBeLessThanOrEqual(90);
      expect(kit.email.sendEmail).toHaveBeenCalledWith(
        'carla@example.com', expect.stringContaining('FLU-000001'), expect.stringContaining(r.tracking_url!), expect.stringContaining(r.tracking_url!),
      );
    });

    it('an e-mail failure does not fail the submit', async () => {
      kit.email.sendEmail.mockRejectedValueOnce(new Error('smtp down'));
      const r = await kit.form.submit(token, body());
      expect(r.tracking_url).not.toBeNull();
      expect(instances()).toHaveLength(1);
    });

    it('without contact e-mail nothing is sent; a replay returns a fresh link but sends no second e-mail', async () => {
      const noMail = body({ contact: { name: 'Sin correo' } });
      await kit.form.submit(token, noMail);
      expect(kit.email.sendEmail).not.toHaveBeenCalled();
      const b = body();
      await kit.form.submit(token, b);
      await kit.form.submit(token, b);
      expect(kit.email.sendEmail).toHaveBeenCalledTimes(1);
      expect(instances()).toHaveLength(2);
    });

    it('a store without a public domain returns tracking_url null and the submit still works', async () => {
      kit.db.tables['domain_settings'] = [];
      const r = await kit.form.submit(token, body());
      expect(r).toEqual({ reference: 'FLU-000001', tracking_url: null });
      expect(kit.db.table('workflow_tracking_links')).toHaveLength(0);
    });
  });

  describe('controller', () => {
    it('declares the captcha, upload and part routes with their own throttle', async () => {
      const { EcommerceWorkflowsPublicController: C } = await import('./ecommerce-workflows-public.controller');
      expect(Reflect.getMetadata('path', C.prototype.captcha)).toBe(':token/captcha');
      expect(Reflect.getMetadata('path', C.prototype.putPart)).toBe(':token/uploads/:uploadId/parts/:n');
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', C.prototype.putPart)).toBe(300);
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', C.prototype.initUpload)).toBe(20);
    });
  });
});
