import {
  SmsPriceTable,
  estimateSmsCost,
  normalizeE164,
  pricePerSegment,
} from '../../../../../messaging/utils/sms.util';
import {
  EMAIL_FALLBACK_PRICE_USD,
  SMS_FALLBACK_PRICE_PER_SEGMENT_USD,
  WHATSAPP_FALLBACK_PRICE_USD as WHATSAPP_FALLBACK,
} from '../../../../../messaging/pricing/messaging-prices.constants';
import type { SegmentRecipientRow } from '../segments/crm-segment-query.service';

export const CAMPAIGN_CHANNELS = ['whatsapp', 'sms', 'email'] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

export const PROVIDER_BY_CAMPAIGN_CHANNEL: Record<CampaignChannel, string> = {
  whatsapp: 'meta_cloud',
  sms: 'sns_sms',
  email: 'ses_email',
};

/**
 * Closed catalog of per-recipient placeholders for body, subject and template
 * variables. Any other `{…}` token is rejected, never sent literally.
 */
export const CAMPAIGN_PLACEHOLDERS = ['first_name', 'last_name', 'store_name'] as const;
const PLACEHOLDER_PATTERN = /\{([a-z_]+)\}/g;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Fallback prices (USD), deliberately on the high side: an estimate never undershoots. */
export const WHATSAPP_FALLBACK_PRICE_USD = WHATSAPP_FALLBACK;
export const EMAIL_DEFAULT_PRICE_USD = EMAIL_FALLBACK_PRICE_USD;

export interface CampaignRecipient {
  customer_id: number;
  address: string;
  first_name: string;
  last_name: string;
}

export interface CampaignAudience {
  eligible: CampaignRecipient[];
  /** Opted out of the channel, or (WhatsApp marketing) not explicitly opted in. */
  excluded_no_consent: number;
  excluded_no_address: number;
  /** Second customer with the same phone or email: each address gets one message. */
  excluded_duplicate: number;
}

/**
 * Who a campaign may reach (PLAN-CRM §6, Ley 1581): an `opted_out` customer
 * is never a recipient, whatever segment they are in; WhatsApp marketing
 * further needs an explicit `opted_in`. Evaluated again when the campaign is
 * dispatched and once more, per message, by `MessagingService`.
 */
export function buildAudience(
  rows: SegmentRecipientRow[],
  channel: CampaignChannel,
  defaultCountryCode = '57',
): CampaignAudience {
  const audience: CampaignAudience = {
    eligible: [],
    excluded_no_consent: 0,
    excluded_no_address: 0,
    excluded_duplicate: 0,
  };
  const seen = new Set<string>();
  for (const row of rows) {
    if (!hasMarketingConsent(channel, consentOf(row, channel))) {
      audience.excluded_no_consent += 1;
      continue;
    }
    const address = addressOf(row, channel, defaultCountryCode);
    if (!address) {
      audience.excluded_no_address += 1;
      continue;
    }
    if (seen.has(address)) {
      audience.excluded_duplicate += 1;
      continue;
    }
    seen.add(address);
    audience.eligible.push({
      customer_id: row.id,
      address,
      first_name: row.first_name,
      last_name: row.last_name,
    });
  }
  return audience;
}

export function hasMarketingConsent(
  channel: CampaignChannel,
  consent: string | null | undefined,
): boolean {
  if (channel === 'whatsapp') return consent === 'opted_in';
  return consent !== 'opted_out';
}

function consentOf(row: SegmentRecipientRow, channel: CampaignChannel): string {
  if (channel === 'whatsapp') return row.whatsapp_consent;
  if (channel === 'sms') return row.sms_consent;
  return row.email_consent;
}

function addressOf(
  row: SegmentRecipientRow,
  channel: CampaignChannel,
  defaultCountryCode: string,
): string | null {
  if (channel === 'email') {
    const email = row.email?.trim().toLowerCase();
    return email && EMAIL_PATTERN.test(email) ? email : null;
  }
  return normalizeE164(row.phone, defaultCountryCode);
}

/** Unknown placeholders in `text`, e.g. `{password}`. */
export function unknownPlaceholders(text: string | null | undefined): string[] {
  if (!text) return [];
  const unknown = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    if (!(CAMPAIGN_PLACEHOLDERS as readonly string[]).includes(match[1])) {
      unknown.add(match[0]);
    }
  }
  return [...unknown];
}

export function renderPlaceholders(
  text: string,
  recipient: Pick<CampaignRecipient, 'first_name' | 'last_name'>,
  storeName: string,
): string {
  const values: Record<string, string> = {
    first_name: recipient.first_name?.trim() ?? '',
    last_name: recipient.last_name?.trim() ?? '',
    store_name: storeName,
  };
  return text.replace(PLACEHOLDER_PATTERN, (token, key: string) =>
    key in values ? values[key] : token,
  );
}

/** Already-parsed prices (see `MessagingPricesService.resolve()`). */
export interface CostConfig {
  sms_price_table?: SmsPriceTable;
  whatsapp_price_table?: SmsPriceTable;
  email_price_usd?: number;
}

export interface CampaignContent {
  channel: CampaignChannel;
  body?: string | null;
}

/**
 * Estimated cost in USD of sending `content` to every eligible recipient,
 * rounded up to the 4 decimals of the SMS spend counter. SMS uses the same
 * segment count and price table the `sns_sms` provider reserves with, on the
 * rendered text of each recipient.
 */
export function estimateCampaignCost(
  audience: CampaignRecipient[],
  content: CampaignContent,
  storeName: string,
  config: CostConfig,
): number {
  let total = 0;
  if (content.channel === 'sms') {
    const table = config.sms_price_table ?? {};
    for (const recipient of audience) {
      const text = renderPlaceholders(content.body ?? '', recipient, storeName);
      total += estimateSmsCost(recipient.address, text, table, SMS_FALLBACK_PRICE_PER_SEGMENT_USD).cost;
    }
  } else if (content.channel === 'whatsapp') {
    const table = config.whatsapp_price_table ?? {};
    for (const recipient of audience) {
      total += pricePerSegment(recipient.address, table, WHATSAPP_FALLBACK_PRICE_USD);
    }
  } else {
    const price =
      config.email_price_usd && config.email_price_usd > 0
        ? config.email_price_usd
        : EMAIL_DEFAULT_PRICE_USD;
    total = audience.length * price;
  }
  return Math.ceil(Number((total * 10_000).toFixed(6))) / 10_000;
}
