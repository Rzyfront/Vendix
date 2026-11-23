import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  AuditResource,
  AuditService,
} from '@common/audit/audit.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import {
  MESSAGING_PRICES_SETTINGS_KEY,
  SMS_FALLBACK_PRICE_PER_SEGMENT_USD,
  WHATSAPP_FALLBACK_PRICE_USD,
} from '../../../messaging/pricing/messaging-prices.constants';
import { resolveMessagingPrices } from '../../../messaging/pricing/messaging-prices.service';
import { UpdateMessagingPricesDto } from './dto/update-messaging-prices.dto';

const PRICE_FIELDS = [
  'sms_price_table',
  'sms_max_price_usd',
  'sms_max_price_margin',
  'whatsapp_price_table',
  'email_price_usd',
] as const;
type PriceField = (typeof PRICE_FIELDS)[number];

const TABLE_LABELS: Partial<Record<PriceField, string>> = {
  sms_price_table: 'SMS',
  whatsapp_price_table: 'WhatsApp',
};

type StoredPrices = Partial<Record<PriceField, unknown>> & {
  updated_by_user_id?: number | null;
  updated_at?: string;
};

const COUNTRY_KEY = /^\d{1,4}$/;

const isFinitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Key-order independent JSON, to compare stored values. */
function stable(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

@Injectable()
export class SuperadminMessagingPricesService {
  private readonly logger = new Logger(SuperadminMessagingPricesService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly config: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  async getPrices() {
    const row = await this.findRow();
    return this.toView(this.parseValue(row?.value), row?.updated_at ?? null);
  }

  async updatePrices(dto: UpdateMessagingPricesDto, userId: number | null) {
    const normalized = this.validate(dto);
    const row = await this.findRow();
    const previous = this.parseValue(row?.value) ?? {};
    const now = new Date();

    const next: StoredPrices = {
      ...previous,
      ...normalized,
      updated_by_user_id: userId,
      updated_at: now.toISOString(),
    };

    const saved = await this.prisma.platform_settings.upsert({
      where: { key: MESSAGING_PRICES_SETTINGS_KEY },
      create: {
        key: MESSAGING_PRICES_SETTINGS_KEY,
        value: next as unknown as Prisma.InputJsonValue,
        default_trial_days: 14,
        description: 'Messaging prices (SMS, WhatsApp, email) set by Superadmin',
      },
      update: {
        value: next as unknown as Prisma.InputJsonValue,
        updated_at: now,
      },
    });

    await this.auditUpdate(normalized, previous, userId, saved?.id);

    return this.toView(next, saved.updated_at);
  }

  /**
   * Validates every given field before anything is written. Returns the
   * values to store: `null` removes a field, an empty table becomes `null`.
   */
  private validate(
    dto: UpdateMessagingPricesDto,
  ): Partial<Record<PriceField, unknown>> {
    const out: Partial<Record<PriceField, unknown>> = {};
    for (const field of PRICE_FIELDS) {
      const raw = dto[field];
      if (raw === undefined) continue;
      if (raw === null) {
        out[field] = null;
        continue;
      }
      switch (field) {
        case 'sms_price_table':
        case 'whatsapp_price_table':
          out[field] = this.validateTable(field, raw);
          break;
        case 'sms_max_price_usd':
          if (!isFinitePositive(raw)) {
            throw new BadRequestException(
              'El tope por SMS debe ser un número mayor que 0',
            );
          }
          out[field] = raw;
          break;
        case 'sms_max_price_margin':
          if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) {
            throw new BadRequestException(
              'El margen del tope debe ser un número mayor o igual a 1',
            );
          }
          out[field] = raw;
          break;
        case 'email_price_usd':
          if (!isFinitePositive(raw)) {
            throw new BadRequestException(
              'El precio por correo debe ser un número mayor que 0',
            );
          }
          out[field] = raw;
          break;
      }
    }
    return out;
  }

  private validateTable(
    field: 'sms_price_table' | 'whatsapp_price_table',
    raw: unknown,
  ): Record<string, number> | null {
    const label = TABLE_LABELS[field];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BadRequestException(
        `La tabla de precios de ${label} debe ser un objeto de código de país a precio`,
      );
    }
    const entries = Object.entries(raw as Record<string, unknown>);
    for (const [key, price] of entries) {
      if (key !== 'default' && !COUNTRY_KEY.test(key)) {
        throw new BadRequestException(
          `Código de país inválido "${key}" en la tabla de precios de ${label}: use solo dígitos (1 a 4) o "default"`,
        );
      }
      if (!isFinitePositive(price)) {
        throw new BadRequestException(
          `El precio de "${key}" en la tabla de precios de ${label} debe ser un número mayor que 0`,
        );
      }
    }
    return entries.length === 0
      ? null
      : (Object.fromEntries(entries) as Record<string, number>);
  }

  /** One audit record per successful PATCH (values are prices, not secrets). */
  private async auditUpdate(
    changes: Partial<Record<PriceField, unknown>>,
    previous: StoredPrices,
    userId: number | null,
    rowId?: number,
  ): Promise<void> {
    const changedFields: string[] = [];
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    for (const field of PRICE_FIELDS) {
      if (!(field in changes)) continue;
      const before = previous[field] ?? null;
      const after = changes[field] ?? null;
      if (stable(before) === stable(after)) continue;
      changedFields.push(field);
      oldValues[field] = before;
      newValues[field] = after;
    }

    try {
      await this.auditService.log({
        userId: userId ?? undefined,
        action: AuditAction.UPDATE,
        resource: AuditResource.SETTINGS,
        resourceId: typeof rowId === 'number' ? rowId : undefined,
        oldValues,
        newValues,
        metadata: {
          key: MESSAGING_PRICES_SETTINGS_KEY,
          changed_fields: changedFields,
        },
      });
    } catch (error) {
      this.logger.error(
        `Audit write failed for ${MESSAGING_PRICES_SETTINGS_KEY}: ${(error as Error).message}`,
      );
    }
  }

  private findRow() {
    return this.prisma.platform_settings.findUnique({
      where: { key: MESSAGING_PRICES_SETTINGS_KEY },
    });
  }

  private parseValue(raw: unknown): StoredPrices | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as StoredPrices;
  }

  private toView(value: StoredPrices | null, updatedAt: Date | null) {
    return {
      key: MESSAGING_PRICES_SETTINGS_KEY,
      ...resolveMessagingPrices(value, this.config),
      fallbacks: {
        sms_per_segment_usd: SMS_FALLBACK_PRICE_PER_SEGMENT_USD,
        whatsapp_per_message_usd: WHATSAPP_FALLBACK_PRICE_USD,
      },
      updated_by_user_id: value?.updated_by_user_id ?? null,
      updated_at: value?.updated_at ?? updatedAt?.toISOString() ?? null,
    };
  }
}
