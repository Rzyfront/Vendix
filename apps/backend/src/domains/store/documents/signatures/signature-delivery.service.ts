import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { EmailService } from '../../../../email/email.service';
import { MessagingService } from '../../../../messaging/messaging.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  ConnectorInputError,
  WHATSAPP_CHANNEL_WHERE,
  isPermanentMessagingFailure,
  normalizePhone,
} from '../../workflows/connectors/connector-delivery';
import { publicStoreOrigin } from '../../workflows/public-link/workflow-public-link.rules';
import {
  OTP_TTL_MINUTES,
  WHATSAPP_LANGUAGE,
  WHATSAPP_LINK_TEMPLATE,
  WHATSAPP_OTP_TEMPLATE,
} from './signature.constants';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface DeliveryTarget {
  id: number;
  name: string;
  method: 'otp_email' | 'otp_whatsapp';
  email: string | null;
  phone: string | null;
}

export const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function layout(storeName: string, body: string): string {
  return (
    '<div style="background:#f4f5f7;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">' +
    '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">' +
    `<div style="padding:16px 24px;background:#111827;color:#ffffff;font-size:18px;font-weight:bold;">${escapeHtml(storeName)}</div>` +
    `<div style="padding:24px;font-size:15px;line-height:1.5;">${body}</div>` +
    '</div></div>'
  );
}

/** Sends the signing link and the one-time code by e-mail or WhatsApp. */
@Injectable()
export class SignatureDeliveryService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly email: EmailService,
    private readonly messaging: MessagingService,
  ) {}

  /** Normalized phone of a WhatsApp signer; invalid input is a 422. */
  phoneOf(raw: string): string {
    try {
      return normalizePhone(raw);
    } catch (e) {
      if (e instanceof ConnectorInputError) {
        throw new VendixHttpException(
          ErrorCodes.SIGNATURE_SIGNER_INVALID,
          'El celular debe llevar el indicativo del país, por ejemplo +573001234567.',
        );
      }
      throw e;
    }
  }

  async assertWhatsappChannel(storeId: number): Promise<void> {
    const channel = await this.prisma.withoutScope().social_channels.findFirst({
      where: { store_id: storeId, ...WHATSAPP_CHANNEL_WHERE },
      select: { id: true },
    });
    if (!channel) throw new VendixHttpException(ErrorCodes.SIGNATURE_NO_WHATSAPP_CHANNEL);
  }

  /** Public URL of the signing page, or a 422 when the store has no public domain. */
  async linkUrl(storeId: number, token: string): Promise<string> {
    const origin = await publicStoreOrigin(this.prisma.withoutScope() as never, storeId);
    if (!origin) throw new VendixHttpException(ErrorCodes.SIGNATURE_NO_PUBLIC_DOMAIN);
    return `${origin}/firmar/${token}`;
  }

  async assertPublicDomain(storeId: number): Promise<void> {
    await this.linkUrl(storeId, 'x');
  }

  async sendLink(
    target: DeliveryTarget,
    ctx: { store_id: number; store_name: string; document_title: string; url: string; expires_at: Date },
  ): Promise<void> {
    const expires = ctx.expires_at.toISOString().slice(0, 10);
    if (target.method === 'otp_email') {
      const body =
        `<p style="margin:0 0 16px;">Hola ${escapeHtml(target.name)},</p>` +
        `<p style="margin:0 0 16px;">${escapeHtml(ctx.store_name)} te envió el documento «${escapeHtml(ctx.document_title)}» para que lo firmes electrónicamente.</p>` +
        `<p style="margin:0 0 16px;"><a href="${escapeHtml(ctx.url)}" style="background:#111827;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;">Revisar y firmar</a></p>` +
        `<p style="margin:0;color:#6b7280;font-size:13px;">El enlace es personal y vence el ${expires}. Si no esperabas este mensaje, ignóralo.</p>`;
      const result = await this.email.sendEmail(
        target.email as string,
        `Firma el documento «${ctx.document_title}»`,
        layout(ctx.store_name, body),
        `Hola ${target.name}, ${ctx.store_name} te envió el documento «${ctx.document_title}» para firmar: ${ctx.url} (vence el ${expires}).`,
      );
      if (!result.success) this.fail(result.error);
      return;
    }
    await this.whatsapp(ctx.store_id, target, WHATSAPP_LINK_TEMPLATE, [target.name, ctx.document_title, ctx.url], `sig-link-${target.id}`);
  }

  async sendOtp(target: DeliveryTarget, ctx: { store_id: number; store_name: string; code: string }): Promise<void> {
    if (target.method === 'otp_email') {
      const body =
        `<p style="margin:0 0 16px;">Hola ${escapeHtml(target.name)}, tu código para firmar es:</p>` +
        `<p style="margin:0 0 16px;font-size:28px;font-weight:bold;letter-spacing:6px;">${escapeHtml(ctx.code)}</p>` +
        `<p style="margin:0;color:#6b7280;font-size:13px;">Vence en ${OTP_TTL_MINUTES} minutos. No lo compartas con nadie.</p>`;
      const result = await this.email.sendEmail(
        target.email as string,
        'Tu código para firmar',
        layout(ctx.store_name, body),
        `Tu código para firmar es ${ctx.code}. Vence en ${OTP_TTL_MINUTES} minutos.`,
      );
      if (!result.success) this.fail(result.error);
      return;
    }
    await this.whatsapp(ctx.store_id, target, WHATSAPP_OTP_TEMPLATE, [ctx.code], `sig-otp-${target.id}-${randomUUID()}`);
  }

  private async whatsapp(
    storeId: number,
    target: DeliveryTarget,
    template: string,
    variables: string[],
    idempotencyKey: string,
  ): Promise<void> {
    await this.assertWhatsappChannel(storeId);
    const result = await this.messaging.sendTemplate({
      store_id: storeId,
      to: this.phoneOf(target.phone as string),
      template: { name: template, language: WHATSAPP_LANGUAGE, variables },
      idempotency_key: idempotencyKey,
    });
    if (result.status !== 'sent') {
      const reason = `${result.error_code ?? 'UNKNOWN'}: ${result.error_message ?? 'sin detalle'}`;
      this.fail(isPermanentMessagingFailure(result) ? `WhatsApp rechazó el mensaje (${reason}).` : `WhatsApp no pudo enviar el mensaje (${reason}).`);
    }
  }

  private fail(detail?: string): never {
    throw new VendixHttpException(
      ErrorCodes.SIGNATURE_DELIVERY_FAILED,
      `No se pudo enviar el mensaje al firmante${detail ? `: ${detail}` : '.'}`,
    );
  }
}
