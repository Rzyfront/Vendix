import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MessagingErrorCode,
  MessagingProvider,
  OutboundMessage,
  ResolvedChannel,
  SendResult,
} from '../interfaces/messaging.interface';
import { maskAddress } from '../utils/mask-address.util';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 500;
const PRE_CONNECT_ERRORS = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'];

/**
 * Meta error codes → normalized code. Retryable codes are transient on Meta's
 * side; everything else needs a different message, recipient or credential.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
const META_ERROR_MAP: Record<
  number,
  { code: MessagingErrorCode; retryable: boolean }
> = {
  0: { code: 'AUTH', retryable: false },
  1: { code: 'PROVIDER_ERROR', retryable: true },
  2: { code: 'PROVIDER_ERROR', retryable: true },
  4: { code: 'RATE_LIMITED', retryable: true },
  10: { code: 'AUTH', retryable: false },
  190: { code: 'AUTH', retryable: false },
  200: { code: 'AUTH', retryable: false },
  80007: { code: 'RATE_LIMITED', retryable: true },
  130429: { code: 'RATE_LIMITED', retryable: true },
  131056: { code: 'RATE_LIMITED', retryable: true },
  131000: { code: 'PROVIDER_ERROR', retryable: true },
  131016: { code: 'PROVIDER_ERROR', retryable: true },
  131026: { code: 'INVALID_RECIPIENT', retryable: false },
  131047: { code: 'WINDOW_CLOSED', retryable: false },
  131050: { code: 'OPTED_OUT', retryable: false },
  132000: { code: 'TEMPLATE_INVALID', retryable: false },
  132001: { code: 'TEMPLATE_INVALID', retryable: false },
  132005: { code: 'TEMPLATE_INVALID', retryable: false },
  132007: { code: 'TEMPLATE_INVALID', retryable: false },
  132012: { code: 'TEMPLATE_INVALID', retryable: false },
  132015: { code: 'TEMPLATE_INVALID', retryable: false },
  132016: { code: 'TEMPLATE_INVALID', retryable: false },
  100: { code: 'INVALID_REQUEST', retryable: false },
};

export function mapMetaErrorCode(code: number | undefined): {
  code: MessagingErrorCode;
  retryable: boolean;
} {
  if (code === undefined) return { code: 'UNKNOWN', retryable: false };
  return META_ERROR_MAP[code] ?? { code: 'UNKNOWN', retryable: false };
}

interface MetaErrorBody {
  error?: {
    message?: string;
    code?: number;
    error_data?: { details?: string };
  };
}

interface AttemptOutcome {
  result: SendResult;
  /** True only when Meta certainly did not accept the message. */
  safe_to_retry: boolean;
}

/**
 * WhatsApp Cloud API provider (PLAN-CRM §5.1). Uses native `fetch`, as the
 * embedded signup service does; no SDK.
 *
 * Retries inside a call only when Meta certainly rejected the request (429,
 * 5xx, network error before a response, transient Meta codes). A timeout is
 * NOT retried: Meta may have accepted the message and the Cloud API has no
 * idempotency key, so resending could deliver it twice.
 */
@Injectable()
export class MetaCloudMessagingProvider implements MessagingProvider {
  readonly name = 'meta_cloud' as const;
  private readonly logger = new Logger(MetaCloudMessagingProvider.name);

  constructor(private readonly config: ConfigService) {}

  async send(
    message: OutboundMessage,
    channel: ResolvedChannel | null,
  ): Promise<SendResult> {
    if (!channel?.access_token || !channel.phone_number_id) {
      return this.failure(
        'CHANNEL_NOT_CONFIGURED',
        false,
        'WhatsApp channel has no access token or phone number id',
      );
    }

    const payload = this.buildPayload(message);
    if ('error' in payload) {
      return this.failure('INVALID_REQUEST', false, payload.error);
    }

    const url = `https://graph.facebook.com/${channel.graph_version}/${channel.phone_number_id}/messages`;
    const retries = this.numberSetting(
      'MESSAGING_HTTP_RETRIES',
      DEFAULT_RETRIES,
    );
    const baseDelay = this.numberSetting(
      'MESSAGING_RETRY_BASE_MS',
      DEFAULT_RETRY_BASE_MS,
    );

    let outcome: AttemptOutcome | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await this.sleep(baseDelay * 2 ** (attempt - 1));
      outcome = await this.attempt(url, channel.access_token, payload.body);
      if (outcome.result.status === 'sent' || !outcome.safe_to_retry) break;
    }

    const result = outcome!.result;
    if (result.status === 'failed') {
      this.logger.warn(
        `WhatsApp send to ${maskAddress(message.to)} failed (store ${message.store_id}, message ${message.idempotency_key}): ${result.error_code}/${result.provider_error_code ?? '-'}`,
      );
    }
    return result;
  }

  private async attempt(
    url: string,
    token: string,
    body: Record<string, unknown>,
  ): Promise<AttemptOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.numberSetting('MESSAGING_HTTP_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        return {
          result: this.failure(
            'TIMEOUT',
            false,
            'Meta did not answer in time; delivery is unknown',
          ),
          safe_to_retry: false,
        };
      }
      // Only errors raised before a connection exists prove Meta never saw
      // the request. A reset or hang-up after the body left may already have
      // been accepted, so it is not resent (same rule as the timeout).
      const cause = (error as { cause?: { code?: string } })?.cause?.code;
      const beforeConnect = !!cause && PRE_CONNECT_ERRORS.includes(cause);
      return {
        result: this.failure(
          'PROVIDER_ERROR',
          beforeConnect,
          `Network error${cause ? ` ${cause}` : ''}: ${(error as Error)?.message ?? 'unknown'}`,
        ),
        safe_to_retry: beforeConnect,
      };
    } finally {
      clearTimeout(timer);
    }

    const json = (await response.json().catch(() => ({}))) as MetaErrorBody & {
      messages?: Array<{ id?: string }>;
    };

    if (response.ok && json.messages?.[0]?.id) {
      return {
        result: {
          status: 'sent',
          provider: this.name,
          provider_message_id: json.messages[0].id,
          retryable: false,
        },
        safe_to_retry: false,
      };
    }

    const metaCode = json.error?.code;
    let mapped = mapMetaErrorCode(metaCode);
    if (metaCode === undefined) {
      if (response.status === 429) {
        mapped = { code: 'RATE_LIMITED', retryable: true };
      } else if (response.status >= 500) {
        mapped = { code: 'PROVIDER_ERROR', retryable: true };
      }
    }

    const message =
      json.error?.error_data?.details ||
      json.error?.message ||
      `Meta answered HTTP ${response.status}`;

    return {
      result: this.failure(
        mapped.code,
        mapped.retryable,
        message,
        metaCode !== undefined ? String(metaCode) : undefined,
      ),
      safe_to_retry: mapped.retryable,
    };
  }

  private buildPayload(
    message: OutboundMessage,
  ): { body: Record<string, unknown> } | { error: string } {
    const to = message.to.replace(/\D/g, '');
    if (!to) return { error: 'Recipient phone is empty' };

    const base = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
    };

    if (message.template) {
      const { name, language, variables, header_media } = message.template;
      const components: Record<string, unknown>[] = [];
      if (header_media) {
        components.push({
          type: 'header',
          parameters: [
            {
              type: header_media.type,
              [header_media.type]: { link: header_media.url },
            },
          ],
        });
      }
      if (variables.length) {
        components.push({
          type: 'body',
          parameters: variables.map((text) => ({ type: 'text', text })),
        });
      }
      return {
        body: {
          ...base,
          type: 'template',
          template: {
            name,
            language: { code: language },
            ...(components.length ? { components } : {}),
          },
        },
      };
    }

    const media = message.media?.[0];
    if (media) {
      const object: Record<string, string> = { link: media.url };
      if (message.body && media.type !== 'audio') object.caption = message.body;
      if (media.filename && media.type === 'document') {
        object.filename = media.filename;
      }
      return { body: { ...base, type: media.type, [media.type]: object } };
    }

    if (!message.body?.trim()) return { error: 'Message body is empty' };
    return {
      body: {
        ...base,
        type: 'text',
        text: { body: message.body, preview_url: false },
      },
    };
  }

  private failure(
    code: MessagingErrorCode,
    retryable: boolean,
    message: string,
    providerCode?: string,
  ): SendResult {
    return {
      status: 'failed',
      provider: this.name,
      error_code: code,
      ...(providerCode ? { provider_error_code: providerCode } : {}),
      error_message: message,
      retryable,
    };
  }

  private numberSetting(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    const value = raw === undefined || raw === '' ? NaN : Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  private sleep(ms: number): Promise<void> {
    return ms > 0
      ? new Promise((resolve) => setTimeout(resolve, ms))
      : Promise.resolve();
  }
}
