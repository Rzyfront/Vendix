import { Injectable, Logger } from '@nestjs/common';
import { EncryptionService } from '../../../../common/services/encryption.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  OUTBOX_BACKOFF_MINUTES,
  OUTBOX_MAX_ATTEMPTS,
} from '../engine/workflow-outbox.dispatcher.constants';
import {
  WEBHOOK_STORED_TEXT_MAX,
  WebhookBody,
} from './workflow-webhook.constants';
import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  buildSignatureHeader,
} from './webhook-signature';
import { WebhookTransport, httpsWebhookTransport } from './webhook-transport';
import { WebhookUrlError, assertWebhookUrl } from './webhook-url-policy';

export interface WebhookOutboxRow {
  id: number;
  store_id: number;
  attempts: number;
  payload: Record<string, any>;
}

/** Thrown to make the outbox retry; the message is what the panel shows. */
export class WebhookDeliveryError extends Error {}

function clip(text: string): string {
  return text.length > WEBHOOK_STORED_TEXT_MAX
    ? `${text.slice(0, WEBHOOK_STORED_TEXT_MAX)}…`
    : text;
}

/**
 * Performs one webhook attempt for an outbox row of kind `webhook`. Success
 * (2xx) marks the delivery `delivered`. Anything else records the status code /
 * error on the delivery row and throws, so `workflow_outbox` retries with its
 * own backoff (1m, 5m, 30m, 2h, 12h) and the delivery is `dead` after the sixth
 * attempt. Runs inside the store context of the row.
 */
@Injectable()
export class WorkflowWebhookDeliveryService {
  private readonly logger = new Logger(WorkflowWebhookDeliveryService.name);

  /** Replaced in tests; production uses the vetted https transport. */
  transport: WebhookTransport = httpsWebhookTransport;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async deliver(row: WebhookOutboxRow, now = new Date()): Promise<void> {
    const deliveryId = Number(row.payload.delivery_id);
    const delivery = await this.prisma.workflow_webhook_deliveries.findFirst({
      where: { id: deliveryId, store_id: row.store_id },
    });
    if (!delivery || delivery.status === 'delivered') return;
    const endpoint = await this.prisma.workflow_webhook_endpoints.findFirst({
      where: { id: delivery.endpoint_id, store_id: row.store_id },
    });
    const attempts = delivery.attempts + 1;
    const isLast = row.attempts >= OUTBOX_MAX_ATTEMPTS;

    const finish = (data: Record<string, unknown>) =>
      this.prisma.workflow_webhook_deliveries.updateMany({
        where: { id: deliveryId, store_id: row.store_id },
        data: { attempts, ...data },
      });

    if (!endpoint || !endpoint.is_active) {
      await finish({
        status: 'dead',
        last_error: 'Endpoint disabled or deleted',
        next_retry_at: null,
      });
      return; // permanent: do not retry
    }

    try {
      assertWebhookUrl(endpoint.url);
    } catch (e) {
      if (e instanceof WebhookUrlError) {
        await finish({
          status: 'dead',
          last_error: clip(e.message),
          next_retry_at: null,
        });
        return; // permanent: the URL itself is not allowed
      }
      throw e;
    }

    const body = JSON.stringify(delivery.payload as unknown as WebhookBody);
    const timestamp = Math.floor(now.getTime() / 1000);
    let secret: string;
    try {
      secret = this.encryption.decrypt(endpoint.secret_enc);
    } catch {
      await finish({
        status: 'dead',
        last_error: 'Signing secret could not be decrypted; rotate it',
        next_retry_at: null,
      });
      return;
    }

    let status = 0;
    let failure: string;
    try {
      const res = await this.transport({
        url: endpoint.url,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Vendix-Webhooks/1.0',
          [WEBHOOK_SIGNATURE_HEADER]: buildSignatureHeader(
            secret,
            timestamp,
            body,
          ),
          [WEBHOOK_EVENT_HEADER]: delivery.event_type,
          [WEBHOOK_DELIVERY_HEADER]: String(delivery.id),
        },
        body,
      });
      status = res.status;
      if (res.status >= 200 && res.status < 300) {
        await finish({
          status: 'delivered',
          status_code: res.status,
          last_error: null,
          next_retry_at: null,
          delivered_at: now,
        });
        return;
      }
      failure = `HTTP ${res.status}${res.body ? `: ${res.body.replace(/\s+/g, ' ')}` : ''}`;
    } catch (e) {
      failure = (e as Error)?.message ?? 'Request failed';
    }

    const delayMin =
      OUTBOX_BACKOFF_MINUTES[
        Math.min(row.attempts, OUTBOX_BACKOFF_MINUTES.length) - 1
      ];
    await finish({
      status: isLast ? 'dead' : 'failed',
      status_code: status || null,
      last_error: clip(failure),
      next_retry_at: isLast
        ? null
        : new Date(now.getTime() + delayMin * 60_000),
    });
    throw new WebhookDeliveryError(clip(failure));
  }
}
