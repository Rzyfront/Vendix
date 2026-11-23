import {
  decodeDataUri,
  detectQueuedDocument,
  discardQueuedDocument,
  loadQueuedDocument,
  stashQueuedDocument,
} from './queued-document';

const PDF = Buffer.from('%PDF-1.7 hola');

describe('queued-document (legacy AI queues, ia-cargas F5a)', () => {
  it('detects the REAL type by signature and rejects sheets and junk as a document problem', () => {
    expect(detectQueuedDocument({ buffer: PDF, mimetype: 'image/jpeg' }).mime).toBe('application/pdf');
    expect(() =>
      detectQueuedDocument({ buffer: Buffer.from('a;b\n1;2'), originalname: 'x.csv', mimetype: 'text/csv' }),
    ).toThrow(expect.objectContaining({ errorCode: 'AI_INGEST_INVALID_FILE' }));
    expect(() => detectQueuedDocument({ buffer: Buffer.alloc(0) })).toThrow(
      expect.objectContaining({ errorCode: 'AI_INGEST_INVALID_FILE' }),
    );
  });

  it('stashes the upload in S3 under the ai-scans prefix and returns only the key', async () => {
    const s3 = { uploadFile: jest.fn(async (_b: Buffer, key: string) => key) };
    const ref = await stashQueuedDocument(s3 as any, {
      kind: 'expense',
      file: { buffer: PDF, originalname: '../mi factura.pdf' },
      detected: detectQueuedDocument({ buffer: PDF }),
      organizationId: 3,
      storeId: 11,
    });
    expect(ref.file_key).toMatch(/^ai-scans\/3\/store-11\/expense\/\d+-mi_factura\.pdf$/);
    expect(ref).toEqual(expect.objectContaining({ mimeType: 'application/pdf', originalName: 'mi_factura.pdf' }));
    expect(ref).not.toHaveProperty('dataUri');
    expect(s3.uploadFile).toHaveBeenCalledWith(PDF, ref.file_key, 'application/pdf');
  });

  it('an S3 failure on stash is UPLOAD_FAILED_001', async () => {
    const s3 = { uploadFile: jest.fn().mockRejectedValue(new Error('s3 down')) };
    await expect(
      stashQueuedDocument(s3 as any, { kind: 'expense', file: { buffer: PDF }, detected: detectQueuedDocument({ buffer: PDF }) }),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_FAILED_001' });
  });

  it('loads a new job from S3 and an old job from its data URI', async () => {
    const s3 = { downloadFile: jest.fn().mockResolvedValue(PDF) };
    await expect(
      loadQueuedDocument(s3 as any, { file_key: 'k', mimeType: 'application/pdf', originalName: 'f.pdf' }),
    ).resolves.toEqual({ buffer: PDF, mimeType: 'application/pdf', originalName: 'f.pdf' });

    const old = await loadQueuedDocument(s3 as any, {
      dataUri: `data:image/jpeg;base64,${Buffer.from('jpeg').toString('base64')}`,
      mimeType: 'image/jpeg',
    });
    expect(old.buffer.toString()).toBe('jpeg');
    expect(s3.downloadFile).toHaveBeenCalledTimes(1);

    await expect(loadQueuedDocument(s3 as any, { mimeType: 'image/jpeg' })).rejects.toMatchObject({
      errorCode: 'AI_INGEST_INVALID_FILE',
    });
  });

  it('decodeDataUri only accepts base64 data URIs', () => {
    expect(decodeDataUri('data:application/pdf;base64,' + PDF.toString('base64'))).toEqual({
      buffer: PDF,
      mime: 'application/pdf',
    });
    expect(decodeDataUri('data:text/plain,hola')).toBeNull();
    expect(decodeDataUri('https://x/y.jpg')).toBeNull();
  });

  it('discard is best effort and only touches S3 jobs', async () => {
    const s3 = { deleteFile: jest.fn().mockRejectedValue(new Error('gone')) };
    await expect(discardQueuedDocument(s3 as any, { file_key: 'k', mimeType: 'x' })).resolves.toBeUndefined();
    await discardQueuedDocument(s3 as any, { dataUri: 'data:x;base64,AA', mimeType: 'x' });
    expect(s3.deleteFile).toHaveBeenCalledTimes(1);
  });
});
