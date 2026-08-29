import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EmailService } from '../../../email/email.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';

/**
 * QUI-723 — email notification when a customer's record is updated.
 *
 * The dev lead's spec: if the cashier updates an existing customer via the
 * POS finalize-sale wizard (e.g. fills the missing phone or document fields
 * from a freshly-typed value), the customer receives an email so they know
 * their record was enriched.
 *
 * The backend already emits a `customer.updated` event from
 * `CustomersService.findOrCreateByEmailOrDocument` when the conservative
 * update fills empty fields. This listener is the consumer that turns the
 * event into an email.
 *
 * Edge cases:
 *   - Customer has no email on file → skip silently (logged as warn).
 *   - EmailService fails → caught and logged; never throws back into the
 *     POS request lifecycle, which would mask the otherwise-successful
 *     update with a confusing error.
 */
@Injectable()
export class CustomerEmailListener {
  private readonly logger = new Logger(CustomerEmailListener.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly prisma: StorePrismaService,
  ) {}

  @OnEvent('customer.updated')
  async handleCustomerUpdated(payload: {
    store_id: number;
    customer_id: number;
    email: string | null;
    first_name: string | null;
    updated_fields: string[];
  }): Promise<void> {
    if (!payload.email) {
      this.logger.warn(
        `customer.updated: customer ${payload.customer_id} has no email on file — skipping notification`,
      );
      return;
    }

    if (!payload.updated_fields || payload.updated_fields.length === 0) {
      // Defensive: nothing to highlight. Theoretically the service only
      // emits when there ARE updates, but we guard anyway.
      return;
    }

    try {
      const store = await this.prisma.stores.findUnique({
        where: { id: payload.store_id },
        select: { name: true },
      });
      const storeName = store?.name ?? 'la tienda';

      const friendlyName = payload.first_name?.trim() || 'Hola';
      const fieldsList = this.humanizeFields(payload.updated_fields);

      const subject = `Actualizamos tus datos en ${storeName}`;
      const html = this.buildHtml(friendlyName, storeName, fieldsList);
      const text = this.buildText(friendlyName, storeName, fieldsList);

      const result = await this.emailService.sendEmail(
        payload.email,
        subject,
        html,
        text,
      );

      if (!result.success) {
        this.logger.error(
          `customer.updated: failed to send email to ${payload.email}: ${result.error}`,
        );
      }
    } catch (error) {
      // Email failures must not propagate back into the request flow.
      this.logger.error(
        `customer.updated: unexpected error sending email to ${payload.email}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Map internal field keys to Spanish labels for the email body. */
  private humanizeFields(fields: string[]): string[] {
    const LABELS: Record<string, string> = {
      first_name: 'nombre',
      last_name: 'apellido',
      phone: 'teléfono',
      document_type: 'tipo de documento',
      document_number: 'número de documento',
    };
    return fields.map((f) => LABELS[f] ?? f);
  }

  private buildHtml(name: string, storeName: string, fields: string[]): string {
    const list = fields
      .map((f) => `<li style="margin:4px 0;">${this.escape(f)}</li>`)
      .join('');
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <p>Hola <strong>${this.escape(name)}</strong>,</p>
        <p>Te informamos que desde <strong>${this.escape(storeName)}</strong> actualizamos algunos datos de tu cuenta:</p>
        <ul style="background: #f6f8fa; padding: 12px 24px; border-radius: 8px; list-style: none;">
          ${list}
        </ul>
        <p>Si necesitas corregir algo, responde a este correo o acércate al punto de venta.</p>
        <p style="color:#6a737d; font-size: 12px; margin-top: 32px;">Este es un mensaje automático. Si no reconoces esta actualización, por favor contáctanos.</p>
      </div>
    `;
  }

  private buildText(name: string, storeName: string, fields: string[]): string {
    const list = fields.map((f) => `- ${f}`).join('\n');
    return [
      `Hola ${name},`,
      ``,
      `Te informamos que desde ${storeName} actualizamos algunos datos de tu cuenta:`,
      ``,
      list,
      ``,
      `Si necesitas corregir algo, responde a este correo o acércate al punto de venta.`,
      ``,
      `Este es un mensaje automático. Si no reconoces esta actualización, por favor contáctanos.`,
    ].join('\n');
  }

  private escape(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
