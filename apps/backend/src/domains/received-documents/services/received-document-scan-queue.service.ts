import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { RequestContextService } from '../../../common/context/request-context.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { SubscriptionAccessService } from '../../store/subscriptions/services/subscription-access.service';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';
import { ReceivedDocumentScanExtraction } from '../interfaces/received-document-scan.interface';
import {
  ReceivedDocumentScanJob,
  ReceivedDocumentScanJobStatus,
  ReceivedDocumentScanResult,
} from '../interfaces/received-document-scan-job.interface';
import { ReceivedDocumentScanService } from './received-document-scan.service';

const QUEUE_NAME = 'received-document-scan';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const MAX_EVENT_JSON_BYTES = 2 * 1024 * 1024;

@Injectable()
export class ReceivedDocumentScanQueueService {
  constructor(
    @InjectQueue(QUEUE_NAME) private readonly queue: Queue<ReceivedDocumentScanJob>,
    private readonly documents: ReceivedDocumentsService,
    private readonly scanner: ReceivedDocumentScanService,
    private readonly prisma: GlobalPrismaService,
    private readonly subscriptionAccess: SubscriptionAccessService,
  ) {}

  async enqueue(
    ctx: ReceivedDocumentsContext,
    file: Express.Multer.File,
  ): Promise<{ document_id: number; job_id: string | null; already_processed: boolean }> {
    this.assertContext(ctx);
    this.assertSourceFile(file);

    const document = await this.documents.createPendingFile(ctx, file, 'manual');
    if (this.isAlreadyProcessed(document)) {
      return { document_id: document.id, job_id: null, already_processed: true };
    }

    try {
      // OCR is billed to the operational store even for organization fiscal scope.
      const access = await this.subscriptionAccess.canUseAIFeature(ctx.store_id!, 'async_queue');
      if (access.mode === 'block') {
        const key = access.reason as keyof typeof ErrorCodes;
        const entry = ErrorCodes[key] ?? ErrorCodes.SUBSCRIPTION_005;
        throw new VendixHttpException(entry, undefined, {
          subscription_state: access.subscription_state,
          plan_id: access.plan_id ?? null,
          has_record: access.has_record,
        });
      }
      await this.scanner.assertConfigured();
    } catch (error) {
      await this.markQueueFailure(ctx, document.id, document.version, 'SCAN_NOT_AVAILABLE');
      throw error;
    }

    const original = document.files?.find((candidate: any) => candidate.role === 'original') ?? document.files?.[0];
    if (!original?.id) {
      await this.markQueueFailure(ctx, document.id, document.version, 'ORIGINAL_FILE_MISSING');
      throw new ServiceUnavailableException('No se pudo preparar el documento para su lectura. Intenta nuevamente.');
    }
    const jobId = this.jobId(ctx, document.id, document.version);
    const data: ReceivedDocumentScanJob = {
      document_id: document.id,
      file_id: original.id,
      context: {
        organization_id: ctx.organization_id,
        accounting_entity_id: ctx.accounting_entity_id,
        store_id: ctx.store_id,
        actor_id: ctx.actor_id,
        is_organization: ctx.is_organization,
        request_id: this.requestId(ctx, document.id, document.version),
      },
    };

    try {
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === 'completed') {
          return { document_id: document.id, job_id: String(existing.id), already_processed: true };
        }
        if (state === 'failed') {
          await existing.retry();
        }
        return { document_id: document.id, job_id: String(existing.id), already_processed: false };
      }
      const job = await this.queue.add('scan', data, {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      });
      return { document_id: document.id, job_id: String(job.id), already_processed: false };
    } catch {
      await this.markQueueFailure(ctx, document.id, document.version, 'SCAN_QUEUE_FAILED');
      throw new ServiceUnavailableException('No se pudo iniciar la lectura del documento. Intenta nuevamente.');
    }
  }

  async getStatus(ctx: ReceivedDocumentsContext, jobId: string): Promise<ReceivedDocumentScanJobStatus> {
    this.assertContext(ctx, false);
    if (typeof jobId !== 'string' || !jobId.trim() || jobId.length > 150) {
      throw new NotFoundException('Trabajo de lectura no encontrado.');
    }
    const job = await this.queue.getJob(jobId);
    const captured = job?.data?.context;
    if (
      !job ||
      captured?.organization_id !== ctx.organization_id ||
      captured?.accounting_entity_id !== ctx.accounting_entity_id ||
      (ctx.store_id != null && captured?.store_id !== ctx.store_id)
    ) {
      throw new NotFoundException('Trabajo de lectura no encontrado.');
    }

    // Validate active tenant/entity/store against current authorization state before reading Redis result.
    await this.documents.findOne(ctx, job.data.document_id);
    const state = await job.getState();
    if (state === 'completed') {
      const result = this.safeResult(job.returnvalue);
      if (result.document_id !== job.data.document_id) await this.documents.findOne(ctx, result.document_id);
      return { status: 'completed', result };
    }
    if (state === 'failed') {
      const failed = await this.prisma.received_document_events.findFirst({
        where: { document_id: job.data.document_id, event_type: 'SCAN_FAILED' },
        orderBy: { created_at: 'desc' },
        select: { result: true },
      });
      const code = this.safeErrorCode((failed?.result as Record<string, unknown> | null)?.['error_code']);
      return { status: 'failed', error: 'No se pudo leer el documento. Puedes reintentar.', ...(code ? { error_code: code } : {}) };
    }
    if (state === 'active' || state === 'delayed') return { status: state };
    return { status: 'waiting' };
  }

  /** Called only by the BullMQ processor; job context is re-established in isolation. */
  async process(data: ReceivedDocumentScanJob): Promise<ReceivedDocumentScanResult> {
    const ctx = data?.context;
    this.assertContext(ctx);
    if (!Number.isSafeInteger(data.document_id) || data.document_id <= 0 || !Number.isSafeInteger(data.file_id) || data.file_id <= 0) {
      throw new BadRequestException('Trabajo de lectura no válido.');
    }

    const isolated = {
      is_super_admin: false,
      is_owner: false,
      organization_id: ctx.organization_id,
      store_id: ctx.store_id!,
      user_id: ctx.actor_id,
      request_id: data.context.request_id,
    };
    return RequestContextService.runIsolated(isolated, async () => {
      let version: number | null = null;
      try {
        const document = await this.documents.findOne(ctx, data.document_id);
        if (this.isAlreadyProcessed(document)) return this.resultFromDocument(document);
        if (document.review_status !== 'pending' || document.fiscal_status !== 'pending' || document.posting_status !== 'pending') {
          throw new ConflictException('El documento ya fue revisado y no puede ser modificado por OCR.');
        }
        version = document.version;
        const fileMeta = document.files?.find((candidate: any) => candidate.id === data.file_id);
        if (!fileMeta || fileMeta.role !== 'original') throw new NotFoundException('Archivo original no encontrado.');
        const claimed = await this.prisma.received_documents.updateMany({
          where: {
            id: data.document_id,
            organization_id: ctx.organization_id,
            accounting_entity_id: ctx.accounting_entity_id,
            ...(ctx.store_id != null ? { store_id: ctx.store_id } : {}),
            version,
            validation_status: 'pending',
            review_status: 'pending',
            processing_status: { in: ['pending_ocr', 'processing', 'error'] },
          },
          data: { processing_status: 'processing' },
        });
        if (claimed.count !== 1) {
          const refreshed = await this.documents.findOne(ctx, data.document_id);
          if (this.isAlreadyProcessed(refreshed)) return this.resultFromDocument(refreshed);
          throw new ConflictException('El documento cambió durante la lectura.');
        }

        const bytes = await this.documents.getFile(ctx, data.document_id, data.file_id);
        if (bytes.length !== fileMeta.file_size || this.sha256(bytes) !== fileMeta.sha256) {
          throw new ConflictException('El archivo original no coincide con su evidencia registrada.');
        }
        const sourceHash = this.sha256(bytes);
        const cached = await this.prisma.received_document_events.findUnique({
          where: { document_id_idempotency_key: { document_id: data.document_id, idempotency_key: `ai-extraction:${version}` } },
          select: { status: true, result: true },
        });
        let extraction: ReceivedDocumentScanExtraction;
        if (cached?.status === 'completed') {
          if ((cached.result as Record<string, unknown> | null)?.['source_hash'] !== sourceHash) {
            throw new ConflictException('La extracción guardada corresponde a otra evidencia original.');
          }
          extraction = this.extractionFromEvent(cached.result);
        } else {
          await this.assertWorkerAIAccess(ctx);
          const sourceFile = {
            buffer: bytes,
            originalname: fileMeta.file_name,
            mimetype: fileMeta.mime_type,
            size: bytes.length,
          } as Express.Multer.File;
          const extracted = await this.scanner.extract(sourceFile);
          extraction = await this.persistExtractionWinner(ctx, data.document_id, version, sourceHash, extracted);
        }

        const updated = await this.documents.replaceFromExtraction(ctx, data.document_id, extraction.normalized);
        return {
          document_id: updated.id,
          version: updated.version,
          validation_status: updated.validation_status,
          review_required: true,
          page_count: extraction.page_count,
        };
      } catch (error) {
        if (version !== null) {
          await this.prisma.received_documents.updateMany({
            where: {
              id: data.document_id,
              organization_id: ctx.organization_id,
              accounting_entity_id: ctx.accounting_entity_id,
              ...(ctx.store_id != null ? { store_id: ctx.store_id } : {}),
              version,
              processing_status: 'processing',
              validation_status: 'pending',
              review_status: 'pending',
            },
            data: { processing_status: 'error' },
          }).catch(() => undefined);
          const code = error instanceof VendixHttpException ? this.safeErrorCode(error.errorCode) : undefined;
          await this.prisma.received_document_events.upsert({
            where: { document_id_idempotency_key: { document_id: data.document_id, idempotency_key: `scan-failure:${version}` } },
            create: {
              document_id: data.document_id,
              event_type: 'SCAN_FAILED',
              idempotency_key: `scan-failure:${version}`,
              status: 'retryable',
              actor_id: ctx.actor_id ?? null,
              result: { code: 'SCAN_PROCESS_FAILED', ...(code ? { error_code: code } : {}) },
            },
            update: { status: 'retryable', result: { code: 'SCAN_PROCESS_FAILED', ...(code ? { error_code: code } : {}) } },
          }).catch(() => undefined);
        }
        // Do not put provider/storage internals in failedReason or HTTP responses.
        if (error instanceof VendixHttpException && this.safeErrorCode(error.errorCode)) throw error;
        if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
        throw new ServiceUnavailableException('No se pudo leer el documento. Puedes reintentar.');
      }
    });
  }

  private async markQueueFailure(ctx: ReceivedDocumentsContext, id: number, version: number, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.received_documents.updateMany({
        where: {
          id,
          organization_id: ctx.organization_id,
          accounting_entity_id: ctx.accounting_entity_id,
          ...(ctx.store_id != null ? { store_id: ctx.store_id } : {}),
          version,
          validation_status: 'pending',
          review_status: 'pending',
          processing_status: { in: ['pending_ocr', 'processing', 'error'] },
        },
        data: { processing_status: 'error' },
      });
      await tx.received_document_events.upsert({
        where: { document_id_idempotency_key: { document_id: id, idempotency_key: `scan-queue-failed:${version}` } },
        create: {
          document_id: id,
          event_type: 'SCAN_QUEUE_FAILED',
          idempotency_key: `scan-queue-failed:${version}`,
          status: 'retryable',
          actor_id: ctx.actor_id ?? null,
          result: { code: reason },
        },
        update: { status: 'retryable', result: { code: reason } },
      });
    }).catch(() => undefined);
  }

  private assertContext(ctx: ReceivedDocumentsContext, requireStore = true): void {
    if (
      !ctx || !Number.isSafeInteger(ctx.organization_id) || ctx.organization_id <= 0 ||
      !Number.isSafeInteger(ctx.accounting_entity_id) || ctx.accounting_entity_id <= 0 ||
      (requireStore && (!Number.isSafeInteger(ctx.store_id) || (ctx.store_id ?? 0) <= 0)) ||
      (ctx.store_id != null && (!Number.isSafeInteger(ctx.store_id) || ctx.store_id <= 0))
    ) throw new BadRequestException('El contexto de recepción no es válido.');
  }

  private assertSourceFile(file: Express.Multer.File): void {
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length < 1 || file.buffer.length > MAX_FILE_BYTES || file.size !== file.buffer.length) {
      throw new BadRequestException('El archivo debe tener entre 1 byte y 10 MiB.');
    }
    if (!ALLOWED_MIME_TYPES.has(String(file.mimetype).toLowerCase())) throw new BadRequestException('El tipo de archivo no está permitido para lectura automática.');
    const b = file.buffer;
    const mime = file.mimetype.toLowerCase();
    const valid = mime === 'application/pdf'
      ? b.subarray(0, 5).toString('ascii') === '%PDF-'
      : mime === 'image/png'
        ? b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mime === 'image/jpeg'
          ? b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
          : b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!valid) throw new BadRequestException('El contenido del archivo no coincide con su tipo declarado.');
  }

  private isAlreadyProcessed(document: any): boolean {
    const metadata = document?.metadata && typeof document.metadata === 'object' ? document.metadata : {};
    return document?.processing_status === 'ready' ||
      document?.processing_status === 'duplicate' ||
      metadata?.source_format === 'ubl_xml' ||
      !!metadata?.extraction_snapshot ||
      Number.isSafeInteger(metadata?.merged_into_document_id);
  }

  private jobId(ctx: ReceivedDocumentsContext, id: number, version: number): string {
    return `rd-${ctx.organization_id}-${ctx.accounting_entity_id}-${ctx.store_id}-${id}-v${version}`;
  }

  private requestId(ctx: ReceivedDocumentsContext, id: number, version: number): string {
    return `received-ocr-${ctx.organization_id}-${ctx.accounting_entity_id}-${id}-v${version}`;
  }

  private extractionFromEvent(value: unknown): ReceivedDocumentScanExtraction {
    const event = value as Record<string, unknown> | null;
    if (!event || typeof event !== 'object' || !event['normalized'] || !event['raw_extraction']) {
      throw new ServiceUnavailableException('La lectura guardada no se puede recuperar; reintenta el proceso.');
    }
    return {
      normalized: event['normalized'] as ReceivedDocumentScanExtraction['normalized'],
      raw_extraction: event['raw_extraction'] as Prisma.InputJsonObject,
      page_count: Number.isSafeInteger(event['page_count']) ? Number(event['page_count']) : 0,
      model: typeof event['model'] === 'string' ? event['model'] : null,
    };
  }

  private async assertWorkerAIAccess(ctx: ReceivedDocumentsContext): Promise<void> {
    const access = await this.subscriptionAccess.canUseAIFeature(ctx.store_id!, 'async_queue');
    if (access.mode !== 'block') return;
    const key = access.reason as keyof typeof ErrorCodes;
    const entry = ErrorCodes[key] ?? ErrorCodes.SUBSCRIPTION_005;
    throw new VendixHttpException(entry, undefined, {
      subscription_state: access.subscription_state,
      plan_id: access.plan_id ?? null,
      has_record: access.has_record,
    });
  }

  private async persistExtractionWinner(
    ctx: ReceivedDocumentsContext,
    documentId: number,
    version: number,
    sourceHash: string,
    extraction: ReceivedDocumentScanExtraction,
  ): Promise<ReceivedDocumentScanExtraction> {
    return this.prisma.$transaction(async (tx) => {
      const lockKey = `received-document-ocr:${ctx.accounting_entity_id}:${documentId}:${version}`;
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
      const key = `ai-extraction:${version}`;
      const existing = await tx.received_document_events.findUnique({
        where: { document_id_idempotency_key: { document_id: documentId, idempotency_key: key } },
        select: { status: true, result: true },
      });
      if (existing?.status === 'completed') {
        if ((existing.result as Record<string, unknown> | null)?.['source_hash'] !== sourceHash) {
          throw new ConflictException('La extracción guardada corresponde a otra evidencia original.');
        }
        return this.extractionFromEvent(existing.result);
      }
      const result = this.boundedExtraction(extraction, sourceHash);
      await tx.received_document_events.upsert({
        where: { document_id_idempotency_key: { document_id: documentId, idempotency_key: key } },
        create: {
          document_id: documentId,
          event_type: 'AI_EXTRACTION',
          idempotency_key: key,
          status: 'completed',
          actor_id: ctx.actor_id ?? null,
          result,
        },
        update: { status: 'completed', result },
      });
      return extraction;
    });
  }

  private boundedExtraction(extraction: ReceivedDocumentScanExtraction, sourceHash: string): Prisma.InputJsonObject {
    const value: Prisma.InputJsonObject = {
      normalized: extraction.normalized as unknown as Prisma.InputJsonValue,
      raw_extraction: extraction.raw_extraction,
      page_count: extraction.page_count,
      model: extraction.model,
      source_hash: sourceHash,
    };
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_EVENT_JSON_BYTES) {
      throw new BadRequestException('La evidencia de lectura excede el tamaño permitido.');
    }
    return value;
  }

  private resultFromDocument(document: any): ReceivedDocumentScanResult {
    const extractionEvent = document.events?.find((event: any) => event.event_type === 'AI_EXTRACTION' && event.status === 'completed');
    const extractionResult = extractionEvent?.result as Record<string, unknown> | null;
    return {
      document_id: document.id,
      version: document.version,
      validation_status: document.validation_status,
      review_required: true,
      page_count: Number(document.metadata?.page_count ?? extractionResult?.['page_count'] ?? 0),
    };
  }

  private safeResult(value: unknown): ReceivedDocumentScanResult {
    if (!value || typeof value !== 'object') throw new NotFoundException('Resultado de lectura no encontrado.');
    const result = value as Partial<ReceivedDocumentScanResult>;
    if (!Number.isSafeInteger(result.document_id) || !Number.isSafeInteger(result.version) || typeof result.validation_status !== 'string' || !Number.isSafeInteger(result.page_count)) {
      throw new NotFoundException('Resultado de lectura no encontrado.');
    }
    return {
      document_id: result.document_id!,
      version: result.version!,
      validation_status: result.validation_status,
      review_required: true,
      page_count: result.page_count!,
    };
  }

  private safeErrorCode(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const entry = Object.values(ErrorCodes).find((candidate) => candidate.code === value);
    return entry?.code;
  }

  private sha256(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }
}
