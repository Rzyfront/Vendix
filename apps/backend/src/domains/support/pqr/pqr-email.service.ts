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
    const contact = this.parseRequester(payload.description);
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

    const contact = this.parseRequester(payload.description);
    if (!contact?.email) {
      this.logger.warn(
        `PQR ${payload.ticket_number}: cannot notify requester — no email parsed from description`,
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
    const subject = `[PQR ${ticket.ticket_number}] ${ticket.title}`;

    const text = [
      `New PQR received:`,
      ``,
      `Ticket:  ${ticket.ticket_number}`,
      `Type:    ${contact.pqr_type}`,
      `Subject: ${ticket.title}`,
      ``,
      `From:`,
      `  Name:  ${contact.name}`,
      `  Email: ${contact.email}`,
      contact.phone ? `  Phone: ${contact.phone}` : '',
      ``,
      `IP: ${ip}`,
      ``,
      `Description:`,
      ticket.description,
    ]
      .filter((l) => l !== '')
      .join('\n');

    const html = `
      <h2>New PQR received</h2>
      <table style="border-collapse:collapse">
        <tr><td><b>Ticket</b></td><td>${ticket.ticket_number}</td></tr>
        <tr><td><b>Type</b></td><td>${contact.pqr_type}</td></tr>
        <tr><td><b>Subject</b></td><td>${this.escape(ticket.title)}</td></tr>
      </table>
      <h3>From</h3>
      <ul>
        <li><b>Name:</b> ${this.escape(contact.name)}</li>
        <li><b>Email:</b> <a href="mailto:${this.escape(contact.email)}">${this.escape(contact.email)}</a></li>
        ${contact.phone ? `<li><b>Phone:</b> ${this.escape(contact.phone)}</li>` : ''}
        <li><b>IP:</b> ${this.escape(ip)}</li>
      </ul>
      <h3>Description</h3>
      <pre style="white-space:pre-wrap;font-family:inherit">${this.escape(ticket.description)}</pre>
    `;

    try {
      await this.emailService.sendEmail(
        PqrEmailService.ADMIN_EMAIL,
        subject,
        html,
        text,
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
    const subject = `Recibimos tu PQR #${ticket.ticket_number}`;

    const text =
      `Hola ${contact.name},\n\n` +
      `Hemos recibido tu ${this.pqrTypeLabel(contact.pqr_type)}.\n` +
      `Ticket: ${ticket.ticket_number}\n` +
      `Asunto: ${ticket.title}\n\n` +
      `Te responderemos pronto. Gracias por contactarte.\n\n` +
      `Equipo Vendix`;

    const html = `
      <h2>Recibimos tu PQR</h2>
      <p>Hola <b>${this.escape(contact.name)}</b>,</p>
      <p>Hemos recibido tu <b>${this.pqrTypeLabel(contact.pqr_type)}</b>.</p>
      <ul>
        <li><b>Ticket:</b> ${ticket.ticket_number}</li>
        <li><b>Asunto:</b> ${this.escape(ticket.title)}</li>
      </ul>
      <p>Te responderemos pronto. Gracias por contactarte.</p>
      <p>— Equipo Vendix</p>
    `;

    try {
      await this.emailService.sendEmail(contact.email, subject, html, text);
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
    const subject = `Actualización de tu PQR #${payload.ticket_number}`;

    const text =
      `Hola ${contact.name || ''},\n\n` +
      `Hemos publicado una respuesta a tu PQR ${payload.ticket_number}:\n\n` +
      `${payload.comment_content}\n\n` +
      `— Equipo Vendix`;

    const html = `
      <h2>Actualización de tu PQR</h2>
      <p>Hola <b>${this.escape(contact.name || '')}</b>,</p>
      <p>Hemos publicado una respuesta a tu PQR <b>${payload.ticket_number}</b>:</p>
      <blockquote style="border-left:3px solid #ccc;padding-left:1em;white-space:pre-wrap">${this.escape(payload.comment_content)}</blockquote>
      <p>— Equipo Vendix</p>
    `;

    try {
      await this.emailService.sendEmail(contact.email, subject, html, text);
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
    const isResolved = payload.new_status === 'RESOLVED';
    const subject = isResolved
      ? `Tu PQR #${payload.ticket_number} fue respondida`
      : `Tu PQR #${payload.ticket_number} fue cerrada`;

    const headline = isResolved
      ? 'Tu PQR fue respondida'
      : 'Tu PQR fue cerrada';

    const text =
      `Hola ${contact.name || ''},\n\n` +
      `${headline}.\n` +
      `Ticket: ${payload.ticket_number}\n` +
      (payload.resolution_summary
        ? `\nResumen de la resolución:\n${payload.resolution_summary}\n`
        : '') +
      `\nGracias por contactarte.\n\n` +
      `— Equipo Vendix`;

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
      <p>— Equipo Vendix</p>
    `;

    try {
      await this.emailService.sendEmail(contact.email, subject, html, text);
    } catch (e) {
      this.logger.error(
        `[pqr-email] Failed to send status notification for ${payload.ticket_number}`,
        e instanceof Error ? e.stack : String(e),
      );
    }
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

  private pqrTypeLabel(t: 'PETITION' | 'COMPLAINT' | 'CLAIM'): string {
    return {
      PETITION: 'petición',
      COMPLAINT: 'queja',
      CLAIM: 'reclamo',
    }[t];
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