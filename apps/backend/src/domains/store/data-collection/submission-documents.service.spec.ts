import { VendixHttpException } from '../../../common/errors';
import { SubmissionDocumentsService } from './submission-documents.service';

const BASE = 'organizations/acme-2/stores/centro-10';
const PREFIX = `${BASE}/data-collection`;

const PDF = Buffer.from('%PDF-1.4 hello');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

const fileItem = (rules: unknown = { documents: { multiple: false, accept: ['pdf', 'image'], max_size_mb: 1 } }) => ({
  metadata_field_id: 5,
  metadata_field: { id: 5, field_type: 'file' },
  validation_rules: rules,
});

const submission = (items: any[] = [fileItem()]) => ({
  id: 9,
  store_id: 10,
  template: {
    tabs: [],
    sections: [
      { items, child_sections: [] },
    ],
  },
});

function mkFile(name: string, mime: string, buffer: Buffer, size = buffer.length) {
  return { originalname: name, mimetype: mime, buffer, size } as any;
}

function setup() {
  const prisma = {
    stores: {
      findUnique: jest.fn(async (..._args: any[]) => ({
        id: 10,
        slug: 'centro',
        organizations: { id: 2, slug: 'acme' },
      })),
    },
  } as Record<string, any>;
  prisma.withoutScope = () => prisma;
  const s3 = {
    uploadFile: jest.fn(async (_b: Buffer, key: string) => key),
    uploadImage: jest.fn(async (_b: Buffer, key: string) => ({ key })),
    signUrl: jest.fn(async (key: string) => `https://signed.example/${key}`),
  };
  const s3Path = {
    buildStorePath: jest.fn(
      (org: any, store: any) =>
        `organizations/${org.slug}-${org.id}/stores/${store.slug}-${store.id}`,
    ),
  };
  const service = new SubmissionDocumentsService(prisma as any, s3 as any, s3Path as any);
  return { service, s3 };
}

async function codeOf(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(VendixHttpException);
  return (error as VendixHttpException).errorCode;
}

describe('SubmissionDocumentsService.upload (S3)', () => {
  it('accepts a valid pdf, keeps original bytes under the store prefix and returns file metadata', async () => {
    const { service, s3 } = setup();
    const res: any = await service.upload(submission() as any, mkFile('Cédula frente.pdf', 'application/pdf', PDF), 5);
    expect(s3.uploadFile).toHaveBeenCalledWith(PDF, expect.stringMatching(new RegExp(`^${PREFIX}/9/\\d+-Cedula_frente\\.pdf$`)), 'application/pdf');
    expect(res.key.startsWith(`${PREFIX}/9/`)).toBe(true);
    expect(res).toMatchObject({
      name: 'Cédula frente.pdf',
      originalName: 'Cédula frente.pdf',
      size: PDF.length,
      mime_type: 'application/pdf',
      url: expect.stringContaining('https://signed.example/'),
      uploaded_at: expect.any(String),
    });
  });

  it('images are not converted: original bytes are uploaded', async () => {
    const { service, s3 } = setup();
    await service.upload(submission() as any, mkFile('foto.png', 'image/png', PNG), 5);
    expect(s3.uploadImage).not.toHaveBeenCalled();
    expect(s3.uploadFile).toHaveBeenCalledWith(PNG, expect.any(String), 'image/png');
  });

  it('rejects a type outside the field config (DCOL_UPLOAD_001)', async () => {
    const { service, s3 } = setup();
    const code = await codeOf(service.upload(submission() as any, mkFile('a.exe', 'application/x-msdownload', PDF), 5));
    expect(code).toBe('DCOL_UPLOAD_001');
    expect(s3.uploadFile).not.toHaveBeenCalled();
  });

  it('rejects a file over the configured size (DCOL_UPLOAD_002)', async () => {
    const { service } = setup();
    const big = mkFile('a.pdf', 'application/pdf', PDF, 2 * 1024 * 1024);
    expect(await codeOf(service.upload(submission() as any, big, 5))).toBe('DCOL_UPLOAD_002');
  });

  it('a file field without documents config keeps the legacy policy: any known kind up to 20 MB', async () => {
    const { service, s3 } = setup();
    const legacy = submission([fileItem(null)]);
    const DOCX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
    const docx = mkFile(
      'contrato.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      DOCX,
      15 * 1024 * 1024,
    );
    const out = await service.upload(legacy as any, docx, 5);
    expect(out.key).toMatch(new RegExp(`^${PREFIX}/9/\\d+-contrato\\.docx$`));
    expect(s3.uploadFile).toHaveBeenCalled();
    const xlsx = mkFile('a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', DOCX);
    await expect(service.upload(legacy as any, xlsx, 5)).resolves.toBeDefined();
    const legacyNoKey = submission([fileItem({ min: 1 })]);
    await expect(service.upload(legacyNoKey as any, xlsx, 5)).resolves.toBeDefined();
    const huge = mkFile('a.pdf', 'application/pdf', PDF, 21 * 1024 * 1024);
    expect(await codeOf(service.upload(legacy as any, huge, 5))).toBe('DCOL_UPLOAD_002');
  });

  it('rejects when the bytes do not match the declared type (pdf name with PNG bytes)', async () => {
    const { service, s3 } = setup();
    const code = await codeOf(service.upload(submission() as any, mkFile('a.pdf', 'application/pdf', PNG), 5));
    expect(code).toBe('DCOL_UPLOAD_001');
    expect(s3.uploadFile).not.toHaveBeenCalled();
  });

  it('rejects a field that is not a file field of the template (DCOL_UPLOAD_003)', async () => {
    const { service } = setup();
    expect(await codeOf(service.upload(submission() as any, mkFile('a.pdf', 'application/pdf', PDF), 99))).toBe('DCOL_UPLOAD_003');
    const textSub = submission([{ metadata_field_id: 5, metadata_field: { id: 5, field_type: 'text' }, validation_rules: null }]);
    expect(await codeOf(service.upload(textSub as any, mkFile('a.pdf', 'application/pdf', PDF), 5))).toBe('DCOL_UPLOAD_003');
  });

  it('finds the field inside tabs and child sections', async () => {
    const { service } = setup();
    const sub: any = {
      id: 9,
      store_id: 10,
      template: {
        sections: [],
        tabs: [{ sections: [{ items: [], child_sections: [{ items: [fileItem()] }] }] }],
      },
    };
    await expect(service.upload(sub, mkFile('a.pdf', 'application/pdf', PDF), 5)).resolves.toBeDefined();
  });

  it('legacy upload without field_id keeps the old key shape and response', async () => {
    const { service, s3 } = setup();
    const res: any = await service.upload(submission() as any, mkFile('mi archivo.pdf', 'application/pdf', PNG));
    expect(s3.uploadFile).toHaveBeenCalledWith(PNG, expect.stringMatching(new RegExp(`^${PREFIX}/9/\\d+-mi_archivo\\.pdf$`)), 'application/pdf');
    expect(Object.keys(res).sort()).toEqual(['key', 'originalName', 'url']);
    await service.upload(submission() as any, mkFile('i.png', 'image/png', PNG));
    expect(s3.uploadImage).toHaveBeenCalledTimes(1);
  });
});

describe('SubmissionDocumentsService.buildStoredValue (S3 saveStep)', () => {
  const key = (n: string) => `${PREFIX}/9/${n}`;
  const doc = (n: string) => ({ key: key(n), name: n, size: 3, mime_type: 'application/pdf' });

  it('stores { files } and the first key as value_text', async () => {
    const { service } = setup();
    const out = await service.buildStoredValue(submission() as any, 5, { files: [doc('1-a.pdf')] });
    expect(out.value_json).toEqual({ files: [doc('1-a.pdf')] });
    expect(out.value_text).toBe(key('1-a.pdf'));
  });

  it('rejects keys of another store or with traversal (DCOL_UPLOAD_004)', async () => {
    const { service } = setup();
    const foreign = { ...doc('x.pdf'), key: 'organizations/other-3/stores/x-11/data-collection/1/x.pdf' };
    expect(await codeOf(service.buildStoredValue(submission() as any, 5, { files: [foreign] }))).toBe('DCOL_UPLOAD_004');
    const trav = { ...doc('x.pdf'), key: `${PREFIX}/../secret.pdf` };
    expect(await codeOf(service.buildStoredValue(submission() as any, 5, { files: [trav] }))).toBe('DCOL_UPLOAD_004');
  });

  it('two files with multiple=false are rejected; with multiple=true they are accepted; over 10 rejected', async () => {
    const { service } = setup();
    expect(await codeOf(service.buildStoredValue(submission() as any, 5, { files: [doc('1.pdf'), doc('2.pdf')] }))).toBe('DCOL_UPLOAD_004');
    const multi = submission([fileItem({ documents: { multiple: true, accept: ['pdf'], max_size_mb: 5 } })]);
    const ok = await service.buildStoredValue(multi as any, 5, { files: [doc('1.pdf'), doc('2.pdf')] });
    expect(ok.value_json.files).toHaveLength(2);
    const many = Array.from({ length: 11 }, (_, i) => doc(`${i}.pdf`));
    expect(await codeOf(service.buildStoredValue(multi as any, 5, { files: many }))).toBe('DCOL_UPLOAD_004');
  });
});

describe('SubmissionDocumentsService.signFiles (S3 read)', () => {
  it('signs every file and returns url null when signing fails', async () => {
    const { service, s3 } = setup();
    s3.signUrl.mockImplementationOnce(async () => { throw new Error('boom'); });
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    const k1 = `${PREFIX}/9/k1`;
    const k2 = `${PREFIX}/9/k2`;
    const files = await service.signFiles(10, [
      { key: k1, name: 'a', size: 1, mime_type: 'x' },
      { key: k2, name: 'b', size: 2, mime_type: 'y' },
      { key: 'organizations/other-3/stores/x-11/data-collection/1/k3', name: 'c', size: 3, mime_type: 'z' },
    ]);
    expect(files[0].url).toBeNull();
    expect(files[1]).toMatchObject({ key: k2, name: 'b', url: `https://signed.example/${k2}` });
    // A key of another store is never signed.
    expect(files[2].url).toBeNull();
    expect(s3.signUrl).toHaveBeenCalledTimes(2);
  });
});
