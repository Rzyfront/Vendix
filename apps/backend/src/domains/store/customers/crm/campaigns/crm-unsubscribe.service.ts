import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { GlobalPrismaService } from '../../../../../prisma/services/global-prisma.service';
import { AuditService } from '../../../../../common/audit/audit.service';

export type UnsubscribeChannel = 'whatsapp' | 'sms' | 'email';

export interface UnsubscribePayload {
  store_id: number;
  customer_id: number;
  channel: UnsubscribeChannel;
}

const DEV_SECRET = 'vendix-dev-crm-unsubscribe';
const CHANNELS: UnsubscribeChannel[] = ['whatsapp', 'sms', 'email'];
const CONSENT_FIELD = {
  whatsapp: 'whatsapp_consent',
  sms: 'sms_consent',
  email: 'email_consent',
} as const;

/**
 * Opt-out of marketing (PLAN-CRM §5.3, §6). Every campaign email carries a
 * signed link (HMAC-SHA256 with `CRM_UNSUBSCRIBE_SECRET`) to
 * `/api/public/crm/unsubscribe`; opening it sets the customer's consent for
 * that store and channel to `opted_out`. The token names store, customer and
 * channel, so it cannot unsubscribe anyone else. WhatsApp keyword opt-outs
 * (`BAJA`, `STOP`) go through {@link optOut} too.
 */
@Injectable()
export class CrmUnsubscribeService {
  private readonly logger = new Logger(CrmUnsubscribeService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  token(payload: UnsubscribePayload): string {
    const body = Buffer.from(
      `${payload.store_id}.${payload.customer_id}.${payload.channel}`,
    ).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  verify(token: string | undefined | null): UnsubscribePayload | null {
    if (!token || token.length > 300) return null;
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra !== undefined) return null;
    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return null;
    }
    const [store, customer, channel] = Buffer.from(body, 'base64url')
      .toString('utf8')
      .split('.');
    const storeId = Number(store);
    const customerId = Number(customer);
    if (
      !Number.isInteger(storeId) ||
      storeId <= 0 ||
      !Number.isInteger(customerId) ||
      customerId <= 0 ||
      !CHANNELS.includes(channel as UnsubscribeChannel)
    ) {
      return null;
    }
    return { store_id: storeId, customer_id: customerId, channel: channel as UnsubscribeChannel };
  }

  url(payload: UnsubscribePayload): string {
    const configured = this.config.get<string>('CRM_PUBLIC_API_URL')?.trim();
    const frontend = this.config.get<string>('FRONTEND_URL')?.trim();
    const base = (configured || (frontend ? `${frontend.replace(/\/+$/, '')}/api` : '')).replace(/\/+$/, '');
    return `${base}/public/crm/unsubscribe?t=${encodeURIComponent(this.token(payload))}`;
  }

  /** Plain-text footer the email provider turns into HTML. */
  appendFooter(body: string, payload: UnsubscribePayload): string {
    return `${body.trimEnd()}\n\n—\nSi no quieres recibir más correos de esta tienda, date de baja aquí: ${this.url(payload)}`;
  }

  /**
   * Sets the consent to `opted_out`; repeating it changes nothing. Returns
   * false when the customer is not a customer of that store.
   */
  async optOut(payload: UnsubscribePayload, source: string): Promise<boolean> {
    const field = CONSENT_FIELD[payload.channel];
    const link = await this.prisma.store_users.findFirst({
      where: { store_id: payload.store_id, user_id: payload.customer_id },
      select: { id: true, whatsapp_consent: true, sms_consent: true, email_consent: true },
    });
    if (!link) return false;
    const previous = link[field];
    if (previous === 'opted_out') return true;

    const data: Prisma.store_usersUpdateManyMutationInput = { consent_updated_at: new Date() };
    if (field === 'whatsapp_consent') data.whatsapp_consent = 'opted_out';
    else if (field === 'sms_consent') data.sms_consent = 'opted_out';
    else data.email_consent = 'opted_out';

    await this.prisma.store_users.updateMany({ where: { id: link.id }, data });
    await this.audit.log({
      storeId: payload.store_id,
      action: 'UPDATE',
      resource: 'store_users',
      resourceId: payload.customer_id,
      oldValues: { [field]: previous },
      newValues: { [field]: 'opted_out' },
      metadata: { reason: 'crm_marketing_opt_out', source },
    });
    return true;
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret()).update(body).digest('base64url');
  }

  /** Required in production: a guessable secret would let anyone unsubscribe anyone. */
  private secret(): string {
    const secret = this.config.get<string>('CRM_UNSUBSCRIBE_SECRET')?.trim();
    if (secret) return secret;
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new Error('CRM_UNSUBSCRIBE_SECRET is required in production');
    }
    this.logger.warn('CRM_UNSUBSCRIBE_SECRET is not set; using the development secret');
    return DEV_SECRET;
  }
}
