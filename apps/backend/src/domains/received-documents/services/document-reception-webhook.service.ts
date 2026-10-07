import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EncryptionService } from '../../../common/services/encryption.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { SubscriptionAccessService } from '../../store/subscriptions/services/subscription-access.service';
import { DocumentReceptionEnvelopeService } from './document-reception-envelope.service';
import { DocumentReceptionSyncLeaseService } from './document-reception-sync-lease.service';
import type { ReceivedDocumentsContext } from '../received-documents.service';

const MAX_RAW_BODY_BYTES = 5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UNIX_SECONDS = /^\d{10}$/;
const SHA256_HEADER = /^sha256=([0-9a-f]{64})$/;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

interface WebhookHeaders {
  timestamp: string;
  event_id: string;
  signature: string;
}

interface ReceptionWebhookConnection {
  id: number;
  organization_id: number;
  store_id: number | null;
  accounting_entity_id: number;
  version: number;
  encrypted_secret: string | null;
  connection_type: string;
  enabled: boolean;
}

/** Authenticated ingress foundation. It persists an envelope only; it does not process documents. */
@Injectable()
export class DocumentReceptionWebhookService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly encryption: EncryptionService,
    private readonly leases: DocumentReceptionSyncLeaseService,
    private readonly subscriptionAccess: SubscriptionAccessService,
    private readonly envelopes: DocumentReceptionEnvelopeService,
  ) {}

  async accept(
    publicToken: string,
    headers: WebhookHeaders,
    rawBody: Buffer,
  ): Promise<{ run_id: number; duplicate: boolean }> {
    if (!this.validUuid(publicToken)) throw this.authenticationFailed();
    if (!Buffer.isBuffer(rawBody) || rawBody.length < 1 || rawBody.length > MAX_RAW_BODY_BYTES) {
      throw new BadRequestException('Webhook payload size is invalid.');
    }
    if (!this.validHeaders(headers)) throw this.authenticationFailed();

    let connection: ReceptionWebhookConnection | null;
    try {
      connection = await this.prisma.withoutScope().document_reception_connections.findUnique({
        where: { public_token: publicToken },
        select: {
          id: true,
          organization_id: true,
          store_id: true,
          accounting_entity_id: true,
          version: true,
          encrypted_secret: true,
          connection_type: true,
          enabled: true,
        },
      }) as ReceptionWebhookConnection | null;
    } catch {
      throw new ServiceUnavailableException('Webhook authentication is temporarily unavailable.');
    }

    if (!connection || !connection.enabled || connection.connection_type !== 'webhook' || !connection.encrypted_secret) {
      throw this.authenticationFailed();
    }

    let secret: string;
    try {
      secret = this.encryption.decrypt(connection.encrypted_secret);
    } catch {
      throw this.authenticationFailed();
    }
    if (!this.validSignature(secret, headers, rawBody)) throw this.authenticationFailed();

    let context: ReceivedDocumentsContext;
    try {
      context = await this.leases.getWorkerContext(connection.id);
    } catch (error) {
      if (error instanceof ForbiddenException) throw this.authenticationFailed();
      throw new ServiceUnavailableException('Webhook reception context is temporarily unavailable.');
    }
    if (
      context.organization_id !== connection.organization_id ||
      context.store_id !== connection.store_id ||
      context.accounting_entity_id !== connection.accounting_entity_id ||
      context.store_id == null
    ) {
      throw this.authenticationFailed();
    }

    let access: Awaited<ReturnType<SubscriptionAccessService['canUseModule']>>;
    try {
      access = await this.subscriptionAccess.canUseModule(context.store_id, 'received_documents');
    } catch {
      throw new ServiceUnavailableException('Webhook subscription access is temporarily unavailable.');
    }
    if (access.reason === 'SUBSCRIPTION_INTERNAL_ERROR') {
      throw new ServiceUnavailableException('Webhook subscription access is temporarily unavailable.');
    }
    if (access.mode === 'block') {
      throw new ForbiddenException('Webhook reception is not available.');
    }

    const envelope = this.envelopes.decode(rawBody);
    const inputPayload: Prisma.InputJsonObject = {
      version: 1,
      documents: envelope.documents.map((document) => ({
        external_id: document.external_id,
        file_name: document.file_name,
        mime_type: document.mime_type,
        content_base64: document.content.toString('base64'),
      })),
      next_cursor: envelope.next_cursor,
    };
    const payloadSha256 = createHash('sha256').update(rawBody).digest('hex');
    const result = await this.leases.claim(context, connection.id, {
      trigger: 'webhook',
      idempotency_key: `webhook:${headers.event_id}`,
      input_payload: inputPayload,
      payload_sha256: payloadSha256,
      expected_version: connection.version,
    });
    return { run_id: result.run_id, duplicate: result.duplicate };
  }

  protected currentTimeMs(): number { return Date.now(); }

  private validHeaders(value: WebhookHeaders | null | undefined): value is WebhookHeaders {
    if (!value || typeof value.timestamp !== 'string' || typeof value.event_id !== 'string' || typeof value.signature !== 'string') return false;
    if (!UNIX_SECONDS.test(value.timestamp) || !this.validUuid(value.event_id) || !SHA256_HEADER.test(value.signature)) return false;
    const timestampMs = Number(value.timestamp) * 1000;
    return Number.isSafeInteger(timestampMs) && Math.abs(this.currentTimeMs() - timestampMs) <= MAX_CLOCK_SKEW_MS;
  }

  private validSignature(secret: string, headers: WebhookHeaders, rawBody: Buffer): boolean {
    const match = SHA256_HEADER.exec(headers.signature);
    if (!match) return false;
    const provided = Buffer.from(match[1], 'hex');
    if (provided.length !== 32) return false;
    const prefix = Buffer.from(`${headers.timestamp}.${headers.event_id}.`, 'utf8');
    const expected = createHmac('sha256', secret).update(prefix).update(rawBody).digest();
    return timingSafeEqual(expected, provided);
  }

  private validUuid(value: unknown): value is string {
    return typeof value === 'string' && UUID.test(value);
  }

  private authenticationFailed(): ForbiddenException {
    return new ForbiddenException('Webhook authentication failed.');
  }
}
