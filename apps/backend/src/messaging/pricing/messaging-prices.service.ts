import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { SmsPriceTable, parseSmsPriceTable } from '../utils/sms.util';
import {
  EMAIL_FALLBACK_PRICE_USD,
  MESSAGING_PRICES_SETTINGS_KEY,
  SMS_FALLBACK_MAX_PRICE_MARGIN,
  SMS_FALLBACK_MAX_PRICE_USD,
} from './messaging-prices.constants';

export type MessagingPriceSource =
  | 'platform_settings'
  | 'environment'
  | 'default';

export interface ResolvedPrice<T> {
  value: T;
  source: MessagingPriceSource;
}

export interface ResolvedMessagingPrices {
  sms_price_table: ResolvedPrice<SmsPriceTable>;
  sms_max_price_usd: ResolvedPrice<number>;
  sms_max_price_margin: ResolvedPrice<number>;
  whatsapp_price_table: ResolvedPrice<SmsPriceTable>;
  email_price_usd: ResolvedPrice<number>;
}

interface EnvReader {
  get<T = string>(key: string): T | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Panel/env table: valid when it keeps at least one valid entry. */
function panelTable(raw: unknown): SmsPriceTable | null {
  if (!isRecord(raw)) return null;
  // Same entry rules as the environment variable: one parser for both.
  const table = parseSmsPriceTable(JSON.stringify(raw));
  return Object.keys(table).length > 0 ? table : null;
}

function positive(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? raw
    : null;
}

function atLeastOne(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1
    ? raw
    : null;
}

function envNumber(
  config: EnvReader,
  key: string,
  accept: (raw: unknown) => number | null,
): number | null {
  const raw = config.get<string>(key);
  return raw ? accept(Number(raw)) : null;
}

function pick<T>(
  panel: T | null,
  env: T | null,
  fallback: T,
): ResolvedPrice<T> {
  if (panel !== null) return { value: panel, source: 'platform_settings' };
  if (env !== null) return { value: env, source: 'environment' };
  return { value: fallback, source: 'default' };
}

/**
 * Pure resolution of the five prices from a stored row value: the panel wins
 * field by field, the environment is the fallback, then the code default. An
 * invalid stored value is ignored so it can never cheapen or disable an SMS.
 */
export function resolveMessagingPrices(
  rowValue: unknown,
  config: EnvReader,
): ResolvedMessagingPrices {
  const row = isRecord(rowValue) ? rowValue : {};
  const envTable = (key: string): SmsPriceTable | null => {
    const table = parseSmsPriceTable(config.get<string>(key));
    return Object.keys(table).length > 0 ? table : null;
  };

  return {
    sms_price_table: pick(
      panelTable(row.sms_price_table),
      envTable('SNS_SMS_PRICE_TABLE'),
      {},
    ),
    sms_max_price_usd: pick(
      positive(row.sms_max_price_usd),
      envNumber(config, 'SNS_SMS_MAX_PRICE_USD', positive),
      SMS_FALLBACK_MAX_PRICE_USD,
    ),
    sms_max_price_margin: pick(
      atLeastOne(row.sms_max_price_margin),
      envNumber(config, 'SNS_SMS_MAX_PRICE_MARGIN', atLeastOne),
      SMS_FALLBACK_MAX_PRICE_MARGIN,
    ),
    whatsapp_price_table: pick(
      panelTable(row.whatsapp_price_table),
      envTable('CRM_WHATSAPP_PRICE_TABLE'),
      {},
    ),
    email_price_usd: pick(
      positive(row.email_price_usd),
      envNumber(config, 'CRM_EMAIL_PRICE_USD', positive),
      EMAIL_FALLBACK_PRICE_USD,
    ),
  };
}

/**
 * Single source of truth for the SMS, WhatsApp and email prices. Reads the
 * `messaging:prices` row on every call (no cache) so the API and the worker
 * see a Superadmin change at once.
 */
@Injectable()
export class MessagingPricesService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly config: ConfigService,
  ) {}

  async resolve(): Promise<ResolvedMessagingPrices> {
    const row = await this.prisma.platform_settings.findUnique({
      where: { key: MESSAGING_PRICES_SETTINGS_KEY },
    });
    return resolveMessagingPrices(row?.value, this.config);
  }
}
