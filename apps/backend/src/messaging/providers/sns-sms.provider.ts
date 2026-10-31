import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CheckIfPhoneNumberIsOptedOutCommand,
  MessageAttributeValue,
  PublishCommand,
  SNSClient,
} from '@aws-sdk/client-sns';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import {
  MessagingErrorCode,
  MessagingProvider,
  OutboundMessage,
  ResolvedChannel,
  SendResult,
} from '../interfaces/messaging.interface';
import { maskAddress } from '../utils/mask-address.util';
import {
  estimateSmsCost,
  normalizeE164,
  parseSmsPriceTable,
} from '../utils/sms.util';

const DEFAULT_MAX_PRICE_USD = '0.50';
/** Used when `SNS_SMS_PRICE_TABLE` has no entry: deliberately high. */
const FALLBACK_PRICE_PER_SEGMENT_USD = 0.1;
const OPT_OUT_CACHE_TTL_SECONDS = 24 * 60 * 60;
const SENDER_ID_PATTERN = /^(?=.*[A-Za-z])[A-Za-z0-9]{1,11}$/;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * SNS exception name → normalized code. Every SNS API error means the
 * message was not accepted, so retrying cannot duplicate it.
 */
const SNS_ERROR_MAP: Record<
  string,
  { code: MessagingErrorCode; retryable: boolean }
> = {
  ThrottledException: { code: 'RATE_LIMITED', retryable: true },
  ThrottlingException: { code: 'RATE_LIMITED', retryable: true },
  KMSThrottlingException: { code: 'RATE_LIMITED', retryable: true },
  InternalErrorException: { code: 'PROVIDER_ERROR', retryable: true },
  InternalFailure: { code: 'PROVIDER_ERROR', retryable: true },
  ServiceUnavailable: { code: 'PROVIDER_ERROR', retryable: true },
  InvalidParameterException: { code: 'INVALID_RECIPIENT', retryable: false },
  InvalidParameterValueException: { code: 'INVALID_REQUEST', retryable: false },
  ValidationException: { code: 'INVALID_REQUEST', retryable: false },
  EndpointDisabledException: { code: 'INVALID_RECIPIENT', retryable: false },
  OptedOutException: { code: 'OPTED_OUT', retryable: false },
  AuthorizationErrorException: { code: 'AUTH', retryable: false },
  InvalidSecurityException: { code: 'AUTH', retryable: false },
  InvalidClientTokenId: { code: 'AUTH', retryable: false },
  UnrecognizedClientException: { code: 'AUTH', retryable: false },
  ExpiredTokenException: { code: 'AUTH', retryable: false },
  AccessDeniedException: { code: 'AUTH', retryable: false },
  CredentialsProviderError: { code: 'AUTH', retryable: false },
  KMSAccessDeniedException: { code: 'AUTH', retryable: false },
  KMSDisabledException: { code: 'PROVIDER_ERROR', retryable: false },
  KMSInvalidStateException: { code: 'PROVIDER_ERROR', retryable: false },
  KMSNotFoundException: { code: 'PROVIDER_ERROR', retryable: false },
  KMSOptInRequired: { code: 'PROVIDER_ERROR', retryable: false },
};

/** Network errors raised before the request reached SNS. */
const PRE_CONNECT_ERRORS = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'];

export function mapSnsError(error: unknown): {
  code: MessagingErrorCode;
  retryable: boolean;
  provider_error_code: string;
} {
  const err = (error ?? {}) as {
    name?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const name = err.name || err.code || 'UnknownError';
  const mapped = SNS_ERROR_MAP[name];
  if (mapped) return { ...mapped, provider_error_code: name };

  if (err.code && PRE_CONNECT_ERRORS.includes(err.code)) {
    return { code: 'PROVIDER_ERROR', retryable: true, provider_error_code: name };
  }
  // No response: SNS may have accepted the SMS; never resend it.
  if (name === 'TimeoutError' || name === 'RequestTimeout') {
    return { code: 'TIMEOUT', retryable: false, provider_error_code: name };
  }
  const status = err.$metadata?.httpStatusCode;
  if (status && status >= 500) {
    return { code: 'PROVIDER_ERROR', retryable: true, provider_error_code: name };
  }
  return { code: 'UNKNOWN', retryable: false, provider_error_code: name };
}

export interface SmsQuote {
  to: string;
  cost: number;
  segments: number;
  encoding: 'GSM-7' | 'UCS-2';
}

/**
 * Amazon SNS SMS provider (PLAN-CRM §5.2). One platform AWS account; the
 * client uses the default credential chain (instance role in AWS, env vars
 * elsewhere), never keys in code. Spend is reserved per store by
 * `MessagingService` before `send()` and imputed in Vendix.
 */
@Injectable()
export class SnsSmsMessagingProvider implements MessagingProvider {
  readonly name = 'sns_sms' as const;
  private readonly logger = new Logger(SnsSmsMessagingProvider.name);
  private client: SNSClient | null = null;

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Validates the recipient and body and estimates the cost. Returns a
   * failed `SendResult` when the message must not be published at all.
   */
  quote(message: OutboundMessage): SmsQuote | SendResult {
    const to = normalizeE164(
      message.to,
      this.config.get<string>('SNS_SMS_DEFAULT_COUNTRY_CODE') || '57',
    );
    if (!to) {
      return this.failure(
        'INVALID_RECIPIENT',
        'The phone number is not a valid E.164 number',
      );
    }
    const body = message.body?.trim();
    if (!body) {
      return this.failure('INVALID_REQUEST', 'An SMS needs a text body');
    }
    if (message.template || message.media?.length) {
      return this.failure(
        'INVALID_REQUEST',
        'SMS only supports plain text (no templates or attachments)',
      );
    }

    const { cost, segments } = estimateSmsCost(
      to,
      body,
      parseSmsPriceTable(this.config.get<string>('SNS_SMS_PRICE_TABLE')),
      FALLBACK_PRICE_PER_SEGMENT_USD,
    );
    return { to, cost, segments: segments.segments, encoding: segments.encoding };
  }

  /**
   * Whether the number replied STOP to the platform account. Cached 24 h in
   * Redis; if SNS cannot be asked, the send goes on (SNS itself still drops
   * SMS to opted-out numbers).
   */
  async isOptedOut(e164: string): Promise<boolean> {
    const key = `crm:sms:opted-out:${e164}`;
    try {
      const cached = await this.redis.get(key);
      if (cached !== null) return cached === '1';
    } catch {
      // Cache miss on Redis failure.
    }

    try {
      const response = await this.getClient().send(
        new CheckIfPhoneNumberIsOptedOutCommand({ phoneNumber: e164 }),
      );
      const optedOut = response.isOptedOut === true;
      await this.redis
        .set(key, optedOut ? '1' : '0', 'EX', OPT_OUT_CACHE_TTL_SECONDS)
        .catch(() => undefined);
      return optedOut;
    } catch (error) {
      this.logger.warn(
        `Could not check SMS opt-out for ${maskAddress(e164)}: ${(error as Error)?.name ?? 'error'}`,
      );
      return false;
    }
  }

  async send(
    message: OutboundMessage,
    channel: ResolvedChannel | null,
  ): Promise<SendResult> {
    const quote = this.quote(message);
    if (!('cost' in quote)) return quote;

    const attributes: Record<string, MessageAttributeValue> = {
      'AWS.SNS.SMS.SMSType': {
        DataType: 'String',
        StringValue: 'Transactional',
      },
      'AWS.SNS.SMS.MaxPrice': {
        DataType: 'Number',
        StringValue: this.maxPrice(),
      },
    };
    const senderId = channel?.settings?.sender_id;
    if (typeof senderId === 'string' && SENDER_ID_PATTERN.test(senderId)) {
      attributes['AWS.SNS.SMS.SenderID'] = {
        DataType: 'String',
        StringValue: senderId,
      };
    }

    try {
      const response = await this.getClient().send(
        new PublishCommand({
          PhoneNumber: quote.to,
          Message: message.body!.trim(),
          MessageAttributes: attributes,
        }),
      );
      if (!response.MessageId) {
        return this.failure('UNKNOWN', 'SNS returned no MessageId');
      }
      return {
        status: 'sent',
        provider: this.name,
        provider_message_id: response.MessageId,
        retryable: false,
        cost_amount: quote.cost,
      };
    } catch (error) {
      const mapped = mapSnsError(error);
      this.logger.warn(
        `SNS rejected SMS to ${maskAddress(quote.to)} (store ${message.store_id}, message ${message.idempotency_key}): ${mapped.provider_error_code}`,
      );
      return {
        status: 'failed',
        provider: this.name,
        error_code: mapped.code,
        provider_error_code: mapped.provider_error_code,
        error_message: (error as Error)?.message || mapped.provider_error_code,
        retryable: mapped.retryable,
      };
    }
  }

  private maxPrice(): string {
    const raw = this.config.get<string>('SNS_SMS_MAX_PRICE_USD');
    const value = Number(raw);
    return raw && Number.isFinite(value) && value > 0
      ? String(value)
      : DEFAULT_MAX_PRICE_USD;
  }

  private getClient(): SNSClient {
    if (!this.client) {
      this.client = new SNSClient({
        region:
          this.config.get<string>('SNS_REGION') ||
          this.config.get<string>('AWS_REGION') ||
          'us-east-1',
        maxAttempts: 1,
        requestHandler: {
          requestTimeout: REQUEST_TIMEOUT_MS,
          connectionTimeout: 5_000,
        },
      });
    }
    return this.client;
  }

  private failure(code: MessagingErrorCode, message: string): SendResult {
    return {
      status: 'failed',
      provider: this.name,
      error_code: code,
      error_message: message,
      retryable: false,
    };
  }
}
