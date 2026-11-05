import { randomUUID, createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { S3Service } from '@common/services/s3.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { AuditAction, AuditService } from '@common/audit/audit.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  ALLOWED_MIME_EXTENSIONS,
  DEFAULT_MAX_FILE_BYTES,
  DOWNLOAD_URL_TTL_SECONDS,
  HARD_MAX_FILE_BYTES,
  MB,
} from './documents.constants';
import { bytesMatchMime } from './file-signature';

export interface UploadFileInput {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  source?: 'upload' | 'generated' | 'public_form';
  /** MIME patterns of the requirement/field (`type/subtype` or `type/*`). */
  accept?: string[];
  /** Per-requirement limit in MB (clamped to the hard cap). */
  maxSizeMb?: number;
  /** Folder under the store prefix, e.g. `workflows/12`. */
  folder: string;
  actor?: { type: 'user' | 'public' | 'system' | 'ai'; id: number | null };
}

export interface StoredFileRow {
  id: number;
  organization_id: number;
  store_id: number;
  s3_key: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  source: string;
  uploaded_by_type: string;
  uploaded_by_id: number | null;
  created_at: Date;
}

/** Strips path parts and control characters; keeps a readable, bounded name. */
export function sanitizeFileName(name: string): string {
  const base = (name ?? '').replace(/\\/g, '/').split('/').pop() ?? '';
  const clean = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  if (!clean) return 'archivo';
  const dot = clean.lastIndexOf('.');
  if (clean.length <= 255) return clean;
  const ext = dot > 0 ? clean.slice(dot).slice(0, 10) : '';
  return clean.slice(0, 255 - ext.length) + ext;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function acceptMatches(accept: string[], mime: string): boolean {
  return accept.some((p) =>
    p.endsWith('/*') ? mime.startsWith(p.slice(0, -1)) : p.toLowerCase() === mime,
  );
}

/** Secure upload (type, size, hash), S3 storage by key only, signed download. */
@Injectable()
export class StoredFilesService {
  private readonly logger = new Logger(StoredFilesService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3: S3Service,
    private readonly paths: S3PathHelper,
    private readonly audit: AuditService,
  ) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id) {
      throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    }
    return {
      store_id: c.store_id,
      organization_id: c.organization_id,
      user_id: c.user_id ?? null,
    };
  }

  /** Throws the right `DOCUMENT_*` error; returns the normalized MIME + name. */
  validate(input: UploadFileInput): { mime: string; name: string; ext: string } {
    const size = input.buffer?.length ?? 0;
    if (size === 0) throw new VendixHttpException(ErrorCodes.DOCUMENT_FILE_REQUIRED);
    const requested = input.maxSizeMb ? input.maxSizeMb * MB : DEFAULT_MAX_FILE_BYTES;
    const max = Math.min(requested, HARD_MAX_FILE_BYTES);
    if (size > max) {
      throw new VendixHttpException(
        ErrorCodes.DOCUMENT_TOO_LARGE,
        `El archivo pesa ${(size / MB).toFixed(1)} MB y el máximo permitido es ${Math.floor(max / MB)} MB.`,
        { max_bytes: max, size_bytes: size },
      );
    }
    const mime = (input.mimeType ?? '').split(';')[0].trim().toLowerCase();
    const extensions = ALLOWED_MIME_EXTENSIONS[mime];
    if (!extensions) {
      throw new VendixHttpException(
        ErrorCodes.DOCUMENT_TYPE_NOT_ALLOWED,
        `El tipo de archivo "${mime || 'desconocido'}" no está permitido.`,
        { mime_type: mime },
      );
    }
    if (input.accept?.length && !acceptMatches(input.accept, mime)) {
      throw new VendixHttpException(
        ErrorCodes.DOCUMENT_TYPE_NOT_ALLOWED,
        `Este requisito solo acepta: ${input.accept.join(', ')}.`,
        { mime_type: mime, accept: input.accept },
      );
    }
    const name = sanitizeFileName(input.originalName);
    const ext = extensionOf(name);
    if (!extensions.includes(ext) || !bytesMatchMime(input.buffer, mime)) {
      throw new VendixHttpException(ErrorCodes.DOCUMENT_TYPE_MISMATCH);
    }
    return { mime, name, ext };
  }

  /**
   * Validates, uploads the object and inserts the row. When the insert fails
   * the uploaded object is deleted (compensation) and the error is rethrown.
   * `tx` lets the caller keep the row in a larger transaction; in that case it
   * must call `discardObject(row.s3_key)` if a later step fails.
   */
  async upload(input: UploadFileInput, tx?: any): Promise<StoredFileRow> {
    const c = this.ctx();
    const { mime, name, ext } = this.validate(input);
    const sha256 = createHash('sha256').update(input.buffer).digest('hex');
    const [store, organization] = await Promise.all([
      this.prisma.stores.findFirst({
        where: { id: c.store_id, organization_id: c.organization_id },
        select: { id: true, slug: true },
      }),
      this.prisma.organizations.findFirst({
        where: { id: c.organization_id },
        select: { id: true, slug: true },
      }),
    ]);
    if (!store || !organization) {
      throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    }
    const folder = input.folder.replace(/^\/+|\/+$/g, '');
    const key = `${this.paths.buildStorePath(organization, store)}/${folder}/${randomUUID()}.${ext}`;
    await this.s3.uploadFile(input.buffer, key, mime);
    const actor = input.actor ?? { type: 'user' as const, id: c.user_id };
    try {
      return (await (tx ?? this.prisma).stored_files.create({
        data: {
          organization_id: c.organization_id,
          store_id: c.store_id,
          s3_key: key,
          original_name: name,
          mime_type: mime,
          size_bytes: input.buffer.length,
          sha256,
          source: input.source ?? 'upload',
          uploaded_by_type: actor.type,
          uploaded_by_id: actor.id,
        },
      })) as StoredFileRow;
    } catch (e) {
      await this.discardObject(key);
      throw e;
    }
  }

  /** Best-effort delete of an object whose row never committed. */
  async discardObject(key: string): Promise<void> {
    try {
      await this.s3.deleteFile(key);
    } catch (e: any) {
      this.logger.error(`No se pudo borrar el objeto huérfano ${key}: ${e?.message}`);
    }
  }

  /** Compensation for a file whose dossier item never committed: row + object. */
  async discard(file: Pick<StoredFileRow, 'id' | 's3_key'>): Promise<void> {
    try {
      await this.prisma.stored_files.deleteMany({
        where: { id: file.id, store_id: this.ctx().store_id },
      });
    } catch (e: any) {
      this.logger.error(`No se pudo borrar la fila huérfana ${file.id}: ${e?.message}`);
    }
    await this.discardObject(file.s3_key);
  }

  async findOne(fileId: number): Promise<StoredFileRow> {
    const c = this.ctx();
    const row = await this.prisma.stored_files.findFirst({
      where: { id: fileId, store_id: c.store_id, deleted_at: null },
    });
    if (!row) throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    return row as StoredFileRow;
  }

  /** Short-lived signed URL (never persisted) + audit entry of the access. */
  async signedDownloadUrl(fileId: number) {
    const c = this.ctx();
    const file = await this.findOne(fileId);
    const url = await this.s3.getPresignedUrl(file.s3_key, DOWNLOAD_URL_TTL_SECONDS);
    await this.audit.log({
      userId: c.user_id ?? undefined,
      storeId: c.store_id,
      organizationId: c.organization_id,
      action: AuditAction.VIEW,
      resource: 'stored_files',
      resourceId: file.id,
      metadata: { event: 'download_url_issued', sha256: file.sha256 },
    });
    return {
      url,
      expires_in: DOWNLOAD_URL_TTL_SECONDS,
      original_name: file.original_name,
      mime_type: file.mime_type,
      sha256: file.sha256,
    };
  }
}
