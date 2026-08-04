import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { S3Service } from '../../../common/services/s3.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';

/**
 * Same ceiling and same MIME whitelist the native scanners enforce
 * (`purchase-orders.controller.ts`, `expenses.controller.ts`). Kept identical
 * on purpose: a document Vexi accepts must be a document those endpoints
 * accept, or the flow dies after the user already approved the write.
 */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIMETYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);

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
  ) {}

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

    if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
      throw new VendixHttpException(
        ErrorCodes.INV_SCAN_INVALID_FILE,
        `El tipo de archivo "${file.mimetype}" no se puede leer. Acepto fotos (JPG, PNG, WEBP, HEIC) y PDF.`,
      );
    }

    if (file.size > MAX_FILE_BYTES) {
      throw new VendixHttpException(
        ErrorCodes.INV_SCAN_INVALID_FILE,
        `El archivo pesa ${Math.round(file.size / 1024 / 1024)} MB y el máximo son 10 MB. Manda una foto más liviana.`,
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

    const key = `vexi-attachments/stores/${storeId}/${randomUUID()}${this.extensionOf(file)}`;

    await this.s3.uploadFile(file.buffer, key, file.mimetype);

    const row = await this.prisma.ai_attachments.create({
      data: {
        store_id: storeId,
        organization_id: organizationId,
        user_id: userId,
        conversation_id: conversationId ?? null,
        s3_key: key,
        mime_type: file.mimetype,
        size_bytes: file.size,
        original_name: this.safeName(file.originalname),
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

  private extensionOf(file: Express.Multer.File): string {
    if (file.mimetype === 'application/pdf') return '.pdf';
    const match = /^image\/(jpeg|jpg|png|webp|heic|heif)$/.exec(file.mimetype);
    return match ? `.${match[1] === 'jpeg' ? 'jpg' : match[1]}` : '';
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
