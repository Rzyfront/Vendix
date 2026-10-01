import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import * as path from 'node:path';
import { TextDecoder } from 'node:util';

import { isSafeS3Key } from '@common/helpers/s3-url.helper';
import { ErrorCodes } from '@common/errors/error-codes';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { S3Service } from '@common/services/s3.service';

export interface ReceivedDocumentStorageContext {
  organization_id: number;
  store_id: number | null;
  accounting_entity_id: number;
}

export interface ReceivedDocumentUploadFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface StoredReceivedDocumentFile {
  file_key: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  sha256: string;
}

type StorageDriver = 'local' | 's3';
type SupportedMime =
  | 'application/xml'
  | 'text/xml'
  | 'application/pdf'
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = new Set<SupportedMime>([
  'application/xml',
  'text/xml',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

/** Stores immutable supplier-document originals under an explicit tenant/entity prefix. */
@Injectable()
export class ReceivedDocumentStorageService {
  private readonly driver: StorageDriver;
  private readonly localRoot: string;

  constructor(private readonly s3Service: S3Service) {
    const configuredDriver =
      process.env.RECEIVED_DOCUMENT_STORAGE_DRIVER?.trim().toLowerCase() ||
      undefined;
    const isProduction = process.env.NODE_ENV === 'production';

    if (
      configuredDriver !== undefined &&
      configuredDriver !== 'local' &&
      configuredDriver !== 's3'
    ) {
      throw new Error('RECEIVED_DOCUMENT_STORAGE_DRIVER must be "local" or "s3"');
    }
    if (isProduction && configuredDriver === 'local') {
      throw new Error('Local received-document storage is not allowed in production');
    }

    this.driver =
      configuredDriver === 'local' || configuredDriver === 's3'
        ? configuredDriver
        : isProduction
          ? 's3'
          : 'local';
    this.localRoot = path.resolve(
      process.env.RECEIVED_DOCUMENT_LOCAL_ROOT || '/tmp/vendix-received-documents',
    );
  }

  async upload(
    context: ReceivedDocumentStorageContext,
    documentId: number,
    file: ReceivedDocumentUploadFile,
  ): Promise<StoredReceivedDocumentFile> {
    this.validateContext(context, documentId);
    const mimeType = this.validateFile(file);
    const fileName = this.sanitizeFileName(file.originalname);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const fileKey = this.buildKey(context, documentId, sha256, fileName);

    try {
      if (this.driver === 's3') {
        await this.s3Service.uploadFile(file.buffer, fileKey, mimeType);
      } else {
        await this.writeLocalImmutable(fileKey, file.buffer);
      }
    } catch (error) {
      if (error instanceof VendixHttpException) throw error;
      // Never expose provider paths, credentials, or storage error internals.
      throw new VendixHttpException(
        ErrorCodes.UPLOAD_FAILED_001,
        'No se pudo guardar el documento original. Intenta nuevamente.',
      );
    }

    return {
      file_key: fileKey,
      file_name: fileName,
      mime_type: mimeType,
      file_size: file.buffer.length,
      sha256,
    };
  }

  async download(
    context: ReceivedDocumentStorageContext,
    documentId: number,
    key: string,
  ): Promise<Buffer> {
    this.validateContext(context, documentId);
    this.validateDocumentKey(context, documentId, key);

    try {
      const contents = this.driver === 's3'
        ? await this.s3Service.downloadFile(key)
        : await this.readLocal(key);
      this.assertContentHash(key, contents);
      return contents;
    } catch (error) {
      if (error instanceof VendixHttpException) throw error;
      if (this.isNotFound(error)) {
        throw new VendixHttpException(
          ErrorCodes.SYS_NOT_FOUND_001,
          'No se encontró el archivo original del documento.',
        );
      }
      throw new VendixHttpException(
        ErrorCodes.UPLOAD_FAILED_001,
        'No se pudo leer el documento original. Intenta nuevamente.',
      );
    }
  }

  private validateContext(
    context: ReceivedDocumentStorageContext,
    documentId: number,
  ): void {
    if (
      !context ||
      !Number.isSafeInteger(context.organization_id) ||
      context.organization_id <= 0 ||
      !Number.isSafeInteger(context.accounting_entity_id) ||
      context.accounting_entity_id <= 0 ||
      (context.store_id !== null &&
        (!Number.isSafeInteger(context.store_id) || context.store_id <= 0)) ||
      !Number.isSafeInteger(documentId) ||
      documentId <= 0
    ) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'El contexto o identificador del documento no es válido.',
      );
    }
  }

  private validateFile(file: ReceivedDocumentUploadFile): SupportedMime {
    if (
      !file ||
      !Buffer.isBuffer(file.buffer) ||
      !Number.isSafeInteger(file.size) ||
      file.size <= 0 ||
      file.size !== file.buffer.length
    ) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'El archivo recibido está vacío o no coincide con su tamaño declarado.',
      );
    }
    if (file.buffer.length > MAX_FILE_SIZE) {
      throw new VendixHttpException(
        ErrorCodes.UPLOAD_REMOTE_SIZE_001,
        'El archivo supera el límite de 10 MB.',
      );
    }
    if (typeof file.originalname !== 'string' || !file.originalname.trim()) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'El archivo debe tener un nombre válido.',
      );
    }
    if (
      file.originalname.includes('\0') ||
      file.originalname.includes('/') ||
      file.originalname.includes('\\') ||
      file.originalname.includes('..') ||
      file.originalname.split(/[\\/]/).some((segment) => segment === '..')
    ) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'El nombre del archivo contiene una ruta no permitida.',
      );
    }

    const mimeType = file.mimetype?.toLowerCase().trim();
    if (!SUPPORTED_MIME_TYPES.has(mimeType as SupportedMime)) {
      throw new VendixHttpException(ErrorCodes.VALIDATION_FILE_TYPE);
    }

    const detectedMime = this.detectMime(file.buffer);
    if (mimeType === 'text/xml' || mimeType === 'application/xml') {
      if (detectedMime !== 'application/xml') {
        throw new VendixHttpException(ErrorCodes.VALIDATION_FILE_TYPE);
      }
    } else if (detectedMime !== mimeType) {
      throw new VendixHttpException(ErrorCodes.VALIDATION_FILE_TYPE);
    }

    return mimeType as SupportedMime;
  }

  private detectMime(buffer: Buffer): SupportedMime | null {
    if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
      return 'application/pdf';
    }
    if (
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      return 'image/png';
    }
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'image/jpeg';
    }
    if (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return 'image/webp';
    }

    // XML is text, so validate UTF-8 (including an optional BOM) and inspect
    // its document root rather than trusting the caller-provided MIME header.
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      const xml = text.replace(/^\uFEFF/, '').trimStart();
      if (
        !/<!DOCTYPE|<!ENTITY/i.test(xml) &&
        /^(?:<\?xml\b[^?]*\?>\s*)?<(?:[A-Za-z_][\w.-]*:)?(?:Invoice|CreditNote|DebitNote|AttachedDocument)(?:\s|>)/i.test(xml)
      ) {
        return 'application/xml';
      }
    } catch {
      return null;
    }
    return null;
  }

  private sanitizeFileName(originalName: string): string {
    const normalized = originalName.normalize('NFKC').trim();
    const safe = normalized
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/\.{2,}/g, '.')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 120);

    if (!safe || safe === '.' || safe === '..') {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'El nombre del archivo no es válido.',
      );
    }
    return safe;
  }

  private buildKey(
    context: ReceivedDocumentStorageContext,
    documentId: number,
    sha256: string,
    fileName: string,
  ): string {
    const key = `${this.tenantPrefix(context)}/${documentId}/${sha256}-${fileName}`;
    if (!isSafeS3Key(key)) {
      throw new VendixHttpException(ErrorCodes.SYS_VALIDATION_001);
    }
    return key;
  }

  private validateDocumentKey(
    context: ReceivedDocumentStorageContext,
    documentId: number,
    key: string,
  ): void {
    const prefix = `${this.tenantPrefix(context)}/${documentId}/`;
    const name = typeof key === 'string' ? key.slice(prefix.length) : '';
    if (
      !key ||
      !isSafeS3Key(key) ||
      !key.startsWith(prefix) ||
      !/^[a-f0-9]{64}-[A-Za-z0-9._-]{1,120}$/.test(name) ||
      name.includes('..')
    ) {
      throw new VendixHttpException(
        ErrorCodes.SYS_FORBIDDEN_001,
        'El archivo no pertenece al documento solicitado.',
      );
    }
  }

  private tenantPrefix(context: ReceivedDocumentStorageContext): string {
    return `organizations/${context.organization_id}/fiscal-entities/${context.accounting_entity_id}/received-documents`;
  }

  private resolveLocalPath(key: string): string {
    const resolved = path.resolve(this.localRoot, key);
    if (!resolved.startsWith(`${this.localRoot}${path.sep}`)) {
      throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);
    }
    return resolved;
  }

  private async writeLocalImmutable(key: string, contents: Buffer): Promise<void> {
    const destination = this.resolveLocalPath(key);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });

    try {
      const existing = await readFile(destination);
      if (createHash('sha256').update(existing).digest('hex') !== key.split('/').pop()?.slice(0, 64)) {
        throw new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          'Ya existe un archivo original distinto en la misma ubicación.',
        );
      }
      return;
    } catch (error) {
      if (error instanceof VendixHttpException) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(contents);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, destination);
    } catch (error) {
      try {
        await unlink(temporary);
      } catch {
        // Cleanup only this request's private temporary file; preserve original error.
      }
      // A concurrent identical upload may have completed the atomic rename first.
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const existing = await readFile(destination);
        if (createHash('sha256').update(existing).digest('hex') === key.split('/').pop()?.slice(0, 64)) {
          return;
        }
      }
      throw error;
    }
  }

  private async readLocal(key: string): Promise<Buffer> {
    const contents = await readFile(this.resolveLocalPath(key));
    return contents;
  }

  private assertContentHash(key: string, contents: Buffer): void {
    const expectedHash = key.split('/').pop()?.slice(0, 64);
    if (createHash('sha256').update(contents).digest('hex') !== expectedHash) {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        'La verificación de integridad del archivo falló.',
      );
    }
  }

  private isNotFound(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as {
      code?: unknown;
      name?: unknown;
      $metadata?: { httpStatusCode?: unknown };
    };
    return (
      candidate.code === 'ENOENT' ||
      candidate.name === 'NoSuchKey' ||
      candidate.name === 'NotFound' ||
      candidate.$metadata?.httpStatusCode === 404
    );
  }
}
