import { createHash } from 'crypto';
import { VendixHttpException } from '@common/errors';
import {
  buildWorkflowKit,
  seedPeople,
} from '../../../testing/workflows/workflow-test-kit';
import {
  DEFAULT_MAX_FILE_BYTES,
  DOCX_MIME,
  HARD_MAX_FILE_BYTES,
  MB,
  XLSX_MIME,
} from './documents.constants';
import { sanitizeFileName } from './stored-files.service';
import { buildLimits } from '../workflows/limits/workflow-limits.testkit';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png-body'),
]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const zip = (entry: string) =>
  Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`...${entry}document.xml`)]);

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof VendixHttpException ? e.errorCode : `OTHER:${(e as Error).message}`;
  }
}

describe('StoredFilesService', () => {
  let kit: ReturnType<typeof buildWorkflowKit>;
  const upload = (over: Partial<Parameters<typeof kit.storedFiles.upload>[0]> = {}) =>
    kit.storedFiles.upload({
      buffer: PDF,
      originalName: 'contrato.pdf',
      mimeType: 'application/pdf',
      folder: 'workflows/5',
      ...over,
    });

  beforeEach(() => {
    kit = buildWorkflowKit();
    seedPeople(kit.db);
    kit.db.table('stores').forEach((s) => (s.slug = `tienda`));
    kit.db.insert('organizations', { id: 1, slug: 'acme' });
  });
  afterEach(() => jest.restoreAllMocks());

  describe('subida', () => {
    it('guarda por llave bajo el prefijo de la tienda, con sha256, tamaño y autor', async () => {
      const row = await upload();
      expect(row.s3_key).toMatch(
        /^organizations\/acme-1\/stores\/tienda-1\/workflows\/5\/[0-9a-f-]{36}\.pdf$/,
      );
      expect(row).toMatchObject({
        store_id: 1,
        organization_id: 1,
        original_name: 'contrato.pdf',
        mime_type: 'application/pdf',
        size_bytes: PDF.length,
        source: 'upload',
        uploaded_by_type: 'user',
        uploaded_by_id: 1,
      });
      expect(row.sha256).toBe(createHash('sha256').update(PDF).digest('hex'));
      expect(kit.s3.uploadFile).toHaveBeenCalledTimes(1);
      expect(kit.s3.uploadFile).toHaveBeenCalledWith(PDF, row.s3_key, 'application/pdf');
      expect(kit.db.table('stored_files')).toHaveLength(1);
    });

    it('el mismo contenido da el mismo sha256 y distinto contenido, otro', async () => {
      const a = await upload();
      const b = await upload();
      const c = await upload({ buffer: Buffer.concat([PDF, Buffer.from('x')]) });
      expect(a.sha256).toBe(b.sha256);
      expect(c.sha256).not.toBe(a.sha256);
      expect(a.s3_key).not.toBe(b.s3_key);
    });

    it.each([
      ['png', PNG, 'foto.png', 'image/png'],
      ['jpeg', JPEG, 'foto.jpg', 'image/jpeg'],
      ['webp', WEBP, 'foto.webp', 'image/webp'],
      ['docx', zip('word/'), 'acta.docx', DOCX_MIME],
      ['xlsx', zip('xl/'), 'datos.xlsx', XLSX_MIME],
      ['txt', Buffer.from('hola'), 'nota.txt', 'text/plain'],
    ])('acepta un %s legítimo', async (_n, buffer, originalName, mimeType) => {
      expect(await codeOf(upload({ buffer, originalName, mimeType }))).toBeUndefined();
    });

    it('limpia el nombre original (sin rutas ni caracteres peligrosos)', async () => {
      const row = await upload({ originalName: '..\\..\\etc/pass<wd>.pdf' });
      expect(row.original_name).toBe('pass_wd_.pdf');
      expect(sanitizeFileName('   ')).toBe('archivo');
      expect(sanitizeFileName('a\u0000b.pdf')).toBe('ab.pdf');
    });
  });

  describe('límites de tamaño', () => {
    it('sobre el tope por defecto (10 MB) → DOCUMENT_TOO_LARGE y no sube nada', async () => {
      const big = Buffer.concat([PDF, Buffer.alloc(DEFAULT_MAX_FILE_BYTES)]);
      expect(await codeOf(upload({ buffer: big }))).toBe('DOCUMENT_TOO_LARGE');
      expect(kit.s3.uploadFile).not.toHaveBeenCalled();
      expect(kit.db.table('stored_files')).toHaveLength(0);
    });

    it('exactamente el tope por defecto se acepta', async () => {
      const exact = Buffer.concat([PDF, Buffer.alloc(DEFAULT_MAX_FILE_BYTES - PDF.length)]);
      expect(exact.length).toBe(DEFAULT_MAX_FILE_BYTES);
      expect(await codeOf(upload({ buffer: exact }))).toBeUndefined();
    });

    it('sobre el máximo del requisito → DOCUMENT_TOO_LARGE (el requisito puede ser menor al defecto)', async () => {
      const over = Buffer.concat([PDF, Buffer.alloc(MB)]);
      expect(await codeOf(upload({ buffer: over, maxSizeMb: 1 }))).toBe('DOCUMENT_TOO_LARGE');
    });

    it('un máximo de requisito mayor al defecto se respeta hasta el tope duro', async () => {
      const twelve = Buffer.concat([PDF, Buffer.alloc(12 * MB)]);
      expect(await codeOf(upload({ buffer: twelve }))).toBe('DOCUMENT_TOO_LARGE');
      expect(await codeOf(upload({ buffer: twelve, maxSizeMb: 20 }))).toBeUndefined();
    });

    it('sobre el tope duro (25 MB) falla aunque el requisito pida más', async () => {
      const huge = Buffer.concat([PDF, Buffer.alloc(HARD_MAX_FILE_BYTES)]);
      expect(await codeOf(upload({ buffer: huge, maxSizeMb: 100 }))).toBe('DOCUMENT_TOO_LARGE');
      expect(kit.s3.uploadFile).not.toHaveBeenCalled();
    });

    it('un archivo vacío se rechaza', async () => {
      expect(await codeOf(upload({ buffer: Buffer.alloc(0) }))).toBe('DOCUMENT_FILE_REQUIRED');
    });
  });

  describe('tipo', () => {
    it('un tipo fuera de la lista → DOCUMENT_TYPE_NOT_ALLOWED', async () => {
      expect(
        await codeOf(upload({ originalName: 'virus.exe', mimeType: 'application/x-msdownload' })),
      ).toBe('DOCUMENT_TYPE_NOT_ALLOWED');
      expect(await codeOf(upload({ mimeType: '' }))).toBe('DOCUMENT_TYPE_NOT_ALLOWED');
    });

    it('el requisito/campo restringe con accept (incluye comodín type/*)', async () => {
      expect(await codeOf(upload({ accept: ['image/*'] }))).toBe('DOCUMENT_TYPE_NOT_ALLOWED');
      expect(await codeOf(upload({ accept: ['application/pdf'] }))).toBeUndefined();
      expect(
        await codeOf(
          upload({ buffer: PNG, originalName: 'a.png', mimeType: 'image/png', accept: ['image/*'] }),
        ),
      ).toBeUndefined();
    });

    it('un .pdf con bytes de PNG → DOCUMENT_TYPE_MISMATCH', async () => {
      expect(await codeOf(upload({ buffer: PNG }))).toBe('DOCUMENT_TYPE_MISMATCH');
      expect(kit.s3.uploadFile).not.toHaveBeenCalled();
    });

    it('bytes de PDF declarados como PNG, extensión que no corresponde y texto binario → MISMATCH', async () => {
      expect(await codeOf(upload({ mimeType: 'image/png', originalName: 'a.png' }))).toBe(
        'DOCUMENT_TYPE_MISMATCH',
      );
      expect(await codeOf(upload({ buffer: PNG, mimeType: 'image/png', originalName: 'a.pdf' }))).toBe(
        'DOCUMENT_TYPE_MISMATCH',
      );
      expect(
        await codeOf(
          upload({ buffer: Buffer.from([0x68, 0x00, 0x69]), mimeType: 'text/plain', originalName: 'a.txt' }),
        ),
      ).toBe('DOCUMENT_TYPE_MISMATCH');
    });

    it('un zip cualquiera no pasa por docx/xlsx ni uno por el otro', async () => {
      expect(
        await codeOf(upload({ buffer: zip('otro/'), mimeType: DOCX_MIME, originalName: 'a.docx' })),
      ).toBe('DOCUMENT_TYPE_MISMATCH');
      expect(
        await codeOf(upload({ buffer: zip('word/'), mimeType: XLSX_MIME, originalName: 'a.xlsx' })),
      ).toBe('DOCUMENT_TYPE_MISMATCH');
    });
  });

  describe('compensación', () => {
    it('si el insert falla, borra el objeto subido y relanza el error', async () => {
      jest
        .spyOn(kit.prisma.stored_files, 'create')
        .mockRejectedValueOnce(new Error('db caída'));
      await expect(upload()).rejects.toThrow('db caída');
      const key = (kit.s3.uploadFile.mock.calls[0] as any[])[1];
      expect(kit.s3.deleteFile).toHaveBeenCalledWith(key);
      expect(kit.db.table('stored_files')).toHaveLength(0);
    });

    it('discard borra fila y objeto; un fallo del borrado en S3 no propaga', async () => {
      const row = await upload();
      kit.s3.deleteFile.mockRejectedValueOnce(new Error('s3 caído'));
      await expect(kit.storedFiles.discard(row)).resolves.toBeUndefined();
      expect(kit.db.table('stored_files')).toHaveLength(0);
      expect(kit.s3.deleteFile).toHaveBeenCalledWith(row.s3_key);
    });

    describe('retención y legal_hold', () => {
      const DAY = 86_400_000;
      const stored = (id: number) => kit.db.table('stored_files').find((f) => f.id === id);

      it.each([
        ['bajo legal_hold', { legal_hold: true, retention_until: null }],
        ['con retención vigente', { legal_hold: false, retention_until: new Date(Date.now() + DAY) }],
        ['con legal_hold aunque la retención ya venció', { legal_hold: true, retention_until: new Date(Date.now() - DAY) }],
      ])('discard rechaza una fila %s (409 DOCUMENT_RETAINED) y no borra ni la fila ni el objeto', async (_l, hold) => {
        const row = await upload();
        Object.assign(stored(row.id)!, hold);
        const err = await kit.storedFiles.discard(row).catch((e) => e);
        expect(err).toBeInstanceOf(VendixHttpException);
        expect(err.errorCode).toBe('DOCUMENT_RETAINED');
        expect(err.getStatus()).toBe(409);
        expect(stored(row.id)).toBeDefined();
        expect(kit.s3.deleteFile).not.toHaveBeenCalled();
      });

      it('con la retención ya vencida y sin legal_hold sí se descarta', async () => {
        const row = await upload();
        Object.assign(stored(row.id)!, { legal_hold: false, retention_until: new Date(Date.now() - DAY) });
        await expect(kit.storedFiles.discard(row)).resolves.toBeUndefined();
        expect(stored(row.id)).toBeUndefined();
        expect(kit.s3.deleteFile).toHaveBeenCalledWith(row.s3_key);
      });

      it('la comprobación corre dentro de una transacción', async () => {
        const row = await upload();
        const svc = kit.storedFiles as any;
        const real = svc.prisma;
        const tx = jest.fn((fn: any) => real.$transaction(fn));
        // Fuera de la transacción el cliente no puede borrar: todo pasa por `tx`.
        svc.prisma = { $transaction: tx, stored_files: {} };
        await kit.storedFiles.discard(row);
        svc.prisma = real;
        expect(tx).toHaveBeenCalledTimes(1);
        expect(stored(row.id)).toBeUndefined();
      });
    });
  });

  describe('descarga firmada', () => {
    it('URL de vida corta (≤ 5 min) con metadatos y entrada de auditoría; no persiste la URL', async () => {
      const row = await upload();
      const out = await kit.storedFiles.signedDownloadUrl(row.id);
      expect(out.expires_in).toBeLessThanOrEqual(300);
      // Always a download: a stored HTML or SVG must not render on the bucket's origin.
      expect(kit.s3.getPresignedUrl).toHaveBeenCalledWith(row.s3_key, out.expires_in, {
        downloadName: 'contrato.pdf',
      });
      expect(out).toMatchObject({
        original_name: 'contrato.pdf',
        mime_type: 'application/pdf',
        sha256: row.sha256,
      });
      expect(out.url).toContain(row.s3_key);
      expect(kit.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          storeId: 1,
          organizationId: 1,
          resource: 'stored_files',
          resourceId: row.id,
        }),
      );
      expect(JSON.stringify(kit.db.table('stored_files'))).not.toContain('signed.example');
    });

    it('un archivo de otra tienda o eliminado → DOCUMENT_NOT_FOUND', async () => {
      const foreign = kit.db.insert('stored_files', { store_id: 2, organization_id: 1, s3_key: 'x/2' });
      const gone = kit.db.insert('stored_files', {
        store_id: 1,
        organization_id: 1,
        s3_key: 'x/3',
        deleted_at: new Date(),
      });
      expect(await codeOf(kit.storedFiles.signedDownloadUrl(foreign.id))).toBe('DOCUMENT_NOT_FOUND');
      expect(await codeOf(kit.storedFiles.signedDownloadUrl(gone.id))).toBe('DOCUMENT_NOT_FOUND');
      expect(kit.s3.getPresignedUrl).not.toHaveBeenCalled();
      expect(kit.audit.log).not.toHaveBeenCalled();
    });
  });

  describe('P7.1 storage limit', () => {
    const GB = 1024 ** 3;
    const wire = (cap: number | null) => {
      const l = buildLimits(kit.db, { limits: { storage_bytes: cap } });
      (kit.storedFiles as any).limits = l.service;
      return l;
    };
    const putS3Calls = () => kit.s3.uploadFile.mock.calls.length;

    it('a staff upload over the plan storage is refused with the plan details before S3', async () => {
      wire(PDF.length + 10);
      kit.db.insert('stored_files', { store_id: 1, organization_id: 1, size_bytes: 20, s3_key: 'x/1' });
      const err = await upload().catch((e) => e);
      expect(err.errorCode).toBe('WORKFLOW_PLAN_LIMIT_REACHED');
      const details = err.getResponse?.()?.details ?? err.details;
      expect(details).toMatchObject({ limit: 'storage_bytes', cap: PDF.length + 10 });
      expect(putS3Calls()).toBe(0);
    });

    it('a public_form upload over the limit answers the neutral intake error', async () => {
      wire(1);
      expect(await codeOf(upload({ source: 'public_form' } as never))).toBe('WORKFLOW_INTAKE_UNAVAILABLE');
      expect(putS3Calls()).toBe(0);
    });

    it('generated files are exempt from the storage check', async () => {
      wire(1);
      expect(await codeOf(upload({ source: 'generated' } as never))).toBeUndefined();
    });

    it('with room left (or no cap) the upload behaves as before', async () => {
      wire(GB);
      expect(await codeOf(upload())).toBeUndefined();
      wire(null);
      expect(await codeOf(upload())).toBeUndefined();
    });
  });
});
