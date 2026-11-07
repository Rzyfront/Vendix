import { isEmail } from 'class-validator';

/** Rules shared by the connector actions and their "Probar" endpoints. */
export const CONNECTOR_LIMITS = {
  maxRecipients: 10,
  maxSubject: 200,
  maxBody: 20_000,
  maxTemplateParams: 20,
} as const;

/** Minimal shape of the social channel row the WhatsApp connector needs. */
export interface WhatsappChannelRow {
  id: number;
  display_phone_number: string | null;
}

export class ConnectorInputError extends Error {}

const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;
const TEMPLATE_LANGUAGE = /^[a-z]{2,3}(_[A-Za-z]{2,4})?$/;
const PHONE_DIGITS = /^\d{8,15}$/;

/** `a@b.co, c@d.co` → validated list (1..10, no duplicates). */
export function parseRecipients(raw: string): string[] {
  const list = raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  if (list.length === 0) {
    throw new ConnectorInputError('"to" must hold at least one email');
  }
  if (list.length > CONNECTOR_LIMITS.maxRecipients) {
    throw new ConnectorInputError(
      `"to" accepts at most ${CONNECTOR_LIMITS.maxRecipients} emails (got ${list.length})`,
    );
  }
  for (const email of list) {
    if (!isEmail(email)) {
      throw new ConnectorInputError(`"${email}" is not a valid email`);
    }
  }
  return [...new Set(list.map((e) => e.toLowerCase()))];
}

/** Single line (a header must never carry a line break), at most 200 chars. */
export function parseSubject(raw: string): string {
  const subject = raw.replace(/[\r\n]+/g, ' ').trim();
  if (!subject) throw new ConnectorInputError('"subject" resolved to an empty value');
  if (subject.length > CONNECTOR_LIMITS.maxSubject) {
    throw new ConnectorInputError(
      `"subject" must have at most ${CONNECTOR_LIMITS.maxSubject} characters (got ${subject.length})`,
    );
  }
  return subject;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Store-branded layout: the (already token-resolved) text is HTML-escaped and
 * keeps its line breaks. Nothing the flow wrote can inject markup.
 */
export function buildEmailHtml(storeName: string, body: string): string {
  const paragraphs = body
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map(
      (block) =>
        `<p style="margin:0 0 16px;line-height:1.5;">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');
  const name = escapeHtml(storeName);
  return (
    '<div style="background:#f4f5f7;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">' +
    '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">' +
    `<div style="padding:16px 24px;background:#111827;color:#ffffff;font-size:18px;font-weight:bold;">${name}</div>` +
    `<div style="padding:24px;font-size:15px;">${paragraphs}</div>` +
    `<div style="padding:12px 24px;background:#f9fafb;color:#6b7280;font-size:12px;">Mensaje enviado por ${name}.</div>` +
    '</div></div>'
  );
}

/** Phone as E.164 (`+573001234567`); separators are dropped. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[\s().-]/g, '').replace(/^\+/, '');
  if (!PHONE_DIGITS.test(digits)) {
    throw new ConnectorInputError(
      `"to" must be a phone with country code (got "${raw}")`,
    );
  }
  return `+${digits}`;
}

export function parseTemplateName(raw: string): string {
  if (!TEMPLATE_NAME.test(raw)) {
    throw new ConnectorInputError(
      '"template" must be the approved template name (lowercase letters, digits and _)',
    );
  }
  return raw;
}

export function parseTemplateLanguage(raw: string | undefined): string {
  const language = raw?.trim() || 'es';
  if (!TEMPLATE_LANGUAGE.test(language)) {
    throw new ConnectorInputError(`"language" is not a valid language code (got "${language}")`);
  }
  return language;
}

/** `Ana|Pedido 12` → positional variables. */
export function parseTemplateParams(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  const params = raw.split('|').map((p) => p.trim());
  if (params.length > CONNECTOR_LIMITS.maxTemplateParams) {
    throw new ConnectorInputError(
      `"params" accepts at most ${CONNECTOR_LIMITS.maxTemplateParams} values`,
    );
  }
  if (params.some((p) => p === '')) {
    throw new ConnectorInputError('"params" cannot hold an empty value between separators');
  }
  return params;
}

export const NO_WHATSAPP_CHANNEL_MESSAGE =
  'La tienda no tiene un canal de WhatsApp conectado.';

/** Provider codes a retry cannot fix. */
const PERMANENT_MESSAGING_CODES = new Set(['AUTH', 'OPTED_OUT', 'CHANNEL_NOT_CONFIGURED']);

export function isPermanentMessagingFailure(result: {
  error_code?: string;
  retryable: boolean;
}): boolean {
  if (result.error_code && PERMANENT_MESSAGING_CODES.has(result.error_code)) return true;
  return result.retryable === false;
}

/** The channel `MessagingService` resolves: whatsapp / meta_cloud / connected. */
export const WHATSAPP_CHANNEL_WHERE = {
  channel_type: 'whatsapp',
  provider: 'meta_cloud',
  status: 'connected',
} as const;
