import 'reflect-metadata';
import { VendixHttpException } from '@common/errors';
import { seedPeople } from '../../../../testing/workflows/workflow-test-kit';
import { buildPublicKit, pngOf } from '../../../ecommerce/workflows-public/workflow-public.testkit';
import { buildLimits } from '../limits/workflow-limits.testkit';
import {
  MAX_OPEN_UPLOADS_PER_LINK,
  UploadScope,
  UPLOAD_SESSION_TTL_MS,
} from './workflow-public-uploads.service';

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as VendixHttpException).errorCode;
  }
}

describe('WorkflowPublicUploadsService: cap, sweep and idempotent complete', () => {
  let kit: ReturnType<typeof buildPublicKit>;
  const scopeOf = (linkId: number): UploadScope => ({
    store_id: 1,
    organization_id: 1,
    public_link_id: linkId,
    folder: 'workflows/public',
    field_key: 'adjunto',
  });
  const png = { file_name: 'foto.png', mime_type: 'image/png', size_bytes: 40 };
  const sessions = () => kit.db.table('workflow_upload_sessions');
  const files = () => kit.db.table('stored_files');

  beforeEach(() => {
    kit = buildPublicKit();
    seedPeople(kit.db);
    kit.db.insert('organizations', { id: 1, slug: 'org' });
    kit.db.table('stores').forEach((st) => (st.slug = `tienda-${st.id}`));
    kit.as({ store_id: 1, user_id: undefined, permissions: [], is_owner: false });
  });

  async function completed(linkId = 1) {
    const init = await kit.uploads.init(scopeOf(linkId), {}, png);
    await kit.uploads.putPart(scopeOf(linkId), init.upload_id, 1, pngOf(40));
    await kit.uploads.complete(scopeOf(linkId), init.upload_id);
    return sessions().find((s) => s.public_id === init.upload_id)!;
  }

  describe('open sessions cap per link', () => {
    it('refuses the session over the cap with a 429 and opens nothing in S3', async () => {
      for (let i = 0; i < MAX_OPEN_UPLOADS_PER_LINK; i++) await kit.uploads.init(scopeOf(1), {}, png);
      const before = kit.s3Multipart.createMultipartUpload.mock.calls.length;
      let status: number | undefined;
      try {
        await kit.uploads.init(scopeOf(1), {}, png);
      } catch (e) {
        status = (e as VendixHttpException).getStatus();
        expect((e as VendixHttpException).errorCode).toBe('WORKFLOW_UPLOAD_TOO_MANY');
      }
      expect(status).toBe(429);
      expect(kit.s3Multipart.createMultipartUpload.mock.calls.length).toBe(before);
      // another link is not affected
      await expect(kit.uploads.init(scopeOf(2), {}, png)).resolves.toMatchObject({ total_parts: 1 });
    });

    it('does not count completed, aborted or expired sessions', async () => {
      for (let i = 0; i < MAX_OPEN_UPLOADS_PER_LINK - 1; i++) await kit.uploads.init(scopeOf(1), {}, png);
      sessions()[0].status = 'aborted';
      sessions()[1].expires_at = new Date(Date.now() - 1);
      for (let i = 0; i < 3; i++) await kit.uploads.init(scopeOf(1), {}, png);
      expect(await codeOf(kit.uploads.init(scopeOf(1), {}, png))).toBe('WORKFLOW_UPLOAD_TOO_MANY');
    });
  });

  describe('sweepExpired', () => {
    it('deletes the object and the row of a completed, unconsumed session past its window', async () => {
      const s = await completed();
      const key = s.s3_key;
      const fileId = s.stored_file_id;
      expect(kit.s3Multipart.objects.has(key)).toBe(true);
      s.expires_at = new Date(Date.now() - 1);
      expect(await kit.uploads.sweepExpired()).toBe(1);
      expect(kit.s3Multipart.objects.has(key)).toBe(false);
      expect(files().find((f) => f.id === fileId)).toBeUndefined();
      expect(s.status).toBe('aborted');
      expect(s.stored_file_id).toBeNull();
    });

    it('keeps a consumed session, its row and its object, and a completed one still inside its window', async () => {
      const consumed = await completed();
      expect(await kit.uploads.consume(scopeOf(1), consumed.public_id)).toBe(true);
      const fresh = await completed();
      consumed.expires_at = new Date(Date.now() - 1);
      expect(await kit.uploads.sweepExpired()).toBe(0);
      expect(consumed.status).toBe('consumed');
      expect(kit.s3Multipart.objects.has(consumed.s3_key)).toBe(true);
      expect(files().find((f) => f.id === consumed.stored_file_id)).toBeDefined();
      expect(fresh.status).toBe('completed');
      expect(kit.s3Multipart.objects.has(fresh.s3_key)).toBe(true);
      expect(UPLOAD_SESSION_TTL_MS).toBe(24 * 3_600_000);
    });

    it('leaves the session completed so the next run retries when the S3 delete fails', async () => {
      const s = await completed();
      s.expires_at = new Date(Date.now() - 1);
      kit.s3Multipart.deleteFile.mockRejectedValueOnce(new Error('s3 down'));
      expect(await kit.uploads.sweepExpired()).toBe(0);
      expect(s.status).toBe('completed');
      expect(files().find((f) => f.id === s.stored_file_id)).toBeDefined();
      expect(await kit.uploads.sweepExpired()).toBe(1);
      expect(s.status).toBe('aborted');
    });
  });

  describe('complete retry', () => {
    async function openedWithPart() {
      const init = await kit.uploads.init(scopeOf(1), {}, png);
      await kit.uploads.putPart(scopeOf(1), init.upload_id, 1, pngOf(40));
      return init.upload_id;
    }

    it('finishes the DB step when S3 already joined the parts and a later step failed', async () => {
      const id = await openedWithPart();
      kit.s3Multipart.hashObject.mockRejectedValueOnce(new Error('hash failed'));
      await expect(kit.uploads.complete(scopeOf(1), id)).rejects.toThrow('hash failed');
      const done = await kit.uploads.complete(scopeOf(1), id);
      expect(done).toMatchObject({ upload_id: id, size_bytes: 40, status: 'completed' });
      expect(files()).toHaveLength(1);
      expect(sessions()[0].status).toBe('completed');
    });

    it('reuses the row left by a first attempt that failed after creating it', async () => {
      const id = await openedWithPart();
      await kit.uploads.complete(scopeOf(1), id);
      // the session update of that attempt never landed: S3 and the row exist, the session is still open
      Object.assign(sessions()[0], { status: 'open', stored_file_id: null });
      const again = await kit.uploads.complete(scopeOf(1), id);
      expect(again.status).toBe('completed');
      expect(files()).toHaveLength(1);
      expect(sessions()[0].stored_file_id).toBe(files()[0].id);
      expect(kit.s3Multipart.objects.has(sessions()[0].s3_key)).toBe(true);
    });

    it('asks for a new upload with a 422 when the object is really gone', async () => {
      const id = await openedWithPart();
      kit.s3Multipart.hashObject.mockRejectedValueOnce(new Error('hash failed'));
      await expect(kit.uploads.complete(scopeOf(1), id)).rejects.toThrow('hash failed');
      kit.s3Multipart.objects.clear();
      expect(await codeOf(kit.uploads.complete(scopeOf(1), id))).toBe('WORKFLOW_UPLOAD_INVALID');
    });
  });
});

describe('WorkflowPublicUploadsService: P7.1 storage limit', () => {
  it('init is refused with the neutral intake error before any S3 call or session', async () => {
    const kit = buildPublicKit();
    seedPeople(kit.db);
    kit.db.insert('organizations', { id: 1, slug: 'org' });
    kit.as({ store_id: 1, user_id: undefined, permissions: [], is_owner: false });
    const l = buildLimits(kit.db, { limits: { storage_bytes: 10 } });
    (kit.uploads as any).limits = l.service;
    const scope: UploadScope = {
      store_id: 1,
      organization_id: 1,
      public_link_id: 1,
      folder: 'workflows/public',
      field_key: 'adjunto',
    };
    const err = await kit.uploads
      .init(scope, {}, { file_name: 'foto.png', mime_type: 'image/png', size_bytes: 40 })
      .catch((e) => e);
    expect(err.errorCode).toBe('WORKFLOW_INTAKE_UNAVAILABLE');
    expect(kit.s3Multipart.createMultipartUpload).not.toHaveBeenCalled();
    expect(kit.db.table('workflow_upload_sessions')).toHaveLength(0);
  });
});
