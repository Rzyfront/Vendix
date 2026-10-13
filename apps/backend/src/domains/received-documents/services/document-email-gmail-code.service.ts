import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { EncryptionService } from '../../../common/services/encryption.service';
import { VendixHttpException } from '../../../common/errors/vendix-http.exception';
import { ErrorCodes } from '../../../common/errors/error-codes';
import type { ReceivedDocumentsReadContext } from './received-documents-context.service';
import type { DocumentEmailGmailCodeView, DocumentEmailProcessingContext, DocumentEmailProcessorResult, DocumentEmailTransportFacts } from '../interfaces/document-email-reception.interface';

const TTL_MS = 24 * 60 * 60 * 1000;
const GOOGLE_SENDER = 'forwarding-noreply@google.com';

/** Code display is a manual user step: no links, HTTP requests or auto-confirmation. */
@Injectable()
export class DocumentEmailGmailCodeService {
  constructor(private readonly prisma: GlobalPrismaService, private readonly encryption: EncryptionService) {}

  async inspect(messageId: number, ctx: DocumentEmailProcessingContext, mail: { sender: string; text: string }, facts: DocumentEmailTransportFacts, beforeWrite: () => Promise<void>): Promise<DocumentEmailProcessorResult | null> {
    if (mail.sender !== GOOGLE_SENDER || typeof mail.text !== 'string' || !/forward|reenv[ií]o|confirmation|confirmaci[oó]n/i.test(mail.text)) return null;
    const unavailable = this.outcome('GMAIL_CODE_UNAVAILABLE');
    if (Buffer.byteLength(mail.text, 'utf8') > 256 * 1024 || !facts.gmail_authenticated || facts.virus_status !== 'PASS' || facts.spam_status !== 'PASS') return unavailable;
    if (!/forward|reenv[ií]o/i.test(mail.text)) return unavailable;
    const candidates = new Set([...mail.text.matchAll(/^\s*(?:confirmation code|c[oó]digo de confirmaci[oó]n)\s*[:\-]\s*(\d{6,12})(?!\d)\s*$/gim)].map((match) => match[1]));
    if (candidates.size !== 1) return unavailable;
    const alias = `${ctx.local_part}@${ctx.domain}`;
    const where = { id: messageId, organization_id: ctx.organization_id, store_id: ctx.store_id, accounting_entity_id: ctx.accounting_entity_id, inbox_id: ctx.inbox_id, recipient_alias: alias };
    const row = await this.prisma.document_reception_email_messages.findFirst({ where,
      select: { version: true, processing_token: true, status: true, received_at: true, gmail_code_expires_at: true },
    });
    if (!row || row.status !== 'processing' || !row.processing_token) throw new ServiceUnavailableException('No fue posible guardar el código de forma segura.');
    const deadline = Math.min(row.received_at.getTime() + TTL_MS, row.gmail_code_expires_at?.getTime() ?? Infinity);
    if (!Number.isFinite(deadline) || deadline <= Date.now()) return unavailable;
    const expiresAt = new Date(deadline);
    await beforeWrite();
    return this.prisma.$transaction(async (tx) => {
      // Rotation and transport acceptance use this same store lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`email-inbox:${ctx.organization_id}:${ctx.store_id}`}))`;
      const current = await tx.document_reception_email_inboxes.findFirst({ where: {
        id: ctx.inbox_id, organization_id: ctx.organization_id, store_id: ctx.store_id, accounting_entity_id: ctx.accounting_entity_id,
        local_part: ctx.local_part, domain: ctx.domain, environment: ctx.environment,
      }, select: { id: true } });
      if (!current || deadline <= Date.now()) return unavailable;
      // EncryptionService rejects repository fallback writes in production; errors remain technical.
      const encrypted = this.encryption.encrypt([...candidates][0]);
      const changed = await tx.document_reception_email_messages.updateMany({ where: {
        ...where, status: 'processing', version: row.version, processing_token: row.processing_token,
      }, data: { gmail_code_encrypted: encrypted, gmail_code_expires_at: expiresAt, gmail_challenge_alias: alias } });
      if (changed.count !== 1) throw new ServiceUnavailableException('No fue posible guardar el código de forma segura.');
      return this.outcome('GMAIL_VERIFICATION_CODE');
    });
  }

  /** Configure-only caller; does not enable/create an inbox or enforce subscription writes. */
  async current(ctx: ReceivedDocumentsReadContext): Promise<DocumentEmailGmailCodeView> {
    if (ctx.is_organization || !Number.isSafeInteger(ctx.store_id) || ctx.store_id! < 1) throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);
    const empty = { available: false, code: null, expires_at: null };
    if (ctx.accounting_entity_id == null) return empty;
    const scope = { organization_id: ctx.organization_id, store_id: ctx.store_id!, accounting_entity_id: ctx.accounting_entity_id };
    const inbox = await this.prisma.document_reception_email_inboxes.findFirst({ where: scope, select: { id: true, local_part: true, domain: true } });
    if (!inbox) return empty;
    const alias = `${inbox.local_part}@${inbox.domain}`;
    const row = await this.prisma.document_reception_email_messages.findFirst({ where: {
      ...scope, inbox_id: inbox.id, status: 'ignored', reason_code: 'GMAIL_VERIFICATION_CODE',
      gmail_challenge_alias: alias, gmail_code_expires_at: { gt: new Date() }, gmail_code_encrypted: { not: null },
      inbox: { is: { id: inbox.id, ...scope, local_part: inbox.local_part, domain: inbox.domain } },
    }, select: { gmail_code_encrypted: true, gmail_code_expires_at: true }, orderBy: [{ received_at: 'desc' }, { id: 'desc' }] });
    if (!row?.gmail_code_encrypted || !row.gmail_code_expires_at || row.gmail_code_expires_at.getTime() <= Date.now()) return empty;
    try {
      const code = this.encryption.decrypt(row.gmail_code_encrypted);
      if (!/^\d{6,12}$/.test(code)) throw new Error('Invalid code');
      return { available: true, code, expires_at: row.gmail_code_expires_at };
    } catch { throw new ServiceUnavailableException('No fue posible leer el código de confirmación.'); }
  }

  private outcome(reason: 'GMAIL_VERIFICATION_CODE' | 'GMAIL_CODE_UNAVAILABLE'): DocumentEmailProcessorResult {
    return { status: 'ignored', reason_code: reason, retryable: false, parts: [], valid_document: false };
  }
}
