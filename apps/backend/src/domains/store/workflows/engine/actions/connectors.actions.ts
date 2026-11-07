import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EmailService } from '../../../../../email/email.service';
import { MessagingService } from '../../../../../messaging/messaging.service';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { OneShotEmissionService } from '../../../invoicing/one-shot-emission.service';
import {
  CONNECTOR_LIMITS,
  ConnectorInputError,
  NO_WHATSAPP_CHANNEL_MESSAGE,
  WHATSAPP_CHANNEL_WHERE,
  buildEmailHtml,
  isPermanentMessagingFailure,
  normalizePhone,
  parseRecipients,
  parseSubject,
  parseTemplateLanguage,
  parseTemplateName,
  parseTemplateParams,
} from '../../connectors/connector-delivery';
import {
  WorkflowActionContext,
  WorkflowActionGroup,
  WorkflowActionHandlerMap,
  WorkflowActionInputError,
  WorkflowActionResult,
  actionInputs,
  must,
} from './workflow-action.types';

/** Input rules are permanent: the same input fails again, so no retries. */
function permanent<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ConnectorInputError) throw new WorkflowActionInputError(e.message);
    throw e;
  }
}

/**
 * Vendix actions of the connectors (P3.3): outbound email with the store's
 * layout, WhatsApp template through the store's own channel, and DIAN
 * invoicing through the Vendix module (the same service as the UI route).
 */
@Injectable()
export class WorkflowConnectorsActions implements WorkflowActionGroup {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly email: EmailService,
    private readonly messaging: MessagingService,
    // `InvoicingModule` does not export the one-shot service and sits in a
    // module cycle with orders/payments: it is resolved lazily by token.
    private readonly moduleRef: ModuleRef,
  ) {}

  readonly handlers: WorkflowActionHandlerMap = {
    'vendix.email.send': (ctx) => this.sendEmail(ctx),
    'vendix.whatsapp.send': (ctx) => this.sendWhatsapp(ctx),
    'vendix.invoice.emit_order': (ctx) => this.emitOrder(ctx),
  };

  private async sendEmail(ctx: WorkflowActionContext): Promise<WorkflowActionResult> {
    const i = actionInputs('vendix.email.send', ctx.map);
    const { recipients, subject, body } = permanent(() => ({
      recipients: parseRecipients(must(i.text('to', 2000), 'to')),
      subject: parseSubject(must(i.text('subject', 1000), 'subject')),
      body: must(i.text('body', CONNECTOR_LIMITS.maxBody), 'body'),
    }));

    const store = await this.prisma.withoutScope().stores.findFirst({
      where: { id: ctx.instance.store_id },
      select: { name: true },
    });
    const html = buildEmailHtml(store?.name ?? 'Vendix', body);

    const failed: string[] = [];
    let firstError = 'Unknown email error';
    let sent = 0;
    for (const to of recipients) {
      const result = await this.email.sendEmail(to, subject, html, body);
      if (result.success) {
        sent += 1;
      } else {
        failed.push(to);
        if (sent === 0 && failed.length === 1) firstError = result.error ?? firstError;
      }
    }
    if (failed.length > 0) {
      if (sent === 0) {
        // Nothing left the platform: a retry is safe.
        throw new Error(`No se pudo enviar el correo: ${firstError}`);
      }
      // Part of the recipients already got it: retrying would duplicate it.
      throw new WorkflowActionInputError(
        `El correo salió a ${sent} destinatario(s) pero falló para: ${failed.join(', ')}.`,
      );
    }
    return { record_id: null };
  }

  private async sendWhatsapp(ctx: WorkflowActionContext): Promise<WorkflowActionResult> {
    const i = actionInputs('vendix.whatsapp.send', ctx.map);
    const { to, template, language, variables } = permanent(() => ({
      to: normalizePhone(must(i.text('to', 40), 'to')),
      template: parseTemplateName(must(i.text('template', 600), 'template')),
      language: parseTemplateLanguage(i.text('language', 20)),
      variables: parseTemplateParams(i.text('params', 4000)),
    }));

    const channel = await this.prisma.withoutScope().social_channels.findFirst({
      where: { store_id: ctx.instance.store_id, ...WHATSAPP_CHANNEL_WHERE },
      select: { id: true },
    });
    if (!channel) throw new WorkflowActionInputError(NO_WHATSAPP_CHANNEL_MESSAGE);

    const result = await this.messaging.sendTemplate({
      store_id: ctx.instance.store_id,
      to,
      template: { name: template, language, variables },
      idempotency_key: this.idempotencyKey(ctx),
    });
    if (result.status !== 'sent') {
      const reason = `${result.error_code ?? 'UNKNOWN'}: ${result.error_message ?? 'sin detalle'}`;
      if (isPermanentMessagingFailure(result)) {
        throw new WorkflowActionInputError(`WhatsApp rechazó el mensaje (${reason}).`);
      }
      throw new Error(`WhatsApp no pudo enviar el mensaje (${reason}).`);
    }
    return { record_id: null };
  }

  private async emitOrder(ctx: WorkflowActionContext): Promise<WorkflowActionResult> {
    const i = actionInputs('vendix.invoice.emit_order', ctx.map);
    const orderId = must(i.id('order_id'), 'order_id');
    const oneShot = this.moduleRef.get(OneShotEmissionService, { strict: false });

    const result = await ctx.asPublisher(async () => {
      // Scoped by the instance's store: a foreign order is "not found".
      const order = await this.prisma.orders.findFirst({
        where: { id: orderId },
        select: { id: true },
      });
      if (!order) {
        throw new WorkflowActionInputError('La venta no existe en esta tienda.');
      }
      return oneShot.emitOrder(orderId);
    });

    if (result.state === 'failed') {
      throw new WorkflowActionInputError(
        result.message ?? 'La DIAN no aceptó la factura de la venta.',
      );
    }
    const invoiceId = Number(result.invoice_id);
    if (!Number.isInteger(invoiceId) || invoiceId < 1) {
      throw new Error('Invoicing returned no invoice id');
    }
    return { record_id: invoiceId };
  }

  /** Stable per instance and input, so a retry of the same effect reuses it. */
  private idempotencyKey(ctx: WorkflowActionContext): string {
    const digest = createHash('sha256')
      .update(JSON.stringify(ctx.map))
      .digest('hex')
      .slice(0, 16);
    return `wf-${ctx.instance.id}-${digest}`;
  }
}
