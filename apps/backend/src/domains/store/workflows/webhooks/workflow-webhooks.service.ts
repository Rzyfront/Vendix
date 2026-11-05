import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { EncryptionService } from '../../../../common/services/encryption.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  MAX_ACTIVE_WEBHOOK_ENDPOINTS,
  WEBHOOK_SECRET_PREFIX,
  WORKFLOW_WEBHOOK_EVENTS,
  WORKFLOW_WEBHOOK_PING,
  WebhookBody,
} from './workflow-webhook.constants';
import {
  CreateWebhookDto,
  UpdateWebhookDto,
  WebhookDeliveriesQueryDto,
} from './workflow-webhook.dto';
import { WorkflowWebhookEmitter } from './workflow-webhook-emitter.service';
import {
  DnsResolver,
  WebhookUrlError,
  assertWebhookUrl,
  resolveAndVet,
} from './webhook-url-policy';

/** Never select the encrypted secret: only the delivery service reads it. */
const PUBLIC_SELECT = {
  id: true,
  url: true,
  event_types: true,
  is_active: true,
  description: true,
  created_by_user_id: true,
  created_at: true,
  updated_at: true,
} as const;

const DELIVERY_SELECT = {
  id: true,
  endpoint_id: true,
  event_id: true,
  event_type: true,
  status: true,
  attempts: true,
  status_code: true,
  last_error: true,
  next_retry_at: true,
  delivered_at: true,
  created_at: true,
} as const;

/** `whsec_` + 32 random bytes, base64url. Shown once. */
export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** Management of the store's outgoing webhooks (`store:integrations:api_keys`). */
@Injectable()
export class WorkflowWebhooksService {
  /** Replaced in tests. */
  resolver?: DnsResolver;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly encryption: EncryptionService,
    private readonly emitter: WorkflowWebhookEmitter,
  ) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id || !c.user_id) {
      throw new VendixHttpException(ErrorCodes.WEBHOOK_NOT_FOUND);
    }
    return {
      store_id: c.store_id,
      organization_id: c.organization_id,
      user_id: c.user_id,
    };
  }

  /** Static policy + DNS vetting (early feedback; the send path re-vets). */
  private async assertUrl(raw: string): Promise<string> {
    try {
      const url = assertWebhookUrl(raw);
      await resolveAndVet(url.hostname, this.resolver);
      return url.toString();
    } catch (e) {
      if (e instanceof WebhookUrlError) {
        throw new VendixHttpException(
          ErrorCodes.WEBHOOK_URL_INVALID,
          e.message,
        );
      }
      // DNS failure (ENOTFOUND, timeouts...)
      throw new VendixHttpException(
        ErrorCodes.WEBHOOK_URL_INVALID,
        'Webhook URL not allowed: host does not resolve',
      );
    }
  }

  private assertEvents(events: string[]) {
    const known = WORKFLOW_WEBHOOK_EVENTS as readonly string[];
    if (events.length === 0 || !events.every((e) => known.includes(e))) {
      throw new VendixHttpException(ErrorCodes.WEBHOOK_EVENT_INVALID);
    }
  }

  async list() {
    const { store_id } = this.ctx();
    return this.prisma.workflow_webhook_endpoints.findMany({
      where: { store_id },
      select: PUBLIC_SELECT,
      orderBy: { created_at: 'desc' },
    });
  }

  /** Returns the signing secret exactly once. */
  async create(dto: CreateWebhookDto) {
    const { store_id, organization_id, user_id } = this.ctx();
    const url = await this.assertUrl(dto.url);
    const events = [...new Set(dto.event_types ?? [])];
    this.assertEvents(events);
    const secret = generateWebhookSecret();
    const secret_enc = this.encryption.encrypt(secret);

    // Count + insert under a lock on the store row: two concurrent creations
    // cannot both pass the cap.
    const row = await this.prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT id FROM stores WHERE id = ${store_id} FOR NO KEY UPDATE`;
      await this.assertRoom(tx, store_id);
      return tx.workflow_webhook_endpoints.create({
        data: {
          organization_id,
          store_id,
          url,
          secret_enc,
          event_types: events,
          is_active: true,
          description: dto.description?.trim() || null,
          created_by_user_id: user_id,
        },
        select: PUBLIC_SELECT,
      });
    });
    return { ...row, secret };
  }

  private async assertRoom(tx: any, store_id: number) {
    const active = await tx.workflow_webhook_endpoints.count({
      where: { store_id, is_active: true },
    });
    if (active >= MAX_ACTIVE_WEBHOOK_ENDPOINTS) {
      throw new VendixHttpException(ErrorCodes.WEBHOOK_LIMIT_REACHED);
    }
  }

  private async find(id: number, store_id: number) {
    const row = await this.prisma.workflow_webhook_endpoints.findFirst({
      where: { id, store_id },
      select: PUBLIC_SELECT,
    });
    if (!row) throw new VendixHttpException(ErrorCodes.WEBHOOK_NOT_FOUND);
    return row;
  }

  async update(id: number, dto: UpdateWebhookDto) {
    const { store_id } = this.ctx();
    const current = await this.find(id, store_id);
    const data: Record<string, unknown> = {};
    if (dto.url !== undefined) data.url = await this.assertUrl(dto.url);
    if (dto.event_types !== undefined) {
      const events = [...new Set(dto.event_types)];
      this.assertEvents(events);
      data.event_types = events;
    }
    if (dto.description !== undefined)
      data.description = dto.description.trim() || null;
    const reactivating = dto.is_active === true && !current.is_active;
    if (dto.is_active !== undefined) data.is_active = dto.is_active;
    if (Object.keys(data).length === 0) return current;

    await this.prisma.$transaction(async (tx: any) => {
      if (reactivating) {
        await tx.$queryRaw`SELECT id FROM stores WHERE id = ${store_id} FOR NO KEY UPDATE`;
        await this.assertRoom(tx, store_id);
      }
      await tx.workflow_webhook_endpoints.updateMany({
        where: { id, store_id },
        data,
      });
    });
    return this.find(id, store_id);
  }

  /** The new secret replaces the old one immediately and is shown once. */
  async rotateSecret(id: number) {
    const { store_id } = this.ctx();
    await this.find(id, store_id);
    const secret = generateWebhookSecret();
    await this.prisma.workflow_webhook_endpoints.updateMany({
      where: { id, store_id },
      data: { secret_enc: this.encryption.encrypt(secret) },
    });
    return { ...(await this.find(id, store_id)), secret };
  }

  /** Soft delete: the endpoint stops receiving events, its history stays. */
  async remove(id: number) {
    const { store_id } = this.ctx();
    await this.find(id, store_id);
    await this.prisma.workflow_webhook_endpoints.updateMany({
      where: { id, store_id },
      data: { is_active: false },
    });
    return this.find(id, store_id);
  }

  /** Sends a `ping` event to this endpoint through the normal delivery path. */
  async test(id: number) {
    const { store_id } = this.ctx();
    const endpoint = await this.find(id, store_id);
    if (!endpoint.is_active)
      throw new VendixHttpException(ErrorCodes.WEBHOOK_INACTIVE);
    const body: WebhookBody = {
      event_id: randomUUID(),
      occurred_at: new Date().toISOString(),
      store_id,
      type: WORKFLOW_WEBHOOK_PING,
      data: { message: 'Vendix webhook test', webhook_id: id },
    };
    const delivery_id = await this.prisma.$transaction((tx: any) =>
      this.emitter.enqueueDelivery(tx, store_id, id, body),
    );
    return { delivery_id, event_id: body.event_id };
  }

  async deliveries(id: number, query: WebhookDeliveriesQueryDto) {
    const { store_id } = this.ctx();
    await this.find(id, store_id);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      store_id,
      endpoint_id: id,
      ...(query.status && { status: query.status }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.workflow_webhook_deliveries.count({ where }),
      this.prisma.workflow_webhook_deliveries.findMany({
        where,
        select: DELIVERY_SELECT,
        orderBy: { id: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      data: rows.map((r: any) => ({ ...r, id: Number(r.id) })),
      total,
      page,
      limit,
    };
  }

  /** Re-queues a failed / dead delivery with the SAME event_id and body. */
  async retryDelivery(deliveryId: number) {
    const { store_id } = this.ctx();
    const delivery = await this.prisma.workflow_webhook_deliveries.findFirst({
      where: { id: deliveryId, store_id },
      select: { id: true, status: true, endpoint_id: true },
    });
    if (!delivery)
      throw new VendixHttpException(ErrorCodes.WEBHOOK_DELIVERY_NOT_FOUND);
    if (delivery.status !== 'failed' && delivery.status !== 'dead') {
      throw new VendixHttpException(ErrorCodes.WEBHOOK_DELIVERY_NOT_RETRYABLE);
    }
    const endpoint = await this.find(delivery.endpoint_id, store_id);
    if (!endpoint.is_active)
      throw new VendixHttpException(ErrorCodes.WEBHOOK_INACTIVE);
    await this.prisma.$transaction(async (tx: any) => {
      const reset = await tx.workflow_webhook_deliveries.updateMany({
        where: { id: deliveryId, store_id, status: { in: ['failed', 'dead'] } },
        data: { status: 'pending', next_retry_at: null },
      });
      if (reset.count === 0) {
        throw new VendixHttpException(
          ErrorCodes.WEBHOOK_DELIVERY_NOT_RETRYABLE,
        );
      }
      await this.emitter.enqueueOutbox(tx, store_id, deliveryId);
    });
    return { delivery_id: deliveryId, status: 'pending' };
  }
}
