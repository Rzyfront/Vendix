import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { document_reception_email_messages, Prisma } from '@prisma/client';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { S3Client, GetObjectCommand, PutObjectTaggingCommand } from '@aws-sdk/client-s3';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { getHeapStatistics } from 'node:v8';
import { ErrorCodes } from '../../../common/errors/error-codes';
import { VendixHttpException } from '../../../common/errors/vendix-http.exception';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { DocumentEmailInboxService } from './document-email-inbox.service';
import {
  DOCUMENT_EMAIL_PROCESSOR, DOCUMENT_EMAIL_REASON_CODES, DOCUMENT_EMAIL_STATES, DOCUMENT_EMAIL_WARNINGS,
  DocumentEmailPartResult, DocumentEmailProcessor, DocumentEmailProcessorResult, DocumentEmailSnapshot,
  DocumentEmailTransport, DocumentEmailTransportFacts, DocumentEmailReasonCode,
} from '../interfaces/document-email-reception.interface';

type Message = document_reception_email_messages;
type JsonRecord = Record<string, unknown>;
type Binding = { environment: string; domain: string; region: string; topic: string; bucket: string; prefix: string; queue: string };
type Delivery = { ses_id: string; sns_id: string; recipients: string[]; bucket: string; key: string; received_at: Date; rfc_hash: string | null; sender: string | null; subject: string | null; facts: DocumentEmailTransportFacts };
export interface DocumentEmailDeliveryResult { acknowledged: boolean; handled: number }
const MAX_RAW = 20 * 1024 * 1024;
const DAILY_BYTES = 1024 * 1024 * 1024;
const LEASE_MS = 120_000;
const FINAL_STATUSES = new Set(['processed', 'partial', 'not_processed', 'failed', 'ignored']);
class ConsumerInterrupted extends Error {}
class EmailLimitExceeded extends Error {}

/** SQS remains the retry owner until every recognized operational recipient has a durable final result. */
@Injectable()
export class DocumentEmailSqsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DocumentEmailSqsConsumerService.name);
  private readonly stop = new AbortController();
  private loopTask: Promise<void> | null = null;
  private aws: { sqs: SQSClient; s3: S3Client; metrics: CloudWatchClient } | null = null;
  private metricHeartbeat: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly config: ConfigService,
    private readonly inboxes: DocumentEmailInboxService,
    @Inject(DOCUMENT_EMAIL_PROCESSOR) private readonly processor: DocumentEmailProcessor,
  ) {}

  onModuleInit(): void {
    const role = this.config.get<string>('VENDIX_PROCESS_ROLE', 'all').trim().toLowerCase();
    if (this.config.get<string>('NODE_ENV', 'development') === 'development' || !this.enabled() || !['worker', 'all'].includes(role)) return;
    try { this.binding(); } catch { this.logger.warn('Email consumer binding is incomplete; polling disabled.'); return; }
    this.metricHeartbeat = setInterval(() => { void this.publishHeartbeat(); }, 60_000);
    this.metricHeartbeat.unref();
    this.loopTask = this.poll();
  }

  async onModuleDestroy(): Promise<void> {
    this.stop.abort();
    if (this.metricHeartbeat) clearInterval(this.metricHeartbeat);
    // All transport commands and processing streams receive this abort signal.
    if (this.loopTask) await Promise.race([this.loopTask, new Promise<void>((resolve) => { const timer = setTimeout(resolve, 5000); timer.unref(); })]);
    this.aws?.sqs.destroy(); this.aws?.s3.destroy(); this.aws?.metrics.destroy();
  }

  private async poll(): Promise<void> {
    while (!this.stop.signal.aborted && this.enabled()) {
      try {
        const binding = this.binding();
        const response = await this.clients().sqs.send(new ReceiveMessageCommand({
          QueueUrl: binding.queue, MaxNumberOfMessages: 1, WaitTimeSeconds: 20, VisibilityTimeout: 120,
        }), { abortSignal: this.stop.signal });
        for (const delivery of response.Messages ?? []) {
          if (this.stop.signal.aborted) return;
          if (delivery.Body && delivery.ReceiptHandle) await this.handleDelivery(delivery.Body, this.awsTransport(delivery.ReceiptHandle));
        }
      } catch {
        if (this.stop.signal.aborted) return;
        this.logger.warn('Email consumer polling deferred.');
        await this.metric('ConsumerErrors');
        await this.backoff();
      }
    }
  }

  /** Internal simulator/spec entry point; never exposed over HTTP. */
  async handleDelivery(body: string, suppliedTransport?: DocumentEmailTransport): Promise<DocumentEmailDeliveryResult> {
    const transport = suppliedTransport ?? this.awsTransport();
    const deliveryAbort = new AbortController();
    const abortDelivery = () => deliveryAbort.abort();
    this.stop.signal.addEventListener('abort', abortDelivery, { once: true });
    const signal = deliveryAbort.signal;
    let handled = 0;
    let visibilityTimer: NodeJS.Timeout | undefined;
    try {
      this.assertRunning(signal);
      if (Buffer.byteLength(body, 'utf8') > 300 * 1024) throw new Error('Envelope budget exceeded');
      if (transport.receipt_handle) {
        visibilityTimer = setInterval(() => {
          void transport.renew(transport.receipt_handle!, signal).catch(abortDelivery);
        }, 30_000);
        visibilityTimer.unref();
      }
      const parsed = this.object(JSON.parse(body));
      if (!parsed) throw new Error('Invalid envelope');
      if (parsed.type === 'internal_retry') {
        if (Object.keys(parsed).sort().join(',') !== 'message_id,type,version' || !this.positive(parsed.message_id) || !this.positive(parsed.version)) throw new Error('Invalid retry');
        const row = await this.prisma.document_reception_email_messages.findFirst({ where: { id: parsed.message_id } });
        if (!row) throw new Error('Missing retry record');
        this.assertRowBinding(row);
        if (!this.final(row)) {
          const facts = this.checkpointFacts(row.parts);
          if (!facts) throw new Error('Missing retry security checkpoint');
          // A newer UI request supersedes old retry epochs, but re-delivery of this epoch may resume.
          if (facts.retry_requested_version === parsed.version) {
            if (!row.retryable && row.status !== 'processing') throw new Error('Ineligible retry');
            if (row.reason_code !== 'TECHNICAL_PROCESSING_ERROR' || facts.virus_status !== 'PASS' || facts.spam_status !== 'PASS') throw new Error('Unsafe retry');
            const expired = Date.now() - row.received_at.getTime() > this.rawTtl(row, facts);
            const done = await this.processRecord(row, facts, transport, signal, expired ? 'RAW_EXPIRED' : null);
            if (!done) return { acknowledged: false, handled: 1 };
          }
        }
        handled = 1;
      } else {
        const delivery = this.validateDelivery(parsed);
        const rows: Message[] = [];
        // Register all recognized aliases first. Unknown aliases never inherit a tenant from MIME headers.
        for (const recipient of delivery.recipients) {
          const row = await this.register(delivery, recipient);
          if (row) rows.push(row);
        }
        let allFinal = true;
        for (const row of rows) {
          handled++;
          if (!this.final(row) && !await this.processRecord(row, this.checkpointFacts(row.parts) ?? delivery.facts, transport, signal)) allFinal = false;
        }
        if (!allFinal) return { acknowledged: false, handled };
        if (rows.length && transport.tagRaw) {
          const fresh = await this.prisma.document_reception_email_messages.findMany({ where: { id: { in: rows.map((row) => row.id) } }, select: { reason_code: true } });
          const nonInvoice = fresh.every((row) => ['NOT_AN_INVOICE', 'SUSPICIOUS_EMAIL'].includes(row.reason_code ?? ''));
          try { await transport.tagRaw(delivery.bucket, delivery.key, nonInvoice ? 'noinvoice' : 'invoice', signal); }
          catch (error) { await this.metric('StorageErrors'); throw error; }
        }
      }
      this.assertRunning(signal);
      if (transport.receipt_handle) await transport.delete(transport.receipt_handle, signal);
      return { acknowledged: true, handled };
    } catch {
      if (!signal.aborted) { this.logger.warn('Email delivery deferred without acknowledgement.'); await this.metric('ConsumerErrors'); }
      return { acknowledged: false, handled };
    } finally { if (visibilityTimer) clearInterval(visibilityTimer); deliveryAbort.abort(); this.stop.signal.removeEventListener('abort', abortDelivery); }
  }

  /** Enqueue metadata-only internal retry. Consumer reloads all pointers/security facts from DB. */
  async sendInternalRetry(messageId: number, expectedVersion: number, authorizedSnapshot?: DocumentEmailSnapshot, suppliedTransport?: DocumentEmailTransport): Promise<void> {
    if (!this.positive(messageId) || !this.positive(expectedVersion)) throw new Error('Invalid retry request');
    const row = await this.prisma.document_reception_email_messages.findFirst({ where: { id: messageId, version: expectedVersion } });
    if (!row || !row.retryable || row.reason_code !== 'TECHNICAL_PROCESSING_ERROR' || !['failed', 'partial'].includes(row.status) || row.processed_at != null) throw new Error('Ineligible retry request');
    this.assertRowBinding(row);
    if (authorizedSnapshot && (authorizedSnapshot.organization_id !== row.organization_id || authorizedSnapshot.store_id !== row.store_id || authorizedSnapshot.accounting_entity_id !== row.accounting_entity_id || authorizedSnapshot.inbox_id !== row.inbox_id)) throw new Error('Retry outside authorized scope');
    const facts = this.checkpointFacts(row.parts);
    if (!facts || facts.virus_status !== 'PASS' || facts.spam_status !== 'PASS' || Date.now() - row.received_at.getTime() > this.rawTtl(row, facts)) throw new Error('Unsafe retry request');
    await this.inboxes.revalidateSnapshot(this.snapshot(row));
    const epoch = expectedVersion + 1;
    const updated = await this.prisma.document_reception_email_messages.updateMany({ where: {
      ...this.rowWhere(row), version: expectedVersion, status: { in: ['failed', 'partial'] }, retryable: true, processed_at: null, processing_token: null,
    }, data: { version: { increment: 1 }, parts: this.partsJson(row.parts, { ...facts, retry_requested_version: epoch }) } });
    if (updated.count !== 1) throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_VERSION_CONFLICT);
    await (suppliedTransport ?? this.awsTransport()).sendRetry({ type: 'internal_retry', message_id: row.id, version: epoch }, this.stop.signal);
  }

  private async register(delivery: Delivery, recipient: string): Promise<Message | null> {
    const binding = this.binding();
    if (!this.recipientFits(recipient, binding.domain)) return null;
    const transportWhere = { environment: binding.environment, ses_message_id: delivery.ses_id, recipient_alias: recipient };
    const accepted = await this.prisma.document_reception_email_messages.findFirst({ where: transportWhere });
    if (accepted) { this.assertRowBinding(accepted); return accepted; }
    const snapshot = await this.inboxes.lookupByAlias(recipient);
    if (!snapshot) return null;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`email-inbox:${snapshot.organization_id}:${snapshot.store_id}`}))`;
      const duplicate = await tx.document_reception_email_messages.findFirst({ where: transportWhere });
      if (duplicate) { this.assertRowBinding(duplicate); return duplicate; }
      const inbox = await tx.document_reception_email_inboxes.findFirst({ where: {
        id: snapshot.inbox_id, organization_id: snapshot.organization_id, store_id: snapshot.store_id,
        accounting_entity_id: snapshot.accounting_entity_id, local_part: snapshot.local_part, domain: snapshot.domain, environment: snapshot.environment,
      } });
      if (!inbox) return null; // Rotation won the shared lock before transport acceptance.
      await this.quotaLock(tx, snapshot.store_id, delivery.received_at);
      const usage = await tx.document_reception_email_messages.aggregate({ where: this.dailyWhere(snapshot.store_id, delivery.received_at), _count: { _all: true }, _sum: { raw_bytes: true } });
      const overQuota = usage._count._all >= 200 || (usage._sum.raw_bytes ?? 0) >= DAILY_BYTES;
      const row = await tx.document_reception_email_messages.create({ data: {
        ...snapshot, inbox_id: snapshot.inbox_id, recipient_alias: recipient,
        ses_message_id: delivery.ses_id, sns_message_id: delivery.sns_id, rfc_message_id_hash: delivery.rfc_hash,
        raw_bucket: delivery.bucket, raw_key: delivery.key, received_at: delivery.received_at, sender: delivery.sender, subject: delivery.subject,
        parts: this.partsJson([], delivery.facts),
        ...(overQuota ? { status: 'not_processed', reason_code: 'DAILY_QUOTA_EXCEEDED', processed_at: new Date() } : {}),
      } });
      await tx.document_reception_email_inboxes.updateMany({ where: {
        id: snapshot.inbox_id, organization_id: snapshot.organization_id, store_id: snapshot.store_id,
        OR: [{ last_email_at: null }, { last_email_at: { lt: delivery.received_at } }],
      }, data: { last_email_at: delivery.received_at } });
      return row;
    });
  }

  private async processRecord(row: Message, facts: DocumentEmailTransportFacts, transport: DocumentEmailTransport, deliverySignal: AbortSignal, forcedReason: DocumentEmailReasonCode | null = null): Promise<boolean> {
    this.assertRowBinding(row);
    const token = randomBytes(16).toString('hex');
    const changed = await this.prisma.document_reception_email_messages.updateMany({ where: {
      ...this.rowWhere(row), version: row.version, processed_at: null,
      OR: [{ processing_token: null }, { processing_started_at: { lte: new Date(Date.now() - LEASE_MS) } }],
    }, data: { status: 'processing', processing_token: token, processing_started_at: new Date(), version: { increment: 1 }, attempt_count: { increment: 1 } } });
    if (changed.count !== 1) return false;
    const claimVersion = row.version + 1;
    const owned = () => ({ ...this.rowWhere(row), version: claimVersion, processing_token: token, status: 'processing' });
    const work = new AbortController();
    const abort = () => work.abort();
    deliverySignal.addEventListener('abort', abort, { once: true });
    let leaseTask = Promise.resolve();
    let leaseGateReason: DocumentEmailReasonCode | null = null;
    let leaseTimer: NodeJS.Timeout | undefined;
    let raw: Readable | undefined;
    let authorityBaseline: { nit: string; nit_type: string | undefined; fiscal_scope: string } | null = null;
    const fence = async () => {
      this.assertRunning(deliverySignal);
      this.assertRunning(work.signal);
      const context = await this.inboxes.revalidateSnapshot(this.snapshot(row));
      const currentAuthority = { nit: context.fiscal_identity.nit, nit_type: context.fiscal_identity.nit_type, fiscal_scope: context.fiscal_scope };
      // Address rotation is cosmetic; taxpayer identity changing mid-attempt is not.
      if (authorityBaseline && (authorityBaseline.nit !== currentAuthority.nit || authorityBaseline.nit_type !== currentAuthority.nit_type || authorityBaseline.fiscal_scope !== currentAuthority.fiscal_scope)) {
        throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_FISCAL_GATE);
      }
      authorityBaseline ??= currentAuthority;
      const renewed = await this.prisma.document_reception_email_messages.updateMany({ where: owned(), data: { processing_started_at: new Date() } });
      if (renewed.count !== 1) { work.abort(); throw new ConsumerInterrupted(); }
      this.assertRunning(work.signal);
      return context;
    };
    try {
      let result: DocumentEmailProcessorResult;
      const reason = forcedReason ?? this.securityReason(facts);
      if (reason) result = this.rejection(reason);
      else {
        const context = await fence();
        leaseTimer = setInterval(() => {
          leaseTask = leaseTask.then(async () => { await fence(); }).catch((error) => { leaseGateReason = this.gateReason(error); work.abort(); });
        }, 30_000); leaseTimer.unref();
        let bytes: Buffer;
        try {
          raw = await transport.readRaw(row.raw_bucket, row.raw_key, work.signal);
          bytes = await this.boundedRead(raw, work.signal);
        } catch (error) { await this.metric('StorageErrors'); throw error; }
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        if (row.raw_sha256 && row.raw_sha256 !== sha256) throw new Error('Raw changed');
        const quotaAllowed = await this.prisma.$transaction(async (tx) => {
          await this.quotaLock(tx, row.store_id, row.received_at);
          const usage = await tx.document_reception_email_messages.aggregate({ where: { ...this.dailyWhere(row.store_id, row.received_at), id: { not: row.id } }, _sum: { raw_bytes: true } });
          const updated = await tx.document_reception_email_messages.updateMany({ where: owned(), data: { raw_bytes: bytes.length, raw_sha256: sha256 } });
          if (updated.count !== 1) throw new ConsumerInterrupted();
          return (usage._sum.raw_bytes ?? 0) + bytes.length <= DAILY_BYTES;
        });
        if (!quotaAllowed) result = this.rejection('DAILY_QUOTA_EXCEEDED');
        else {
          raw = Readable.from([bytes]);
          result = await this.processor.processEmail({ raw, context, message_id: row.id,
            checkpoint_parts: this.safeParts(row.parts), transport_facts: facts,
            before_write: async () => { await fence(); }, signal: work.signal });
        }
      }
      if (leaseTimer) clearInterval(leaseTimer);
      await leaseTask;
      this.assertRunning(work.signal);
      return await this.complete(row, token, claimVersion, result, facts, work.signal);
    } catch (error) {
      if (leaseTimer) clearInterval(leaseTimer);
      await leaseTask;
      if (deliverySignal.aborted || this.stop.signal.aborted) return false;
      const mapped = leaseGateReason ?? this.gateReason(error);
      if (!mapped && (work.signal.aborted || error instanceof ConsumerInterrupted)) return false;
      try { return await this.complete(row, token, claimVersion, mapped ? this.rejection(mapped) : {
        ...this.rejection(error instanceof EmailLimitExceeded ? 'LIMIT_EXCEEDED' : 'TECHNICAL_PROCESSING_ERROR'),
        status: error instanceof EmailLimitExceeded ? 'not_processed' : 'failed', retryable: !(error instanceof EmailLimitExceeded),
        parts: this.safeParts(row.parts),
      }, facts, mapped ? deliverySignal : work.signal); } catch { return false; }
    } finally {
      if (leaseTimer) clearInterval(leaseTimer);
      raw?.destroy(); work.abort(); deliverySignal.removeEventListener('abort', abort);
    }
  }

  private async complete(row: Message, token: string, version: number, result: DocumentEmailProcessorResult, facts: DocumentEmailTransportFacts, signal: AbortSignal): Promise<boolean> {
    if (!FINAL_STATUSES.has(result.status) || (result.reason_code != null && !DOCUMENT_EMAIL_REASON_CODES.includes(result.reason_code))) throw new Error('Invalid processor outcome');
    if (result.retryable && (!['failed', 'partial'].includes(result.status) || result.reason_code !== 'TECHNICAL_PROCESSING_ERROR')) throw new Error('Invalid retry outcome');
    const parts = this.partsJson(result.parts, facts);
    return this.prisma.$transaction(async (tx) => {
      this.assertRunning(signal);
      const changed = await tx.document_reception_email_messages.updateMany({ where: {
        ...this.rowWhere(row), version, processing_token: token, status: 'processing',
      }, data: { status: result.status, reason_code: result.reason_code, retryable: result.retryable, parts,
        processed_at: result.retryable ? null : new Date(), processing_token: null, processing_started_at: null, version: { increment: 1 } } });
      if (changed.count !== 1) throw new ConsumerInterrupted();
      if (result.valid_document) {
        const where = { id: row.inbox_id, organization_id: row.organization_id, store_id: row.store_id, accounting_entity_id: row.accounting_entity_id };
        await tx.document_reception_email_inboxes.updateMany({ where: { ...where, first_valid_received_at: null }, data: { first_valid_received_at: row.received_at } });
        await tx.document_reception_email_inboxes.updateMany({ where: { ...where, OR: [{ last_valid_received_at: null }, { last_valid_received_at: { lt: row.received_at } }] }, data: { last_valid_received_at: row.received_at } });
        await tx.document_reception_email_inboxes.updateMany({ where, data: { last_error_code: result.reason_code } });
      } else if (result.reason_code) await tx.document_reception_email_inboxes.updateMany({ where: { id: row.inbox_id, organization_id: row.organization_id, store_id: row.store_id }, data: { last_error_code: result.reason_code } });
      return !result.retryable;
    });
  }

  private validateDelivery(envelope: JsonRecord): Delivery {
    const binding = this.binding();
    if (envelope.Type !== 'Notification' || envelope.TopicArn !== binding.topic || typeof envelope.Message !== 'string' || typeof envelope.MessageId !== 'string' || envelope.MessageId.length > 255 || envelope.Message.length > 256 * 1024) throw new Error('Invalid SNS binding');
    const payload = this.object(JSON.parse(envelope.Message));
    const mail = this.object(payload?.mail), receipt = this.object(payload?.receipt), action = this.object(receipt?.action);
    if (payload?.notificationType !== 'Received' || !mail || !receipt || !action || action.type !== 'S3' || action.topicArn !== binding.topic || action.bucketName !== binding.bucket) throw new Error('Invalid SES binding');
    if (typeof mail.messageId !== 'string' || !/^[a-zA-Z0-9_-]{1,255}$/.test(mail.messageId) || action.objectKey !== binding.prefix + mail.messageId) throw new Error('Invalid raw pointer');
    if (!Array.isArray(receipt.recipients) || receipt.recipients.length > 100 || !receipt.recipients.every((recipient) => typeof recipient === 'string' && recipient.length <= 320)) throw new Error('Invalid recipients');
    const receivedAt = new Date(typeof receipt.timestamp === 'string' ? receipt.timestamp : '');
    if (!Number.isFinite(receivedAt.getTime()) || receivedAt.getTime() > Date.now() + 300_000) throw new Error('Invalid receipt date');
    const headers = this.object(mail.commonHeaders);
    const from = headers?.from;
    const googleFrom = Array.isArray(from) && from.length === 1 && typeof from[0] === 'string' && /^(?:[^<>\r\n]*<)?forwarding-noreply@google\.com>?$/.test(from[0]);
    const facts: DocumentEmailTransportFacts = { virus_status: this.verdict(receipt.virusVerdict), spam_status: this.verdict(receipt.spamVerdict),
      gmail_authenticated: googleFrom && this.verdict(receipt.dkimVerdict) === 'PASS' && this.verdict(receipt.dmarcVerdict) === 'PASS' };
    const rfcId = headers?.messageId;
    return { ses_id: mail.messageId, sns_id: envelope.MessageId, bucket: binding.bucket, key: action.objectKey as string,
      recipients: [...new Set(receipt.recipients as string[])], received_at: receivedAt, facts, sender: this.sanitizeText(Array.isArray(from) ? from[0] : null),
      subject: googleFrom ? 'Confirmación de reenvío de Gmail' : this.sanitizeText(headers?.subject),
      rfc_hash: typeof rfcId === 'string' && rfcId.length <= 1024 ? createHash('sha256').update(rfcId).digest('hex') : null };
  }

  private binding(): Binding {
    const environment = this.config.get<string>('EMAIL_RECEPTION_ENVIRONMENT', 'staging');
    const domain = this.config.get<string>('EMAIL_RECEPTION_DOMAIN', environment === 'production' ? 'recepcion.vendix.online' : 'recepcion-stg.vendix.online');
    const region = this.config.get<string>('EMAIL_RECEPTION_AWS_REGION', 'us-east-1');
    const topic = this.config.get<string>('EMAIL_RECEPTION_SNS_TOPIC_ARN', '');
    const bucket = this.config.get<string>('EMAIL_RECEPTION_RAW_BUCKET', '');
    const prefix = this.config.get<string>('EMAIL_RECEPTION_RAW_PREFIX', 'raw/');
    const queue = this.config.get<string>('EMAIL_RECEPTION_SQS_QUEUE_URL', '');
    const arn = /^arn:aws:sns:us-east-1:(\d{12}):[a-zA-Z0-9_-]+$/.exec(topic);
    if (!['production', 'staging'].includes(environment) || domain !== (environment === 'production' ? 'recepcion.vendix.online' : 'recepcion-stg.vendix.online') || region !== 'us-east-1' || !arn || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || prefix !== 'raw/' || !queue.startsWith(`https://sqs.us-east-1.amazonaws.com/${arn[1]}/`) || !/^https:\/\/sqs\.us-east-1\.amazonaws\.com\/\d{12}\/[a-zA-Z0-9_-]+$/.test(queue)) throw new Error('Invalid email configuration');
    return { environment, domain, region, topic, bucket, prefix, queue };
  }

  private assertRowBinding(row: Message): void {
    const binding = this.binding();
    if (row.environment !== binding.environment || row.domain !== binding.domain || row.raw_bucket !== binding.bucket || !/^[a-zA-Z0-9_-]{1,255}$/.test(row.ses_message_id) || row.raw_key !== binding.prefix + row.ses_message_id || row.recipient_alias !== `${row.local_part}@${row.domain}` || !this.recipientFits(row.recipient_alias, binding.domain)) throw new Error('Invalid ledger binding');
  }
  private recipientFits(alias: string, domain: string): boolean { return /^facturas-[0-9a-f]{32}@[^@]+$/.test(alias) && alias.endsWith('@' + domain); }
  private snapshot(row: Message): DocumentEmailSnapshot { return { inbox_id: row.inbox_id, organization_id: row.organization_id, store_id: row.store_id, accounting_entity_id: row.accounting_entity_id, local_part: row.local_part, domain: row.domain, environment: row.environment }; }
  private rowWhere(row: Message) { return { id: row.id, organization_id: row.organization_id, store_id: row.store_id, accounting_entity_id: row.accounting_entity_id, inbox_id: row.inbox_id }; }
  private dailyWhere(storeId: number, date: Date) { const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); return { store_id: storeId, received_at: { gte: start, lt: new Date(start.getTime() + 86_400_000) } }; }
  private async quotaLock(tx: Prisma.TransactionClient, storeId: number, date: Date) { await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`email-quota:${storeId}:${date.toISOString().slice(0, 10)}`}))`; }
  private final(row: Message): boolean { return row.processed_at != null && !row.retryable && FINAL_STATUSES.has(row.status); }
  private enabled(): boolean { return this.config.get<string>('EMAIL_RECEPTION_ENABLED', 'false') === 'true'; }
  private positive(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
  private object(value: unknown): JsonRecord | null { return value != null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null; }
  private verdict(value: unknown): DocumentEmailTransportFacts['virus_status'] { const status = this.object(value)?.status; return ['PASS', 'FAIL', 'GRAY', 'PROCESSING_FAILED'].includes(status as string) ? status as DocumentEmailTransportFacts['virus_status'] : 'UNKNOWN'; }
  private securityReason(facts: DocumentEmailTransportFacts): DocumentEmailReasonCode | null { return facts.virus_status === 'FAIL' ? 'VIRUS_BLOCKED' : facts.virus_status !== 'PASS' ? 'SECURITY_SCAN_UNAVAILABLE' : facts.spam_status === 'FAIL' ? 'SUSPICIOUS_EMAIL' : facts.spam_status !== 'PASS' ? 'SECURITY_SCAN_UNAVAILABLE' : null; }
  private rejection(reason: DocumentEmailReasonCode): DocumentEmailProcessorResult { return { status: 'not_processed', reason_code: reason, retryable: false, parts: [], valid_document: false }; }
  private gateReason(error: unknown): DocumentEmailReasonCode | null { const code = (error as { errorCode?: string })?.errorCode; return code === 'EMAIL_RECEPTION_PAUSED' || code === 'EMAIL_RECEPTION_UNAVAILABLE' ? 'EMAIL_RECEPTION_PAUSED' : code === 'EMAIL_RECEPTION_FISCAL_GATE' ? 'FISCAL_GATE_BLOCKED' : code === 'EMAIL_RECEPTION_SUBSCRIPTION_BLOCKED' ? 'SUBSCRIPTION_BLOCKED' : null; }
  private rawTtl(row: Message, facts: DocumentEmailTransportFacts): number { return (row.reason_code === 'NOT_AN_INVOICE' || facts.spam_status === 'FAIL' ? 7 : 30) * 86_400_000; }
  private assertRunning(signal?: AbortSignal): void { if (this.stop.signal.aborted || signal?.aborted) throw new ConsumerInterrupted(); }

  private safeParts(value: unknown): DocumentEmailPartResult[] {
    if (!Array.isArray(value) || value.length > 40) throw new Error('Invalid parts checkpoint');
    return value.map((item) => {
      const p = this.object(item);
      if (!p || !Number.isInteger(p.message_index) || !Number.isInteger(p.ordinal) || typeof p.filename !== 'string' || p.filename.length > 120 || /[\x00-\x1f\x7f]/.test(p.filename) || !['xml', 'zip', 'pdf', 'eml', 'other'].includes(p.kind as string) || !DOCUMENT_EMAIL_STATES.includes(p.status as never)) throw new Error('Invalid part');
      const part: DocumentEmailPartResult = { message_index: p.message_index as number, ordinal: p.ordinal as number, filename: p.filename, kind: p.kind as DocumentEmailPartResult['kind'], status: p.status as DocumentEmailPartResult['status'] };
      if (typeof p.sha256 === 'string' && /^[a-f0-9]{64}$/.test(p.sha256)) part.sha256 = p.sha256;
      if (['container', 'commercial', 'dian_receipt', 'representation', 'complement'].includes(p.role as string)) part.role = p.role as DocumentEmailPartResult['role'];
      if (DOCUMENT_EMAIL_REASON_CODES.includes(p.reason_code as never)) part.reason_code = p.reason_code as DocumentEmailReasonCode;
      if (Array.isArray(p.warnings)) part.warnings = p.warnings.filter((code) => DOCUMENT_EMAIL_WARNINGS.includes(code as never)).slice(0, 4) as DocumentEmailPartResult['warnings'];
      if (this.positive(p.document_id)) part.document_id = p.document_id;
      if (Array.isArray(p.originals_checkpoint)) part.originals_checkpoint = p.originals_checkpoint.slice(0, 40).flatMap((checkpoint) => {
        const cp = this.object(checkpoint); return cp && typeof cp.sha256 === 'string' && /^[a-f0-9]{64}$/.test(cp.sha256) && typeof cp.stored === 'boolean' ? [{ sha256: cp.sha256, stored: cp.stored }] : [];
      });
      return part;
    });
  }
  private partsJson(parts: unknown, facts: DocumentEmailTransportFacts): Prisma.InputJsonValue {
    const safe = this.safeParts(parts);
    if (!safe.length) safe.push({ message_index: 0, ordinal: 0, filename: '', kind: 'other', status: 'received' });
    safe[0].transport_facts = facts;
    if (Buffer.byteLength(JSON.stringify(safe), 'utf8') > 128 * 1024) throw new Error('Parts budget exceeded');
    return safe as unknown as Prisma.InputJsonValue;
  }
  private checkpointFacts(parts: unknown): DocumentEmailTransportFacts | null {
    if (!Array.isArray(parts) || !parts.length) return null;
    const facts = this.object(this.object(parts[0])?.transport_facts);
    if (!facts || typeof facts.gmail_authenticated !== 'boolean') return null;
    return { virus_status: this.verdict({ status: facts.virus_status }), spam_status: this.verdict({ status: facts.spam_status }), gmail_authenticated: facts.gmail_authenticated, ...(this.positive(facts.retry_requested_version) ? { retry_requested_version: facts.retry_requested_version } : {}) };
  }
  private sanitizeText(value: unknown): string | null { return typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 255) || null : null; }
  private async boundedRead(stream: Readable, signal: AbortSignal): Promise<Buffer> {
    const chunks: Buffer[] = []; let total = 0;
    const abort = () => stream.destroy(new ConsumerInterrupted()); signal.addEventListener('abort', abort, { once: true });
    try {
      this.assertRunning(signal);
      for await (const chunk of stream) {
        this.assertRunning(signal);
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += bytes.length;
        if (total > MAX_RAW) throw new EmailLimitExceeded();
        chunks.push(bytes);
      }
      return Buffer.concat(chunks, total);
    } finally { signal.removeEventListener('abort', abort); stream.destroy(); }
  }

  private clients() {
    if (!this.aws) {
      const region = this.binding().region;
      this.aws = { sqs: new SQSClient({ region, requestHandler: { requestTimeout: 45_000, connectionTimeout: 5000 } }),
        s3: new S3Client({ region, requestHandler: { requestTimeout: 60_000, connectionTimeout: 5000 } }),
        metrics: new CloudWatchClient({ region, requestHandler: { requestTimeout: 5000, connectionTimeout: 2000 } }) };
    }
    return this.aws;
  }
  private awsTransport(receiptHandle?: string): DocumentEmailTransport {
    return { receipt_handle: receiptHandle,
      readRaw: async (bucket, key, signal) => {
        const response = await this.clients().s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal });
        if (!(response.Body instanceof Readable)) throw new Error('Missing readable raw');
        return response.Body;
      },
      delete: async (handle, signal) => { await this.clients().sqs.send(new DeleteMessageCommand({ QueueUrl: this.binding().queue, ReceiptHandle: handle }), { abortSignal: signal }); },
      renew: async (handle, signal) => { await this.clients().sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl: this.binding().queue, ReceiptHandle: handle, VisibilityTimeout: 120 }), { abortSignal: signal }); },
      sendRetry: async (payload, signal) => { await this.clients().sqs.send(new SendMessageCommand({ QueueUrl: this.binding().queue, MessageBody: JSON.stringify(payload) }), { abortSignal: signal }); },
      tagRaw: async (bucket, key, classification, signal) => { await this.clients().s3.send(new PutObjectTaggingCommand({ Bucket: bucket, Key: key, Tagging: { TagSet: [{ Key: 'email-reception-classification', Value: classification === 'noinvoice' ? 'non-invoice' : 'invoice' }] } }), { abortSignal: signal }); },
    };
  }
  private async publishHeartbeat(): Promise<void> {
    await this.metric('ConsumerHeartbeat');
    await this.metric('ConsumerMemoryPercent', process.memoryUsage().heapUsed / getHeapStatistics().heap_size_limit * 100);
  }
  private async metric(name: 'ConsumerHeartbeat' | 'ConsumerMemoryPercent' | 'ConsumerErrors' | 'StorageErrors', value = 1): Promise<void> {
    if (this.config.get<string>('NODE_ENV', 'development') === 'development' || !this.loopTask || this.stop.signal.aborted) return;
    try { await this.clients().metrics.send(new PutMetricDataCommand({ Namespace: 'Vendix/EmailReception', MetricData: [{ MetricName: name, Value: value, Unit: name === 'ConsumerMemoryPercent' ? 'Percent' : 'Count', Dimensions: [{ Name: 'Environment', Value: this.binding().environment }] }] }), { abortSignal: this.stop.signal }); } catch { this.logger.warn('Email metrics unavailable.'); }
  }
  private async backoff(): Promise<void> { await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 1000); const done = () => { clearTimeout(timer); this.stop.signal.removeEventListener('abort', done); resolve(); }; this.stop.signal.addEventListener('abort', done, { once: true }); }); }
}
