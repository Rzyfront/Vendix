import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { S3Service } from '@common/services/s3.service';
import {
  ReceivedDocumentStorageContext,
  ReceivedDocumentStorageService,
  ReceivedDocumentUploadFile,
} from './received-document-storage.service';

describe('ReceivedDocumentStorageService', () => {
  const context: ReceivedDocumentStorageContext = {
    organization_id: 12,
    store_id: 4,
    accounting_entity_id: 9,
  };
  const documentId = 35;
  const pdfBytes = Buffer.from('%PDF-1.7\noriginal supplier document\n', 'ascii');
  let localRoot: string;
  let previousEnv: Record<string, string | undefined>;
  let s3: {
    uploadFile: jest.Mock;
    downloadFile: jest.Mock;
    getPresignedUrl: jest.Mock;
  };

  const service = (): ReceivedDocumentStorageService =>
    new ReceivedDocumentStorageService(s3 as unknown as S3Service);

  const file = (overrides: Partial<ReceivedDocumentUploadFile> = {}): ReceivedDocumentUploadFile => ({
    buffer: pdfBytes,
    originalname: 'Factura proveedor 001.pdf',
    mimetype: 'application/pdf',
    size: pdfBytes.length,
    ...overrides,
  });

  beforeEach(async () => {
    previousEnv = {
      NODE_ENV: process.env.NODE_ENV,
      RECEIVED_DOCUMENT_STORAGE_DRIVER: process.env.RECEIVED_DOCUMENT_STORAGE_DRIVER,
      RECEIVED_DOCUMENT_LOCAL_ROOT: process.env.RECEIVED_DOCUMENT_LOCAL_ROOT,
    };
    localRoot = await mkdtemp(path.join(tmpdir(), 'vendix-received-documents-test-'));
    process.env.NODE_ENV = 'test';
    process.env.RECEIVED_DOCUMENT_STORAGE_DRIVER = 'local';
    process.env.RECEIVED_DOCUMENT_LOCAL_ROOT = localRoot;
    s3 = {
      uploadFile: jest.fn().mockResolvedValue('ignored-return-value'),
      downloadFile: jest.fn().mockResolvedValue(pdfBytes),
      getPresignedUrl: jest.fn().mockResolvedValue('https://signed.invalid/never-persist'),
    };
  });

  afterEach(async () => {
    await rm(localRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('writes local originals at deterministic tenant/entity/document keys and is idempotent', async () => {
    const storage = service();
    const first = await storage.upload(context, documentId, file());
    const second = await storage.upload(context, documentId, file());

    expect(first).toEqual(second);
    expect(first.file_key).toMatch(
      /^organizations\/12\/fiscal-entities\/9\/received-documents\/35\/[a-f0-9]{64}-Factura-proveedor-001\.pdf$/,
    );
    expect(first.file_key).not.toContain('http');
    expect(first.sha256).toHaveLength(64);
    expect(first.file_size).toBe(pdfBytes.length);
    expect(await readFile(path.join(localRoot, first.file_key))).toEqual(pdfBytes);
    expect(s3.uploadFile).not.toHaveBeenCalled();
    expect(s3.getPresignedUrl).not.toHaveBeenCalled();
  });

  it('uses local storage when a non-production driver setting is empty or whitespace', async () => {
    process.env.RECEIVED_DOCUMENT_STORAGE_DRIVER = '   ';
    const storage = service();

    const uploaded = await storage.upload(context, documentId, file());

    expect(await readFile(path.join(localRoot, uploaded.file_key))).toEqual(pdfBytes);
    expect(s3.uploadFile).not.toHaveBeenCalled();
  });

  it('rejects keys for another org, entity, or document before reading storage', async () => {
    const storage = service();
    const original = await storage.upload(context, documentId, file());

    await expect(
      storage.download({ ...context, organization_id: 13 }, documentId, original.file_key),
    ).rejects.toThrow();
    await expect(
      storage.download({ ...context, accounting_entity_id: 10 }, documentId, original.file_key),
    ).rejects.toThrow();
    await expect(storage.download(context, documentId + 1, original.file_key)).rejects.toThrow();
  });

  it('rejects traversal names, MIME/signature mismatches, invalid ids, and size mismatches', async () => {
    const storage = service();

    await expect(storage.upload(context, documentId, file({ originalname: '../secret.pdf' }))).rejects.toThrow();
    await expect(storage.upload(context, documentId, file({ originalname: 'C:\\secret.pdf' }))).rejects.toThrow();
    await expect(storage.upload(context, documentId, file({ originalname: 'bad\0name.pdf' }))).rejects.toThrow();
    await expect(
      storage.upload(context, documentId, file({ buffer: Buffer.from('not a PDF'), size: 9 })),
    ).rejects.toThrow();
    await expect(
      storage.upload(context, documentId, file({ mimetype: 'image/png' })),
    ).rejects.toThrow();
    await expect(storage.upload(context, 0, file())).rejects.toThrow();
    await expect(storage.upload({ ...context, store_id: -1 }, documentId, file())).rejects.toThrow();
    await expect(storage.upload(context, documentId, file({ size: pdfBytes.length + 1 }))).rejects.toThrow();
  });

  it('rejects uploads larger than 10 MiB before inspecting their content', async () => {
    const storage = service();
    const tooLarge = Buffer.alloc(10 * 1024 * 1024 + 1);

    await expect(
      storage.upload(context, documentId, file({ buffer: tooLarge, size: tooLarge.length })),
    ).rejects.toThrow();
  });

  it('rejects tampered local and S3 bytes when their content hash differs from the key', async () => {
    const localStorage = service();
    const localFile = await localStorage.upload(context, documentId, file());
    await writeFile(path.join(localRoot, localFile.file_key), Buffer.from('%PDF-1.7\ntampered\n'));

    await expect(
      localStorage.download(context, documentId, localFile.file_key),
    ).rejects.toMatchObject({ errorCode: 'SYS_CONFLICT_001' });

    process.env.RECEIVED_DOCUMENT_STORAGE_DRIVER = 's3';
    s3.downloadFile.mockResolvedValue(Buffer.from('%PDF-1.7\ntampered\n'));
    const s3Storage = service();
    const s3File = await s3Storage.upload(context, documentId, file());

    await expect(
      s3Storage.download(context, documentId, s3File.file_key),
    ).rejects.toMatchObject({ errorCode: 'SYS_CONFLICT_001' });
  });

  it('accepts BOM-prefixed UTF-8 UBL XML only with XML MIME', async () => {
    const storage = service();
    const xml = Buffer.from('\uFEFF<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:ubl"/>', 'utf8');
    const result = await storage.upload(context, documentId, file({
      buffer: xml,
      originalname: 'factura.xml',
      mimetype: 'application/xml',
      size: xml.length,
    }));

    expect(result.mime_type).toBe('application/xml');
    expect(await storage.download(context, documentId, result.file_key)).toEqual(xml);
  });

  it('refuses local storage in production instead of silently falling back', () => {
    process.env.NODE_ENV = 'production';
    process.env.RECEIVED_DOCUMENT_STORAGE_DRIVER = 'local';

    expect(() => service()).toThrow(/not allowed in production/i);
  });

  it('defaults empty production driver settings to S3', async () => {
    process.env.NODE_ENV = 'production';
    process.env.RECEIVED_DOCUMENT_STORAGE_DRIVER = '  ';
    const storage = service();

    const uploaded = await storage.upload(context, documentId, file());

    expect(s3.uploadFile).toHaveBeenCalledWith(pdfBytes, uploaded.file_key, 'application/pdf');
    expect(s3.downloadFile).not.toHaveBeenCalled();
  });

  it('rejects an unknown non-empty driver setting', () => {
    process.env.RECEIVED_DOCUMENT_STORAGE_DRIVER = 'remote';

    expect(() => service()).toThrow(/must be "local" or "s3"/i);
  });

  it('uses S3 upload/download in the S3 driver and persists only the key, never a signed URL', async () => {
    process.env.RECEIVED_DOCUMENT_STORAGE_DRIVER = 's3';
    const storage = service();

    const uploaded = await storage.upload(context, documentId, file());
    const downloaded = await storage.download(context, documentId, uploaded.file_key);

    expect(s3.uploadFile).toHaveBeenCalledWith(
      pdfBytes,
      uploaded.file_key,
      'application/pdf',
    );
    expect(s3.downloadFile).toHaveBeenCalledWith(uploaded.file_key);
    expect(downloaded).toEqual(pdfBytes);
    expect(uploaded.file_key).not.toContain('://');
    expect(s3.getPresignedUrl).not.toHaveBeenCalled();
  });
});
