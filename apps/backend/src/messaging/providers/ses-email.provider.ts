import { Injectable } from '@nestjs/common';
import { EmailService } from '../../email/email.service';
import {
  MessagingErrorCode,
  MessagingProvider,
  OutboundMessage,
  ResolvedChannel,
  SendResult,
} from '../interfaces/messaging.interface';

const EMAIL_PATTERN = /^[^\s<>"',;@]+@[^\s<>"',;@]+\.[^\s<>"',;@]+$/;
const MAX_SUBJECT_LENGTH = 150;
const RETRYABLE_ERROR = /throttl|rate exceeded|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ESOCKET|\b4\d\d[ -]/i;
const INVALID_RECIPIENT_ERROR = /\b5\.1\.\d|invalid (recipient|address)|mailbox unavailable/i;

/**
 * Email provider of the CRM (PLAN-CRM §5.3). A thin adapter over the
 * platform `EmailService`, which already picks SES (`EMAIL_PROVIDER`) and
 * keeps the verified platform sender: the store name becomes the visible
 * `From` name and `reply_to` the `Reply-To`, so customers answer the store.
 */
@Injectable()
export class SesEmailMessagingProvider implements MessagingProvider {
  readonly name = 'ses_email' as const;

  constructor(private readonly email: EmailService) {}

  async send(
    message: OutboundMessage,
    channel: ResolvedChannel | null,
  ): Promise<SendResult> {
    const to = message.to?.trim().toLowerCase();
    if (!to || !EMAIL_PATTERN.test(to)) {
      return this.failure('INVALID_RECIPIENT', 'Invalid email address');
    }
    const body = message.body?.trim();
    if (!body) {
      return this.failure('INVALID_REQUEST', 'An email needs a text body');
    }
    if (message.template || message.media?.length) {
      return this.failure(
        'INVALID_REQUEST',
        'CRM email only supports plain text for now',
      );
    }

    const settings = channel?.settings ?? {};
    const storeName = channel?.store_name?.trim() || 'Vendix';
    const fromName =
      typeof settings.from_name === 'string' && settings.from_name.trim()
        ? settings.from_name.trim()
        : storeName;
    const replyTo =
      typeof settings.reply_to === 'string' ? settings.reply_to : '';
    const subject = (message.subject?.trim() || `Mensaje de ${storeName}`)
      .replace(/[\r\n]+/g, ' ')
      .slice(0, MAX_SUBJECT_LENGTH);

    const result = await this.email.sendEmail(
      to,
      subject,
      toHtml(body),
      body,
      // `EmailService` keeps the platform address in `From` and turns this
      // email into `Reply-To` (dropped when empty or malformed).
      { name: fromName, email: replyTo },
    );

    if (result.success) {
      return {
        status: 'sent',
        provider: this.name,
        provider_message_id: result.messageId,
        retryable: false,
      };
    }

    const error = result.error || 'Email provider error';
    if (INVALID_RECIPIENT_ERROR.test(error)) {
      return this.failure('INVALID_RECIPIENT', error);
    }
    const retryable = RETRYABLE_ERROR.test(error);
    const code = /throttl|rate exceeded/i.test(error)
      ? 'RATE_LIMITED'
      : 'PROVIDER_ERROR';
    return { ...this.failure(code, error), retryable };
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toHtml(body: string): string {
  const paragraphs = escapeHtml(body)
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">${paragraphs}</div>`;
}
