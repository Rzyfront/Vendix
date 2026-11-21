import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { S3Service } from '../../../common/services/s3.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { S3PathHelper } from '../../../common/helpers/s3-path.helper';
import { bytesMatchMime } from '../documents/file-signature';
import {
  AI_ATTACHMENT_LABEL,
  AI_ATTACHMENT_MAX_BYTES,
  resolveAttachmentType,
} from './ai-attachments';
import type { AttachmentContent } from './attachment-content.types';
import { extractAttachmentContent } from './attachment-text-extractor';

const HANDLE_PREFIX = 'att_';

export interface StoredAttachment {
  attachment_id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
}

export interface AttachmentPayload {
  buffer: Buffer;
  mime_type: string;
  original_name: string;
  record: { id: number; s3_key: string };
}

/**
 * The document channel between the person and Vexi's vision tools.
 *
 * Two things make this more than an upload helper:
 *
 *  1. **The model never holds the bytes.** It receives an opaque handle
 *     (`att_41`) and passes it to a tool; the tool resolves the handle here and
 *     runs the document through the specialised vision application. Nothing
 *     binary ever enters the orchestrating conversation, which is what keeps the
 *     context window and the cost bounded no matter how many pages are scanned.
 *  2. **The attachment ends up owned by the record it created.** `linkTo()` is
 *     called after a write applies, so the question "which invoice produced this
 *     purchase order" has an answer. Without it the file would be an orphan in a
 *     bucket and the agent would be unauditable.
 *
 * Reads go through `StorePrismaService`, so a handle from another tenant simply
 * does not resolve — the isolation is the scoped delegate, not a check written
 * here that a later refactor could drop.
 */
@Injectable()
export class VexiAttachmentsService {
  private readonly logger = new Logger(VexiAttachmentsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3: S3Service,
    // Plain class without dependencies; the fallback keeps this service
    // constructible by hand without registering a provider in AIEngineModule.
    @Optional() paths?: S3PathHelper,
  ) {
    this.paths = paths ?? new S3PathHelper();
  }

  private readonly paths: S3PathHelper;

  /**
   * Validates, uploads and registers a document.
   *
   * Validation happens here rather than in the controller so the realtime and
   * queue paths cannot skip it by calling the service directly.
   */
  async store(
    file: Express.Multer.File,
    conversationId?: number,
  ): Promise<StoredAttachment> {
    if (!file?.buffer?.length) {
      throw new VendixHttpException(ErrorCodes.INV_SCAN_NO_FILE);
    }

    const type = resolveAttachmentType(file.mimetype, file.originalname);
    if (!type) {
      throw new VendixHttpException(
        ErrorCodes.INV_SCAN_INVALID_FILE,
        `El tipo de archivo "${file.mimetype || file.originalname}" no se puede leer. Acepto: ${AI_ATTACHMENT_LABEL}.`,
      );
    }

    const size = file.size ?? file.buffer.length;
    if (size > AI_ATTACHMENT_MAX_BYTES) {
      throw new VendixHttpException(
        ErrorCodes.INV_SCAN_INVALID_FILE,
        `El archivo pesa ${Math.round(size / 1024 / 1024)} MB y el máximo son ${AI_ATTACHMENT_MAX_BYTES / 1024 / 1024} MB. Acepto: ${AI_ATTACHMENT_LABEL}.`,
      );
    }

    if (!bytesMatchMime(file.buffer, type.mime)) {
      throw new VendixHttpException(
        ErrorCodes.INV_SCAN_INVALID_FILE,
        `El contenido de "${this.safeName(file.originalname)}" no coincide con su extensión. Acepto: ${AI_ATTACHMENT_LABEL}.`,
      );
    }

    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    const organizationId = context?.organization_id;
    const userId = context?.user_id;

    if (!storeId || !organizationId || !userId) {
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_004,
        'No hay contexto de tienda para guardar el documento.',
      );
    }

    const [store, organization] = await Promise.all([
      this.prisma.stores.findFirst({
        where: { id: storeId, organization_id: organizationId },
        select: { id: true, slug: true },
      }),
      this.prisma.organizations.findFirst({
        where: { id: organizationId },
        select: { id: true, slug: true },
      }),
    ]);
    if (!store || !organization) {
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_004,
        'No hay contexto de tienda para guardar el documento.',
      );
    }

    const basePath = `${this.paths.buildStorePath(organization, store)}/ai-attachments`;
    const id = randomUUID();
    const key = `${basePath}/${id}.${type.extensions[0]}`;

    await this.s3.uploadFile(file.buffer, key, type.mime);

    const originalName = this.safeName(file.originalname);
    const derivedKey = await this.storeDerived(
      `${basePath}/derived/${id}.json`,
      file.buffer,
      type.mime,
      originalName,
    );

    const row = await this.prisma.ai_attachments.create({
      data: {
        store_id: storeId,
        organization_id: organizationId,
        user_id: userId,
        conversation_id: conversationId ?? null,
        s3_key: key,
        mime_type: type.mime,
        size_bytes: size,
        original_name: originalName,
        derived_text_key: derivedKey,
      },
      select: {
        id: true,
        original_name: true,
        mime_type: true,
        size_bytes: true,
      },
    });

    this.logger.log(
      `Stored Vexi attachment ${HANDLE_PREFIX}${row.id} (${row.mime_type}, ${row.size_bytes} bytes) for store ${storeId}`,
    );

    return {
      attachment_id: `${HANDLE_PREFIX}${row.id}`,
      original_name: row.original_name,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
    };
  }

  /**
   * Extracted content of a document (table / text / image marker), for the
   * `read_attachment` tool. Uses the derived JSON when present; legacy rows
   * (uploaded before T41) are extracted on the fly and nothing is written.
   */
  async readContent(handle: string): Promise<AttachmentContent> {
    const record = await this.requireRecord(handle);
    if (record.derived_text_key) {
      try {
        const raw = await this.s3.downloadFile(record.derived_text_key);
        return JSON.parse(raw.toString('utf8')) as AttachmentContent;
      } catch (error) {
        this.logger.warn(
          `Derived content of ${handle} unreadable, extracting from the original: ${(error as Error)?.message}`,
        );
      }
    }
    const buffer = await this.s3.downloadFile(record.s3_key);
    return extractAttachmentContent(
      buffer,
      record.mime_type,
      record.original_name,
    );
  }

  /** The bytes behind a handle, for a vision tool or a multipart forward. */
  async read(handle: string): Promise<AttachmentPayload> {
    const record = await this.requireRecord(handle);
    const buffer = await this.s3.downloadFile(record.s3_key);

    return {
      buffer,
      mime_type: record.mime_type,
      original_name: record.original_name,
      record: { id: record.id, s3_key: record.s3_key },
    };
  }

  /**
   * The document as a `data:` URI, the shape every vision application in this
   * codebase already expects (`invoice-scanner.service.ts:70`).
   */
  async dataUri(handle: string): Promise<{
    dataUri: string;
    mimeType: string;
    originalName: string;
    id: number;
  }> {
    const payload = await this.read(handle);

    return {
      dataUri: `data:${payload.mime_type};base64,${payload.buffer.toString('base64')}`,
      mimeType: payload.mime_type,
      originalName: payload.original_name,
      id: payload.record.id,
    };
  }

  /**
   * Records which business record the document ended up justifying.
   *
   * Never throws: the write it describes already applied, so failing here would
   * turn a successful operation into an error the user cannot act on. A missing
   * link is a gap in the audit trail, logged as such.
   */
  async linkTo(
    handle: string,
    entityType: string,
    entityId: number | null,
  ): Promise<void> {
    const id = this.parseHandle(handle);
    if (!id) return;

    try {
      await this.prisma.ai_attachments.updateMany({
        where: { id },
        data: {
          linked_entity_type: entityType,
          linked_entity_id: entityId,
          linked_at: new Date(),
        },
      });
    } catch (error: any) {
      this.logger.warn(
        `Could not link attachment ${handle} to ${entityType}:${entityId} — ${error?.message}`,
      );
    }
  }

  /** Stamps which vision application consumed the document, for cost forensics. */
  async markConsumed(handle: string, appKey: string): Promise<void> {
    const id = this.parseHandle(handle);
    if (!id) return;

    try {
      await this.prisma.ai_attachments.updateMany({
        where: { id },
        data: { consumed_by_app_key: appKey },
      });
    } catch {
      // Telemetry only — never fail a scan over it.
    }
  }

  /**
   * The stored key, for a domain whose document contract is a text field.
   *
   * Most modules take their document as `multipart/form-data`, but a few persist a
   * key in a column instead — an expense keeps its receipt in `receipt_url`, and
   * `expense-scanner-modal.component.ts:913` fills it with the S3 key, not a signed
   * URL. Vexi has to write the same value those modules write, or the receipt shows
   * up on the record as a link that expires in fifteen minutes.
   *
   * Reads only the row, without pulling the object down from S3 — `read()` would
   * download megabytes to hand back a string.
   */
  async storageKey(
    handle: string,
  ): Promise<{ s3_key: string; original_name: string }> {
    const record = await this.requireRecord(handle);
    return { s3_key: record.s3_key, original_name: record.original_name };
  }

  /** Short-lived link so the panel can show the document back to the user. */
  async signedUrl(handle: string, expiresIn = 900): Promise<string> {
    const record = await this.requireRecord(handle);
    return this.s3.getPresignedUrl(record.s3_key, expiresIn);
  }

  /**
   * Metadata for the handles a turn declared, to render into the prompt.
   *
   * Silently drops handles that do not resolve instead of failing the turn: the
   * client controls this list, and a stale id must not cost the user their
   * message.
   */
  async describeMany(handles: string[]): Promise<
    Array<{
      attachment_id: string;
      original_name: string;
      mime_type: string;
      size_bytes: number;
      linked_entity_type: string | null;
    }>
  > {
    const ids = handles
      .map((handle) => this.parseHandle(handle))
      .filter((id): id is number => id !== null);

    if (!ids.length) return [];

    const rows = await this.prisma.ai_attachments.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        original_name: true,
        mime_type: true,
        size_bytes: true,
        linked_entity_type: true,
      },
      orderBy: { id: 'asc' },
    });

    return rows.map((row) => ({
      attachment_id: `${HANDLE_PREFIX}${row.id}`,
      original_name: row.original_name,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      linked_entity_type: row.linked_entity_type,
    }));
  }

  /**
   * Adjuntos recientes para `list_attachments` (conversación y/o usuario
   * opcionales, 10 últimos). Mudada desde la tool en el paso 15: la tool ya
   * inyectaba este servicio, así que el cableado no cambia. Lectura pura,
   * scopeada por tienda.
   */
  async listRecentAttachments(params: {
    conversationId?: number | null;
    userId?: number | null;
    take?: number;
  }): Promise<any[]> {
    return this.prisma.ai_attachments.findMany({
      where: {
        ...(params.conversationId
          ? { conversation_id: params.conversationId }
          : {}),
        ...(params.userId ? { user_id: params.userId } : {}),
      },
      select: {
        id: true,
        original_name: true,
        mime_type: true,
        created_at: true,
        linked_entity_type: true,
        linked_entity_id: true,
      },
      orderBy: { id: 'desc' },
      take: params.take ?? 10,
    });
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private async requireRecord(handle: string) {
    const id = this.parseHandle(handle);

    if (!id) {
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_003,
        `"${handle}" no es un documento válido de esta conversación.`,
      );
    }

    const record = await this.prisma.ai_attachments.findFirst({
      where: { id },
      select: {
        id: true,
        s3_key: true,
        mime_type: true,
        original_name: true,
        derived_text_key: true,
      },
    });

    if (!record) {
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_003,
        'Ese documento ya no está disponible. Pídele a la persona que lo vuelva a adjuntar.',
      );
    }

    return record;
  }

  /**
   * Accepts both `att_41` and a bare `41`.
   *
   * The handle is prefixed so the model cannot confuse a document with a
   * business id, but weaker models drop the prefix; rejecting those would cost a
   * turn for a difference that carries no information.
   */
  private parseHandle(handle: string): number | null {
    const raw = String(handle ?? '').trim();
    const digits = raw.startsWith(HANDLE_PREFIX)
      ? raw.slice(HANDLE_PREFIX.length)
      : raw;

    if (!/^\d+$/.test(digits)) return null;

    const id = Number(digits);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  /**
   * Extracts and uploads the derived JSON next to the original. Never throws:
   * a failed extraction or upload leaves `derived_text_key` null and the
   * original untouched (readContent extracts on the fly).
   */
  private async storeDerived(
    key: string,
    buffer: Buffer,
    mime: string,
    originalName: string,
  ): Promise<string | null> {
    try {
      const content = await extractAttachmentContent(buffer, mime, originalName);
      await this.s3.uploadFile(
        Buffer.from(JSON.stringify(content), 'utf8'),
        key,
        'application/json',
      );
      return key;
    } catch (error) {
      this.logger.warn(
        `Derived content not stored for ${originalName}: ${(error as Error)?.message}`,
      );
      return null;
    }
  }

  /** Keeps the name recognisable to the user without letting it shape a path. */
  private safeName(originalName?: string): string {
    const base = (originalName ?? 'documento')
      .replace(/[/\\]/g, '_')
      .replace(/[^\w.\- áéíóúñÁÉÍÓÚÑ]/g, '')
      .trim();

    return (base || 'documento').slice(0, 255);
  }
}
