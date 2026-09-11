import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { EmailService } from '../../../email/email.service';
import {
  PqrCreatedEvent,
  PqrResponseSentEvent,
  PqrStatusChangedEvent,
} from './pqr.service';

/**
 * Email notifications for the public PQR channel.
 *
 * Listens for:
 * - `pqr.created` → notify the platform admin inbox (admin@vendix.online)
 *   and send an acknowledgement to the requester.
 * - `pqr.response_sent` → forward an admin's comment back to the requester.
 * - `pqr.status_changed` → notify the requester when the ticket transitions
 *   to RESOLVED or CLOSED.
 */
@Injectable()
export class PqrEmailService {
  private readonly logger = new Logger(PqrEmailService.name);
  private static ADMIN_EMAIL =
    process.env.PQR_ADMIN_EMAIL || 'admin@vendix.online';

  constructor(
    private readonly emailService: EmailService,
    // Reserved for future use (e.g. fetching requester preferences).
    private readonly globalPrisma: GlobalPrismaService,
  ) {}

  @OnEvent('pqr.created')
  async handlePqrCreated(payload: PqrCreatedEvent) {
    const { ticket, contact } = payload;

    await this.notifyAdmin(ticket, contact, payload.ip);

    if (contact.email) {
      await this.notifyRequester(ticket, contact);
    }
  }

  /**
   * Admin posted a comment (or the PQR was resolved/closed with content).
   * Forward the body to the requester email.
   */
  @OnEvent('pqr.response_sent')
  async handlePqrResponseSent(payload: PqrResponseSentEvent) {
    // Prefer the structured requester contact emitted by PqrService
    // (the canonical source since migration 20260628101500). Falls
    // back to parsing the description for legacy tickets that
    // pre-date the structured columns.
    const contact = payload.requester_email
      ? {
          email: payload.requester_email,
          name: payload.requester_name?.trim() ?? '',
        }
      : this.parseRequester(payload.description);
    if (!contact?.email) {
      this.logger.warn(
        `PQR ${payload.ticket_number}: cannot notify requester — no email parsed from description`,
      );
      return;
    }
    await this.notifyRequesterResponse(payload, contact);
  }

  /**
   * Status transition. Only terminal-ish states are worth notifying about.
   * The PqrService already filters these, but we double-check here so
   * future emitters don't accidentally spam requesters.
   */
  @OnEvent('pqr.status_changed')
  async handlePqrStatusChanged(payload: PqrStatusChangedEvent) {
    const terminal = new Set(['RESOLVED', 'CLOSED']);
    if (!terminal.has(payload.new_status)) return;

    let contact = this.parseRequester(payload.description);
    if (!contact?.email) {
      const ticket = await this.globalPrisma.support_tickets.findFirst({
        where: { ticket_number: payload.ticket_number },
        select: {
          requester_email: true,
          requester_first_name: true,
          requester_last_name: true,
        },
      });
      if (ticket?.requester_email) {
        contact = {
          email: ticket.requester_email,
          name:
            `${ticket.requester_first_name ?? ''} ${ticket.requester_last_name ?? ''}`.trim(),
        };
      }
    }
    if (!contact?.email) {
      this.logger.warn(
        `PQR ${payload.ticket_number}: cannot notify requester — no email parsed from description or database`,
      );
      return;
    }
    await this.notifyRequesterStatusUpdate(payload, contact);
  }

  /* ─────────────────────────── Admin notification ─────────────────────────── */

  private async notifyAdmin(
    ticket: PqrCreatedEvent['ticket'],
    contact: PqrCreatedEvent['contact'],
    ip: string,
  ) {
    const storeInfo = await this.getStoreInfo(
      ticket.store_id,
      ticket.organization_id,
    );
    const storeName = storeInfo?.name ?? null;

    const typeLabel = this.pqrTypeLabel(contact.pqr_type);
    const capitalizedType =
      typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1);

    const subject = storeName
      ? `[PQRS ${ticket.ticket_number}] ${ticket.title} — ${storeName}`
      : `[PQRS ${ticket.ticket_number}] ${ticket.title}`;

    const text = [
      `Nueva PQRS recibida:`,
      ``,
      `Ticket:  ${ticket.ticket_number}`,
      `Tipo:    ${capitalizedType}`,
      `Asunto:  ${ticket.title}`,
      storeName ? `Tienda:  ${storeName}` : '',
      ``,
      `Datos del solicitante:`,
      `  Nombre:   ${contact.name}`,
      `  Email:    ${contact.email}`,
      contact.phone ? `  Teléfono: ${contact.phone}` : '',
      ``,
      `IP: ${ip}`,
      ``,
      `Mensaje:`,
      ticket.description,
      ``,
      `Nota: Puedes responder a este correo para escribirle directamente a ${contact.name} (${contact.email}).`,
    ]
      .filter((l) => l !== '')
      .join('\n');

    const html = `
      <h2>Nueva PQRS recibida</h2>
      <table style="border-collapse:collapse">
        <tr><td><b>Ticket:</b></td><td>${ticket.ticket_number}</td></tr>
        <tr><td><b>Tipo:</b></td><td>${capitalizedType}</td></tr>
        <tr><td><b>Asunto:</b></td><td>${this.escape(ticket.title)}</td></tr>
        ${storeName ? `<tr><td><b>Tienda:</b></td><td>${this.escape(storeName)}</td></tr>` : ''}
      </table>
      <h3>Datos del solicitante</h3>
      <ul>
        <li><b>Nombre:</b> ${this.escape(contact.name)}</li>
        <li><b>Correo electrónico:</b> <a href="mailto:${this.escape(contact.email)}">${this.escape(contact.email)}</a></li>
        ${contact.phone ? `<li><b>Teléfono:</b> ${this.escape(contact.phone)}</li>` : ''}
        <li><b>IP:</b> ${this.escape(ip)}</li>
      </ul>
      <h3>Mensaje</h3>
      <pre style="white-space:pre-wrap;font-family:inherit">${this.escape(ticket.description)}</pre>
      <p style="color:#666;font-size:13px;margin-top:16px;">
        💡 <i>Puedes responder directamente a este correo para escribirle a <b>${this.escape(contact.name)}</b> (<a href="mailto:${this.escape(contact.email)}">${this.escape(contact.email)}</a>), o gestionar la solicitud formalmente desde tu panel en <b>PQRS</b>.</i>
      </p>
    `;

    const recipientEmail = storeInfo?.email || PqrEmailService.ADMIN_EMAIL;

    // Configurar el Reply-To con los datos del solicitante para que si el
    // administrador responde al correo, la respuesta vaya directamente al cliente
    const fromOverride = contact.email
      ? {
          name: `${contact.name} (PQRS)`,
          email: contact.email,
        }
      : undefined;

    try {
      await this.emailService.sendEmail(
        recipientEmail,
        subject,
        html,
        text,
        fromOverride,
      );
    } catch (e) {
      this.logger.error(
        `[pqr-email] Failed to send admin email for ${ticket.ticket_number}`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  /* ─────────────────────── Requester acknowledgement ──────────────────────── */

  private async notifyRequester(
    ticket: PqrCreatedEvent['ticket'],
    contact: PqrCreatedEvent['contact'],
  ) {
    const storeInfo = await this.getStoreInfo(
      ticket.store_id,
      ticket.organization_id,
    );
    const storeName = storeInfo?.name ?? null;

    const teamSignature = storeName
      ? `Equipo de ${storeName}`
      : 'Equipo Vendix';
    const subject = `Recibimos tu PQRS #${ticket.ticket_number}${storeName ? ` — ${storeName}` : ''}`;

    const text =
      `Hola ${contact.name},\n\n` +
      `Hemos recibido tu ${this.pqrTypeLabel(contact.pqr_type)}.\n` +
      `Ticket: ${ticket.ticket_number}\n` +
      `Asunto: ${ticket.title}\n\n` +
      `El ${teamSignature} te responderá pronto. Gracias por contactarte.\n\n` +
      `— ${teamSignature}`;

    const html = `
      <h2>Recibimos tu PQRS</h2>
      <p>Hola <b>${this.escape(contact.name)}</b>,</p>
      <p>Hemos recibido tu <b>${this.pqrTypeLabel(contact.pqr_type)}</b>.</p>
      <ul>
        <li><b>Ticket:</b> ${ticket.ticket_number}</li>
        <li><b>Asunto:</b> ${this.escape(ticket.title)}</li>
      </ul>
      <p>El <b>${this.escape(teamSignature)}</b> te responderá pronto. Gracias por contactarte.</p>
      <p>— ${this.escape(teamSignature)}</p>
    `;

    // Si pertenece a una tienda, el remitente lleva directamente el nombre
    // de la tienda (ej. "Nike") y Reply-To va hacia el dueño/admin de la tienda
    const fromOverride = storeInfo
      ? {
          name: storeInfo.name,
          email: storeInfo.email,
        }
      : undefined;

    try {
      await this.emailService.sendEmail(
        contact.email,
        subject,
        html,
        text,
        fromOverride,
      );
    } catch (e) {
      this.logger.error(
        `[pqr-email] Failed to send requester acknowledgement for ${ticket.ticket_number}`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  /* ───────────────────── Admin → requester notifications ──────────────────── */

  private async notifyRequesterResponse(
    payload: PqrResponseSentEvent,
    contact: { name: string; email: string },
  ) {
    const ticket = await this.globalPrisma.support_tickets.findFirst({
      where: { ticket_number: payload.ticket_number },
      select: { store_id: true, organization_id: true },
    });
    const storeInfo = await this.getStoreInfo(
      ticket?.store_id,
      ticket?.organization_id,
    );
    const storeName = storeInfo?.name ?? null;
    const teamSignature = storeName
      ? `Equipo de ${storeName}`
      : 'Equipo Vendix';

    const subject = `Actualización de tu PQRS #${payload.ticket_number}${storeName ? ` — ${storeName}` : ''}`;

    const text =
      `Hola ${contact.name || ''},\n\n` +
      `Hemos publicado una respuesta a tu PQRS ${payload.ticket_number}:\n\n` +
      `${payload.comment_content}\n\n` +
      `— ${teamSignature}`;

    const html = `
      <h2>Actualización de tu PQRS</h2>
      <p>Hola <b>${this.escape(contact.name || '')}</b>,</p>
      <p>Hemos publicado una respuesta a tu PQRS <b>${payload.ticket_number}</b>:</p>
      <blockquote style="border-left:3px solid #ccc;padding-left:1em;white-space:pre-wrap">${this.escape(payload.comment_content)}</blockquote>
      <p>— ${this.escape(teamSignature)}</p>
    `;

    const fromOverride = storeInfo
      ? {
          name: storeInfo.name,
          email: storeInfo.email,
        }
      : undefined;

    try {
      await this.emailService.sendEmail(
        contact.email,
        subject,
        html,
        text,
        fromOverride,
      );
    } catch (e) {
      this.logger.error(
        `[pqr-email] Failed to send response notification for ${payload.ticket_number}`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  private async notifyRequesterStatusUpdate(
    payload: PqrStatusChangedEvent,
    contact: { name: string; email: string },
  ) {
    const ticket = await this.globalPrisma.support_tickets.findFirst({
      where: { ticket_number: payload.ticket_number },
      select: { store_id: true, organization_id: true },
    });
    const storeInfo = await this.getStoreInfo(
      ticket?.store_id,
      ticket?.organization_id,
    );
    const storeName = storeInfo?.name ?? null;
    const teamSignature = storeName
      ? `Equipo de ${storeName}`
      : 'Equipo Vendix';

    const isResolved = payload.new_status === 'RESOLVED';
    const subject = isResolved
      ? `Tu PQRS #${payload.ticket_number} fue respondida${storeName ? ` — ${storeName}` : ''}`
      : `Tu PQRS #${payload.ticket_number} fue cerrada${storeName ? ` — ${storeName}` : ''}`;

    const headline = isResolved
      ? 'Tu PQRS fue respondida'
      : 'Tu PQRS fue cerrada';

    const text =
      `Hola ${contact.name || ''},\n\n` +
      `${headline}.\n` +
      `Ticket: ${payload.ticket_number}\n` +
      (payload.resolution_summary
        ? `\nResumen de la resolución:\n${payload.resolution_summary}\n`
        : '') +
      `\nGracias por contactarte.\n\n` +
      `— ${teamSignature}`;

    const html = `
      <h2>${this.escape(headline)}</h2>
      <p>Hola <b>${this.escape(contact.name || '')}</b>,</p>
      <ul>
        <li><b>Ticket:</b> ${payload.ticket_number}</li>
        <li><b>Estado:</b> ${payload.new_status}</li>
      </ul>
      ${
        payload.resolution_summary
          ? `<h3>Resumen</h3><pre style="white-space:pre-wrap;font-family:inherit">${this.escape(payload.resolution_summary)}</pre>`
          : ''
      }
      <p>Gracias por contactarte.</p>
      <p>— ${this.escape(teamSignature)}</p>
    `;

    const fromOverride = storeInfo
      ? {
          name: storeInfo.name,
          email: storeInfo.email,
        }
      : undefined;

    try {
      await this.emailService.sendEmail(
        contact.email,
        subject,
        html,
        text,
        fromOverride,
      );
    } catch (e) {
      this.logger.error(
        `[pqr-email] Failed to send status notification for ${payload.ticket_number}`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  private async getStoreInfo(
    storeId?: number | null,
    organizationId?: number | null,
  ): Promise<{ name: string; email: string } | null> {
    if (!storeId) return null;
    const store = await this.globalPrisma.stores.findUnique({
      where: { id: storeId },
      select: { name: true, organization_id: true },
    });
    if (!store) return null;

    const orgId = organizationId ?? store.organization_id;

    const storeAdmin = await this.globalPrisma.users.findFirst({
      where: {
        state: 'active',
        OR: [
          {
            store_users: { some: { store_id: storeId } },
            user_roles: {
              some: {
                roles: {
                  name: {
                    in: [
                      'owner',
                      'admin',
                      'manager',
                      'STORE_ADMIN',
                      'store_admin',
                    ],
                  },
                },
              },
            },
          },
          {
            main_store_id: storeId,
            user_roles: {
              some: {
                roles: {
                  name: {
                    in: [
                      'owner',
                      'admin',
                      'manager',
                      'STORE_ADMIN',
                      'store_admin',
                    ],
                  },
                },
              },
            },
          },
          {
            organization_id: orgId,
            user_roles: {
              some: {
                roles: {
                  name: { in: ['owner', 'admin', 'ORG_ADMIN', 'org_admin'] },
                },
              },
            },
          },
        ],
      },
      select: { email: true },
    });

    return {
      name: store.name,
      email: storeAdmin?.email || PqrEmailService.ADMIN_EMAIL,
    };
  }

  /* ────────────────────────────────── Helpers ──────────────────────────────── */

  /**
   * Permissive parser for the requester block. Returns null if any required
   * field is missing — the caller logs a warning and skips notification.
   * Use this in the email listener so a malformed description never crashes
   * the listener (which would leave the rest of the system in an
   * inconsistent state).
   */
  private parseRequester(
    description: string,
  ): { name: string; email: string } | null {
    if (!description) return null;
    const lines = description.split('\n');
    let name = '';
    let email = '';
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('**Nombre:**')) {
        name = line.replace('**Nombre:**', '').trim();
      } else if (line.startsWith('**Email:**')) {
        email = line.replace('**Email:**', '').trim();
        break;
      } else if (line === '---') {
        break;
      }
    }
    if (!email) return null;
    return { name, email };
  }

  private pqrTypeLabel(t: string): string {
    return (
      {
        PETITION: 'petición',
        COMPLAINT: 'queja',
        CLAIM: 'reclamo',
        SUGGESTION: 'sugerencia',
      }[t] ?? 'solicitud'
    );
  }

  private escape(s: string): string {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}