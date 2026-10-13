import { HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { document_reception_email_messages, Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ErrorCodes } from '../../../common/errors/error-codes';
import { VendixHttpException } from '../../../common/errors/vendix-http.exception';
import { DocumentEmailSqsConsumerService } from './document-email-sqs-consumer.service';
import type { ReceivedDocumentsReadContext } from './received-documents-context.service';
import type { DiscardDocumentEmailMessageDto, DocumentEmailMessagesQueryDto, DocumentEmailMessageVersionDto } from '../dto/document-email-reception.dto';
import {
  DOCUMENT_EMAIL_REASON_CODES, DOCUMENT_EMAIL_STATES, DOCUMENT_EMAIL_WARNINGS,
  DocumentEmailMessagePartView, DocumentEmailMessagesPage, DocumentEmailMessageView, DocumentEmailReasonCode,
  DocumentEmailRetryView, DocumentEmailSnapshot,
} from '../interfaces/document-email-reception.interface';

type Message = document_reception_email_messages;

/** Tenant-scoped, metadata-only history. Reads never ensure entities or gate a subscription. */
@Injectable()
export class DocumentEmailHistoryService {
  constructor(private readonly prisma: GlobalPrismaService, private readonly consumer: DocumentEmailSqsConsumerService) {}

  async list(ctx: ReceivedDocumentsReadContext, query: DocumentEmailMessagesQueryDto): Promise<DocumentEmailMessagesPage> {
    this.assertStore(ctx);
    const page = query.page ?? 1, limit = query.limit ?? 25;
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !['history', 'not_processed'].includes(query.view ?? 'history') || (query.archived != null && typeof query.archived !== 'boolean')) throw new VendixHttpException(ErrorCodes.SYS_VALIDATION_001);
    if (ctx.accounting_entity_id == null) return { data: [], total: 0, page, limit };
    const where: Prisma.document_reception_email_messagesWhereInput = {
      ...this.scope(ctx), archived_at: query.view === 'not_processed' || !query.archived ? null : { not: null },
      ...(query.view === 'not_processed' ? { status: { in: ['received', 'processing', 'partial', 'not_processed', 'failed'] } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.document_reception_email_messages.findMany({ where, orderBy: [{ received_at: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
      this.prisma.document_reception_email_messages.count({ where }),
    ]);
    return { data: await this.views(rows, ctx), total, page, limit };
  }

  async detail(ctx: ReceivedDocumentsReadContext, id: number): Promise<DocumentEmailMessageView> {
    const row = await this.find(ctx, id);
    return (await this.views([row], ctx))[0];
  }

  async discard(ctx: ReceivedDocumentsReadContext, id: number, dto: DiscardDocumentEmailMessageDto): Promise<DocumentEmailMessageView> {
    this.assertActor(ctx); this.assertVersion(dto.expected_version);
    const row = await this.find(ctx, id);
    // Idempotent archival is safe even when the caller still holds the pre-archive version.
    if (row.archived_at != null) return (await this.views([row], ctx))[0];
    if (['received', 'processing'].includes(row.status) || row.processing_token != null) throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_VERSION_CONFLICT, 'Espera a que termine el procesamiento antes de archivar este correo.');
    if (row.version !== dto.expected_version) throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_VERSION_CONFLICT);
    const reason = dto.reason == null ? 'Archivado por el usuario' : this.safeText(dto.reason);
    if (!reason || (dto.reason != null && dto.reason.length > 255)) throw new VendixHttpException(ErrorCodes.SYS_VALIDATION_001);
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.document_reception_email_messages.updateMany({ where: {
        id, ...this.scope(ctx), version: dto.expected_version, archived_at: null, processing_token: null,
        status: { notIn: ['received', 'processing'] },
      }, data: { archived_at: new Date(), archived_by: ctx.actor_id!, version: { increment: 1 } } });
      if (changed.count !== 1) throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_VERSION_CONFLICT);
      await tx.audit_logs.create({ data: {
        organization_id: ctx.organization_id, store_id: ctx.store_id!, user_id: ctx.actor_id!, action: 'UPDATE',
        resource: 'document_reception_email_messages', resource_id: id,
        old_values: { archived: false, version: row.version }, new_values: { archived: true, version: row.version + 1 }, metadata: { reason },
      } });
    });
    return this.detail(ctx, id);
  }

  async retry(ctx: ReceivedDocumentsReadContext, id: number, dto: DocumentEmailMessageVersionDto): Promise<DocumentEmailRetryView> {
    this.assertActor(ctx); this.assertVersion(dto.expected_version);
    const row = await this.find(ctx, id);
    if (row.version !== dto.expected_version) throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_VERSION_CONFLICT);
    if (!this.retryEligible(row)) throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_VERSION_CONFLICT, 'Este correo no se puede reintentar. Revisa su estado o vuelve a enviarlo.');
    try { await this.consumer.sendInternalRetry(id, dto.expected_version, this.snapshot(row)); }
    catch (error) {
      // Typed authority/CAS errors keep their real status; SDK/internal failures remain technical 503.
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('No fue posible solicitar el reintento. Vuelve a cargar el historial antes de intentarlo otra vez.');
    }
    return { id, version: dto.expected_version + 1, requested: true };
  }

  private async find(ctx: ReceivedDocumentsReadContext, id: number): Promise<Message> {
    this.assertStore(ctx);
    if (!Number.isSafeInteger(id) || id < 1) throw new VendixHttpException(ErrorCodes.SYS_VALIDATION_001);
    if (ctx.accounting_entity_id == null) throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    const row = await this.prisma.document_reception_email_messages.findFirst({ where: { id, ...this.scope(ctx) } });
    if (!row) throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    return row;
  }

  private async views(rows: Message[], ctx: ReceivedDocumentsReadContext): Promise<DocumentEmailMessageView[]> {
    const parsed = rows.map((row) => this.publicParts(row.parts));
    const candidateIds = [...new Set(parsed.flatMap((parts) => parts.flatMap((part) => part.document_id != null ? [part.document_id] : [])))];
    const visible = candidateIds.length ? await this.prisma.received_documents.findMany({ where: { ...this.scope(ctx), id: { in: candidateIds } }, select: { id: true } }) : [];
    const visibleIds = new Set(visible.map((document) => document.id));
    return rows.map((row, index) => {
      const gmail = ['GMAIL_VERIFICATION_CODE', 'GMAIL_CODE_UNAVAILABLE'].includes(row.reason_code ?? '') || !!row.gmail_code_encrypted || row.sender?.includes('forwarding-noreply@google.com');
      const reason = this.reason(row.reason_code);
      const expiredTechnical = reason === 'TECHNICAL_PROCESSING_ERROR' && this.rawExpired(row);
      const parts = gmail ? [] : parsed[index].map((part) => {
        if (part.document_id != null && (!visibleIds.has(part.document_id) || part.reason_code === 'DUPLICATE_OTHER_STORE')) {
          const { document_id: _hidden, ...safe } = part; return safe;
        }
        return part;
      });
      return {
        id: row.id, version: row.version, received_at: row.received_at, processed_at: row.processed_at,
        status: DOCUMENT_EMAIL_STATES.includes(row.status as never) ? row.status as DocumentEmailMessageView['status'] : 'failed',
        reason_code: expiredTechnical ? 'RAW_EXPIRED' : reason, retryable: row.retryable, can_retry: this.retryEligible(row),
        archived_at: row.archived_at, sender: this.safeText(row.sender), subject: gmail ? 'Confirmación de reenvío de Gmail' : this.safeText(row.subject), parts,
      };
    });
  }

  private publicParts(value: Prisma.JsonValue): DocumentEmailMessagePartView[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 40).flatMap((value) => {
      const part = this.object(value);
      const filename = this.safeText(part?.filename, 120);
      if (!part || !filename || !Number.isInteger(part.message_index) || !Number.isInteger(part.ordinal) || !['xml', 'zip', 'pdf', 'eml', 'other'].includes(part.kind as string) || !DOCUMENT_EMAIL_STATES.includes(part.status as never)) return [];
      const safe: DocumentEmailMessagePartView = { message_index: part.message_index as number, ordinal: part.ordinal as number, filename, kind: part.kind as DocumentEmailMessagePartView['kind'], status: part.status as DocumentEmailMessagePartView['status'] };
      if (['container', 'commercial', 'dian_receipt', 'representation', 'complement'].includes(part.role as string)) safe.role = part.role as DocumentEmailMessagePartView['role'];
      const reason = this.reason(part.reason_code); if (reason) safe.reason_code = reason;
      const details = this.object(part.reason_details);
      if (details) {
        const allowed: NonNullable<DocumentEmailMessagePartView['reason_details']> = {};
        for (const key of ['receiver_tax_id', 'expected_receiver_tax_id'] as const) {
          if (typeof details[key] === 'string' && /^[0-9-]{1,50}$/.test(details[key])) allowed[key] = details[key];
        }
        if (Object.keys(allowed).length) safe.reason_details = allowed;
      }
      if (Array.isArray(part.warnings)) safe.warnings = part.warnings.filter((warning) => DOCUMENT_EMAIL_WARNINGS.includes(warning as never)).slice(0, 4) as DocumentEmailMessagePartView['warnings'];
      if (Number.isSafeInteger(part.document_id) && (part.document_id as number) > 0) safe.document_id = part.document_id as number;
      return [safe];
    });
  }

  private retryEligible(row: Message): boolean {
    const facts = this.facts(row);
    return row.archived_at == null && ['failed', 'partial'].includes(row.status) && row.retryable && row.processed_at == null && row.processing_token == null && row.reason_code === 'TECHNICAL_PROCESSING_ERROR' && facts?.virus_status === 'PASS' && facts.spam_status === 'PASS' && !this.rawExpired(row);
  }
  private rawExpired(row: Message): boolean { const days = row.reason_code === 'NOT_AN_INVOICE' || this.facts(row)?.spam_status === 'FAIL' ? 7 : 30; return Date.now() - row.received_at.getTime() >= days * 86_400_000; }
  private facts(row: Message): Record<string, unknown> | null { return Array.isArray(row.parts) && row.parts.length ? this.object(this.object(row.parts[0])?.transport_facts) : null; }
  private object(value: unknown): Record<string, unknown> | null { return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
  private reason(value: unknown): DocumentEmailReasonCode | null { return DOCUMENT_EMAIL_REASON_CODES.includes(value as never) ? value as DocumentEmailReasonCode : null; }
  private safeText(value: unknown, maximum = 255): string | null { return typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, maximum) || null : null; }
  private scope(ctx: ReceivedDocumentsReadContext) { return { organization_id: ctx.organization_id, store_id: ctx.store_id!, accounting_entity_id: ctx.accounting_entity_id! }; }
  private snapshot(row: Message): DocumentEmailSnapshot { return { inbox_id: row.inbox_id, organization_id: row.organization_id, store_id: row.store_id, accounting_entity_id: row.accounting_entity_id, local_part: row.local_part, domain: row.domain, environment: row.environment }; }
  private assertVersion(version: number): void { if (!Number.isSafeInteger(version) || version < 1) throw new VendixHttpException(ErrorCodes.SYS_VALIDATION_001); }
  private assertStore(ctx: ReceivedDocumentsReadContext): void { if (ctx.is_organization || !Number.isSafeInteger(ctx.organization_id) || ctx.organization_id < 1 || !Number.isSafeInteger(ctx.store_id) || ctx.store_id! < 1) throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001); }
  private assertActor(ctx: ReceivedDocumentsReadContext): void { this.assertStore(ctx); if (!Number.isSafeInteger(ctx.actor_id) || ctx.actor_id! < 1) throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001); }
}
