import { randomBytes, randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { S3Service } from '@common/services/s3.service';
import { WORKFLOW_LIMITS } from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  ALLOWED_MIME_EXTENSIONS,
  DEFAULT_MAX_FILE_BYTES,
  MB,
} from '../../documents/documents.constants';
import { bytesMatchMime } from '../../documents/file-signature';
import { sanitizeFileName } from '../../documents/stored-files.service';

/** Every part but the last has exactly this size (S3 minimum is 5 MiB). */
export const UPLOAD_CHUNK_BYTES = 5 * MB;
export const UPLOAD_SESSION_TTL_MS = 24 * 3_600_000;
const SWEEP_BATCH = 100;

/** Who owns the session: a public form link or a tracking link. */
export interface UploadScope {
  store_id: number;
  organization_id: number;
  public_link_id?: number;
  tracking_link_id?: number;
  /** Folder under the store prefix of the stored object. */
  folder: string;
  field_key?: string;
  requirement_key?: string;
}

export interface UploadRules {
  accept?: string[];
  max_size_mb?: number;
}

export interface UploadInit {
  file_name: string;
  mime_type: string;
  size_bytes: number;
}

/** A type alias (not an interface) so the list is a Prisma JSON value. */
type StoredPart = {
  n: number;
  etag: string;
  size: number;
};

export interface CompletedUpload {
  upload_id: string;
  file_name: string;
  size_bytes: number;
  stored_file_id: number;
  /** `completed` right after joining the parts; `consumed` when already used. */
  status: 'completed' | 'consumed';
}

function acceptMatches(accept: string[], mime: string): boolean {
  return accept.some((p) =>
    p.endsWith('/*') ? mime.startsWith(p.slice(0, -1)) : p.toLowerCase() === mime,
  );
}

/**
 * First part of the object against its declared type. docx/xlsx only check the
 * ZIP header here: their package folder may sit past the first part.
 */
function headMatchesMime(head: Buffer, mime: string): boolean {
  if (mime.includes('openxmlformats')) {
    return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  }
  return bytesMatchMime(head, mime);
}

/**
 * Chunked upload for public callers (form link and tracking link) over S3
 * multipart. Sessions live in `workflow_upload_sessions`, belong to ONE link of
 * ONE store (anything else is a 404) and expire after 24 h. The final object
 * is hashed by streaming it back from S3 (the API never holds the whole file).
 * Type checks: declared MIME and extension against the allowed list and the
 * field/requirement `accept`, plus the magic bytes of the first part (text is
 * only scanned in that first part).
 */
@Injectable()
export class WorkflowPublicUploadsService {
  private readonly logger = new Logger(WorkflowPublicUploadsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3: S3Service,
    private readonly paths: S3PathHelper,
  ) {}

  private owner(scope: UploadScope) {
    return scope.public_link_id
      ? { public_link_id: scope.public_link_id }
      : { tracking_link_id: scope.tracking_link_id ?? -1 };
  }

  async init(scope: UploadScope, rules: UploadRules, input: UploadInit) {
    const mime = (input.mime_type ?? '').split(';')[0].trim().toLowerCase();
    const extensions = ALLOWED_MIME_EXTENSIONS[mime];
    if (!extensions) {
      throw new VendixHttpException(
        ErrorCodes.DOCUMENT_TYPE_NOT_ALLOWED,
        `El tipo de archivo "${mime || 'desconocido'}" no está permitido.`,
        { mime_type: mime },
      );
    }
    if (rules.accept?.length && !acceptMatches(rules.accept, mime)) {
      throw new VendixHttpException(
        ErrorCodes.DOCUMENT_TYPE_NOT_ALLOWED,
        `Este campo solo acepta: ${rules.accept.join(', ')}.`,
        { mime_type: mime, accept: rules.accept },
      );
    }
    const name = sanitizeFileName(input.file_name);
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
    if (!extensions.includes(ext)) {
      throw new VendixHttpException(ErrorCodes.DOCUMENT_TYPE_MISMATCH);
    }
    const maxBytes =
      Math.min(
        rules.max_size_mb ? rules.max_size_mb * MB : DEFAULT_MAX_FILE_BYTES,
        WORKFLOW_LIMITS.maxFileSizeMb * MB,
      );
    if (!Number.isInteger(input.size_bytes) || input.size_bytes < 1) {
      throw new VendixHttpException(ErrorCodes.DOCUMENT_FILE_REQUIRED);
    }
    if (input.size_bytes > maxBytes) {
      throw new VendixHttpException(
        ErrorCodes.DOCUMENT_TOO_LARGE,
        `El archivo pesa ${(input.size_bytes / MB).toFixed(1)} MB y el máximo permitido es ${Math.floor(maxBytes / MB)} MB.`,
        { max_bytes: maxBytes, size_bytes: input.size_bytes },
      );
    }

    const db = this.prisma.withoutScope();
    const [store, organization] = await Promise.all([
      db.stores.findFirst({ where: { id: scope.store_id }, select: { id: true, slug: true } }),
      db.organizations.findFirst({
        where: { id: scope.organization_id },
        select: { id: true, slug: true },
      }),
    ]);
    if (!store || !organization) throw new VendixHttpException(ErrorCodes.WORKFLOW_UPLOAD_NOT_FOUND);
    const folder = scope.folder.replace(/^\/+|\/+$/g, '');
    const key = `${this.paths.buildStorePath(organization, store)}/${folder}/${randomUUID()}.${ext}`;
    const s3UploadId = await this.s3.createMultipartUpload(key, mime);
    const publicId = randomBytes(18).toString('base64url');
    try {
      await db.workflow_upload_sessions.create({
        data: {
          organization_id: scope.organization_id,
          store_id: scope.store_id,
          public_id: publicId,
          public_link_id: scope.public_link_id ?? null,
          tracking_link_id: scope.tracking_link_id ?? null,
          field_key: scope.field_key ?? null,
          requirement_key: scope.requirement_key ?? null,
          s3_key: key,
          s3_upload_id: s3UploadId,
          original_name: name,
          mime_type: mime,
          size_bytes: input.size_bytes,
          chunk_size: UPLOAD_CHUNK_BYTES,
          parts: [],
          status: 'open',
          expires_at: new Date(Date.now() + UPLOAD_SESSION_TTL_MS),
        },
      });
    } catch (e) {
      await this.s3.abortMultipartUpload(key, s3UploadId);
      throw e;
    }
    return {
      upload_id: publicId,
      chunk_size: UPLOAD_CHUNK_BYTES,
      total_parts: Math.ceil(input.size_bytes / UPLOAD_CHUNK_BYTES),
    };
  }

  /** Uploads part `n` (1-based). Sequential calls per session are expected. */
  async putPart(scope: UploadScope, uploadId: string, n: number, body: Buffer) {
    const session = await this.openSession(scope, uploadId);
    const total = Math.ceil(session.size_bytes / session.chunk_size);
    if (!Number.isInteger(n) || n < 1 || n > total) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_UPLOAD_INVALID, 'El número de parte no es válido.');
    }
    const expected =
      n < total ? session.chunk_size : session.size_bytes - (total - 1) * session.chunk_size;
    if (body.length !== expected) {
      throw new VendixHttpException(
        ErrorCodes.WORKFLOW_UPLOAD_INVALID,
        `La parte ${n} debe pesar ${expected} bytes.`,
        { expected_bytes: expected, received_bytes: body.length },
      );
    }
    if (n === 1 && !headMatchesMime(body, session.mime_type)) {
      await this.abort(session);
      throw new VendixHttpException(ErrorCodes.DOCUMENT_TYPE_MISMATCH);
    }
    const etag = await this.s3.uploadMultipartPart(session.s3_key, session.s3_upload_id, n, body);
    const parts = (session.parts as unknown as StoredPart[]).filter((p) => p.n !== n);
    parts.push({ n, etag, size: body.length });
    await this.prisma.withoutScope().workflow_upload_sessions.updateMany({
      where: { id: session.id, store_id: scope.store_id, status: 'open' },
      data: { parts: parts.sort((a, b) => a.n - b.n) },
    });
    return { upload_id: uploadId, part: n, received_parts: parts.length, total_parts: total };
  }

  /** Joins the parts, verifies the size, hashes the object and stores the row. */
  async complete(scope: UploadScope, uploadId: string): Promise<CompletedUpload> {
    const db = this.prisma.withoutScope();
    const found = await this.find(scope, uploadId);
    if (found.status === 'completed' || found.status === 'consumed') {
      return this.completedView(found);
    }
    const session = await this.openSession(scope, uploadId);
    const total = Math.ceil(session.size_bytes / session.chunk_size);
    const parts = session.parts as unknown as StoredPart[];
    const have = new Set(parts.map((p) => p.n));
    for (let n = 1; n <= total; n++) {
      if (!have.has(n)) {
        throw new VendixHttpException(
          ErrorCodes.WORKFLOW_UPLOAD_INVALID,
          `Falta la parte ${n} de ${total}.`,
          { missing_part: n },
        );
      }
    }
    await this.s3.completeMultipartUpload(
      session.s3_key,
      session.s3_upload_id,
      parts.map((p) => ({ partNumber: p.n, etag: p.etag })),
    );
    const { sha256, size } = await this.s3.hashObject(session.s3_key);
    if (size !== session.size_bytes) {
      await this.s3.deleteFile(session.s3_key).catch(() => undefined);
      await db.workflow_upload_sessions.updateMany({
        where: { id: session.id, store_id: scope.store_id },
        data: { status: 'aborted' },
      });
      throw new VendixHttpException(
        ErrorCodes.WORKFLOW_UPLOAD_INVALID,
        'El tamaño del archivo recibido no coincide con el declarado.',
        { declared_bytes: session.size_bytes, received_bytes: size },
      );
    }
    let file: { id: number };
    try {
      file = await db.stored_files.create({
        data: {
          organization_id: session.organization_id,
          store_id: session.store_id,
          s3_key: session.s3_key,
          original_name: session.original_name,
          mime_type: session.mime_type,
          size_bytes: size,
          sha256,
          source: 'public_form',
          uploaded_by_type: 'public',
          uploaded_by_id: null,
        },
        select: { id: true },
      });
    } catch (e) {
      await this.s3.deleteFile(session.s3_key).catch(() => undefined);
      throw e;
    }
    await db.workflow_upload_sessions.updateMany({
      where: { id: session.id, store_id: scope.store_id },
      data: { status: 'completed', stored_file_id: file.id },
    });
    return {
      upload_id: uploadId,
      file_name: session.original_name,
      size_bytes: size,
      stored_file_id: file.id,
      status: 'completed',
    };
  }

  /**
   * Completed sessions of this owner for the given ids, validated against the
   * field they were opened for. Anything else (unknown, foreign, still open,
   * expired, another field) is a 422 naming the field.
   */
  async completedForField(
    scope: UploadScope,
    fieldKey: string,
    uploadId: string,
    allowConsumed = false,
  ) {
    const session = await this.find(scope, uploadId).catch(() => null);
    const usable =
      !!session &&
      session.field_key === fieldKey &&
      !!session.stored_file_id &&
      ((session.status === 'completed' && new Date(session.expires_at).getTime() > Date.now()) ||
        (allowConsumed && session.status === 'consumed'));
    if (!session || !usable) {
      throw new VendixHttpException(
        ErrorCodes.WORKFLOW_UPLOAD_INVALID,
        'El archivo del campo no se subió completo o ya se usó. Súbelo de nuevo.',
        { field: fieldKey },
      );
    }
    return session;
  }

  /** Marks the session consumed; false when it was not `completed` anymore. */
  async consume(scope: UploadScope, uploadId: string): Promise<boolean> {
    const res = await this.prisma.withoutScope().workflow_upload_sessions.updateMany({
      where: {
        public_id: uploadId,
        store_id: scope.store_id,
        ...this.owner(scope),
        status: 'completed',
      },
      data: { status: 'consumed' },
    });
    return res.count === 1;
  }

  /** Cron: aborts the multipart of open sessions that expired. */
  async sweepExpired(now = new Date()): Promise<number> {
    const db = this.prisma.withoutScope();
    const rows = await db.workflow_upload_sessions.findMany({
      where: { status: 'open', expires_at: { lte: now } },
      take: SWEEP_BATCH,
      orderBy: { id: 'asc' },
    });
    for (const row of rows) {
      if (row.s3_upload_id) await this.s3.abortMultipartUpload(row.s3_key, row.s3_upload_id);
      await db.workflow_upload_sessions.updateMany({
        where: { id: row.id, store_id: row.store_id, status: 'open' },
        data: { status: 'aborted' },
      });
    }
    if (rows.length > 0) this.logger.log(`Aborted ${rows.length} expired upload session(s)`);
    return rows.length;
  }

  private async find(scope: UploadScope, uploadId: string) {
    const session =
      typeof uploadId === 'string' && uploadId.length >= 10 && uploadId.length <= 40
        ? await this.prisma.withoutScope().workflow_upload_sessions.findFirst({
            where: {
              public_id: uploadId,
              store_id: scope.store_id,
              ...this.owner(scope),
              ...(scope.requirement_key ? { requirement_key: scope.requirement_key } : {}),
            },
          })
        : null;
    if (!session) throw new VendixHttpException(ErrorCodes.WORKFLOW_UPLOAD_NOT_FOUND);
    return session;
  }

  private async openSession(scope: UploadScope, uploadId: string) {
    const session = await this.find(scope, uploadId);
    if (
      session.status !== 'open' ||
      !session.s3_upload_id ||
      new Date(session.expires_at).getTime() <= Date.now()
    ) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_UPLOAD_NOT_FOUND);
    }
    return session as typeof session & { s3_upload_id: string };
  }

  private async abort(session: { id: number; store_id: number; s3_key: string; s3_upload_id: string | null }) {
    if (session.s3_upload_id) await this.s3.abortMultipartUpload(session.s3_key, session.s3_upload_id);
    await this.prisma.withoutScope().workflow_upload_sessions.updateMany({
      where: { id: session.id, store_id: session.store_id },
      data: { status: 'aborted' },
    });
  }

  private completedView(session: {
    public_id: string;
    original_name: string;
    size_bytes: number;
    stored_file_id: number | null;
    status: string;
  }): CompletedUpload {
    return {
      upload_id: session.public_id,
      file_name: session.original_name,
      size_bytes: session.size_bytes,
      stored_file_id: session.stored_file_id as number,
      status: session.status === 'consumed' ? 'consumed' : 'completed',
    };
  }
}
