import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { EmailService } from '../../../email/email.service';
import { ticket_status_enum } from '@prisma/client';

@Injectable()
export class SupportNotificationsService {
  private readonly logger = new Logger(SupportNotificationsService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly emailService: EmailService,
  ) {}

  async notifyTicketCreated(data: {
    ticket_id: number;
    ticket_number: string;
    organization_id: number;
    store_id?: number;
    created_by_user_id: number;
    priority: string;
    category: string;
    title: string;
  }) {
    try {
      // Get ticket and creator info
      const ticket = await this.prisma.support_tickets.findUnique({
        where: { id: data.ticket_id },
        include: {
          created_by: {
            select: { id: true, email: true, first_name: true, last_name: true },
          },
        },
      });

      if (!ticket || !ticket.created_by) {
        this.logger.warn('Cannot send notification: ticket or creator not found');
        return;
      }

      const creatorEmail = ticket.created_by.email;
      const creatorName = `${ticket.created_by.first_name} ${ticket.created_by.last_name}`.trim();

      // Send email to ticket creator
      const emailHtml = this.generateTicketCreatedEmail({
        ticketNumber: data.ticket_number,
        title: data.title,
        priority: data.priority,
        category: data.category,
        creatorName,
      });

      await this.emailService.sendEmail(
        creatorEmail,
        `Nuevo Ticket #${data.ticket_number}`,
        emailHtml,
        `Tu ticket #${data.ticket_number} ha sido creado exitosamente. Te notificaremos cuando haya actualizaciones.`,
      );

      // Create notification record
      await this.prisma.support_notifications.create({
        data: {
          ticket_id: data.ticket_id,
          user_id: data.created_by_user_id,
          user_email: creatorEmail,
          channel: 'email',
          status: 'sent',
          subject: `Nuevo Ticket #${data.ticket_number}`,
          message: `Ticket creado: ${data.title}`,
          template_name: 'ticket-created',
          sent_at: new Date(),
          created_at: new Date(),
        },
      });

      // Notify admins for high priority tickets
      if (data.priority === 'P0' || data.priority === 'P1') {
        await this.notifyAdminsForUrgentTicket(data);
      }

      this.logger.log(`Ticket created notification sent to ${creatorEmail}`);
    } catch (error) {
      this.logger.error(`Error sending ticket created notification: ${error.message}`);
    }
  }

  async notifyTicketAssigned(data: {
    ticket_id: number;
    ticket_number: string;
    assigned_to_user_id: number;
    assigned_by_user_id: number;
  }) {
    try {
      // Get ticket and assigned user info
      const ticket = await this.prisma.support_tickets.findUnique({
        where: { id: data.ticket_id },
        include: {
          assigned_to: {
            select: { id: true, email: true, first_name: true, last_name: true },
          },
          created_by: {
            select: { id: true, email: true, first_name: true, last_name: true },
          },
        },
      });

      if (!ticket || !ticket.assigned_to) {
        this.logger.warn('Cannot send notification: ticket or assigned user not found');
        return;
      }

      const assigneeEmail = ticket.assigned_to.email;
      const assigneeName = `${ticket.assigned_to.first_name} ${ticket.assigned_to.last_name}`.trim();

      const emailHtml = this.generateTicketAssignedEmail({
        ticketNumber: data.ticket_number,
        title: ticket.title,
        assigneeName,
      });

      await this.emailService.sendEmail(
        assigneeEmail,
        `Ticket Asignado #${data.ticket_number}`,
        emailHtml,
        `El ticket #${data.ticket_number} te ha sido asignado.`,
      );

      // Create notification record
      await this.prisma.support_notifications.create({
        data: {
          ticket_id: data.ticket_id,
          user_id: data.assigned_to_user_id,
          user_email: assigneeEmail,
          channel: 'email',
          status: 'sent',
          subject: `Ticket Asignado #${data.ticket_number}`,
          message: `Ticket asignado: ${ticket.title}`,
          template_name: 'ticket-assigned',
          sent_at: new Date(),
          created_at: new Date(),
        },
      });

      this.logger.log(`Ticket assigned notification sent to ${assigneeEmail}`);
    } catch (error) {
      this.logger.error(`Error sending ticket assigned notification: ${error.message}`);
    }
  }

  async notifyStatusChanged(data: {
    ticket_id: number;
    ticket_number: string;
    old_status: ticket_status_enum;
    new_status: ticket_status_enum;
  }) {
    try {
      const ticket = await this.prisma.support_tickets.findUnique({
        where: { id: data.ticket_id },
        select: {
          id: true,
          title: true,
          created_by_user_id: true,
          assigned_to_user_id: true,
        },
      });

      if (!ticket) {
        return;
      }

      // Notify creator
      const creator = await this.prisma.users.findUnique({
        where: { id: ticket.created_by_user_id },
        select: { email: true, first_name: true, last_name: true },
      });

      if (creator) {
        const creatorName = `${creator.first_name} ${creator.last_name}`.trim();
        const emailHtml = this.generateStatusChangedEmail({
          ticketNumber: data.ticket_number,
          title: ticket.title,
          oldStatus: data.old_status,
          newStatus: data.new_status,
          customerName: creatorName,
        });

        await this.emailService.sendEmail(
          creator.email,
          `Actualización Ticket #${data.ticket_number}`,
          emailHtml,
          `El ticket #${data.ticket_number} ha cambiado de estado.`,
        );

        // Create notification record
        await this.prisma.support_notifications.create({
          data: {
            ticket_id: data.ticket_id,
            user_id: ticket.created_by_user_id,
            user_email: creator.email,
            channel: 'email',
            status: 'sent',
            subject: `Actualización Ticket #${data.ticket_number}`,
            message: `Estado cambiado de ${data.old_status} a ${data.new_status}`,
            template_name: 'ticket-status-changed',
            sent_at: new Date(),
            created_at: new Date(),
          },
        });
      }

      this.logger.log(`Status changed notification sent for ticket ${data.ticket_number}`);
    } catch (error) {
      this.logger.error(`Error sending status changed notification: ${error.message}`);
    }
  }

  async notifyTicketClosed(data: {
    ticket_id: number;
    ticket_number: string;
    resolution_summary?: string;
  }) {
    try {
      const ticket = await this.prisma.support_tickets.findUnique({
        where: { id: data.ticket_id },
        include: {
          created_by: {
            select: { email: true, first_name: true, last_name: true },
          },
        },
      });

      if (!ticket || !ticket.created_by) {
        return;
      }

      const creatorEmail = ticket.created_by.email;
      const creatorName = `${ticket.created_by.first_name} ${ticket.created_by.last_name}`.trim();

      const emailHtml = this.generateTicketClosedEmail({
        ticketNumber: data.ticket_number,
        title: ticket.title,
        resolutionSummary: data.resolution_summary,
        customerName: creatorName,
      });

      await this.emailService.sendEmail(
        creatorEmail,
        `Ticket Cerrado #${data.ticket_number}`,
        emailHtml,
        `El ticket #${data.ticket_number} ha sido cerrado.`,
      );

      // Create notification record
      await this.prisma.support_notifications.create({
        data: {
          ticket_id: data.ticket_id,
          user_id: ticket.created_by_user_id,
          user_email: creatorEmail,
          channel: 'email',
          status: 'sent',
          subject: `Ticket Cerrado #${data.ticket_number}`,
          message: `Ticket cerrado: ${data.resolution_summary || 'Sin descripción'}`,
          template_name: 'ticket-closed',
          sent_at: new Date(),
          created_at: new Date(),
        },
      });

      this.logger.log(`Ticket closed notification sent to ${creatorEmail}`);
    } catch (error) {
      this.logger.error(`Error sending ticket closed notification: ${error.message}`);
    }
  }

  private async notifyAdminsForUrgentTicket(data: {
    ticket_id: number;
    ticket_number: string;
    organization_id: number;
    priority: string;
    title: string;
  }) {
    try {
      // Get admins for the organization
      const admins = await this.prisma.users.findMany({
        where: {
          organization_id: data.organization_id,
          user_roles: {
            some: {
              roles: {
                name: { in: ['ORG_ADMIN', 'STORE_ADMIN'] },
              },
            },
          },
        },
        select: { email: true, first_name: true, last_name: true },
        take: 10,
      });

      for (const admin of admins) {
        const emailHtml = this.generateUrgentTicketEmail({
          ticketNumber: data.ticket_number,
          title: data.title,
          priority: data.priority,
          adminName: `${admin.first_name} ${admin.last_name}`.trim(),
        });

        await this.emailService.sendEmail(
          admin.email,
          `⚠️ Ticket Urgente #${data.ticket_number}`,
          emailHtml,
          `Se ha creado un ticket de alta prioridad que requiere atención inmediata.`,
        );

        this.logger.log(`Urgent ticket notification sent to admin: ${admin.email}`);
      }
    } catch (error) {
      this.logger.error(`Error sending urgent ticket notification: ${error.message}`);
    }
  }

  // Email template generators

  private generateTicketCreatedEmail(data: {
    ticketNumber: string;
    title: string;
    priority: string;
    category: string;
    creatorName: string;
  }): string {
    const priorityColors = {
      P0: '#dc2626',
      P1: '#ea580c',
      P2: '#d97706',
      P3: '#2563eb',
      P4: '#6c757d',
    };

    const priorityLabels = {
      P0: 'Crítica',
      P1: 'Urgente',
      P2: 'Alta',
      P3: 'Normal',
      P4: 'Baja',
    };

    const categoryLabels: Record<string, string> = {
      QUESTION: 'Duda',
      SERVICE_REQUEST: 'Solicitud',
      INCIDENT: 'Incidente',
      PROBLEM: 'Problema',
      CHANGE: 'Cambio',
    };

    const displayTitle = data.title || 'Ticket creado';
    const displayCategory = data.category ? categoryLabels[data.category] || data.category : 'General';

    return `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Nuevo Ticket Creado</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #F8FAFC; }
          .container { max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
          .header { background: linear-gradient(135deg, #7ED7A5 0%, #2F6F4E 100%); padding: 50px 30px; text-align: center; position: relative; }
          .header::before { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="white" stroke-width="0.5" opacity="0.1"/></pattern></defs><rect width="100" height="100" fill="url(%23grid)"/></svg>') repeat; opacity: 0.1; }
          .header h1 { color: #FFFFFF; margin: 0; font-size: 32px; font-weight: 700; position: relative; z-index: 1; }
          .header .subtitle { color: rgba(255, 255, 255, 0.9); margin: 10px 0 0 0; font-size: 16px; position: relative; z-index: 1; }
          .content { padding: 50px 30px; }
          .welcome-section { text-align: center; margin-bottom: 40px; }
          .welcome-emoji { font-size: 48px; margin-bottom: 20px; }
          .welcome-title { font-size: 24px; color: #1F2937; margin-bottom: 15px; font-weight: 700; }
          .welcome-message { color: #4B5563; line-height: 1.7; margin-bottom: 30px; font-size: 16px; }
          .ticket-card { background: linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%); border: 2px solid #BBF7D0; border-radius: 12px; padding: 30px; margin: 30px 0; }
          .ticket-number { font-size: 28px; font-weight: bold; color: #166534; margin-bottom: 15px; }
          .ticket-title { font-size: 18px; color: #1F2937; margin-bottom: 20px; font-weight: 600; }
          .badge { display: inline-block; padding: 8px 16px; border-radius: 6px; font-size: 14px; font-weight: 600; margin: 5px 5px 5px 0; }
          .badge-priority { background-color: ${priorityColors[data.priority as keyof typeof priorityColors] || '#6c757d'}; color: white; }
          .badge-category { background-color: #E5E7EB; color: #374151; }
          .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 20px; }
          .info-item { background-color: #FFFFFF; border-radius: 8px; padding: 15px; border: 1px solid #E5E7EB; }
          .info-label { color: #6B7280; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
          .info-value { color: #1F2937; font-size: 16px; font-weight: 600; margin-top: 5px; }
          .divider { border-top: 2px solid #E5E7EB; margin: 40px 0; }
          .footer { background-color: #1F2937; padding: 30px; text-align: center; color: #D1D5DB; font-size: 14px; }
          .footer-logo { font-size: 24px; font-weight: 700; color: #7ED7A5; margin-bottom: 15px; }
          .footer-links { margin: 20px 0; }
          .footer-links a { color: #7ED7A5; text-decoration: none; margin: 0 10px; }
          .footer-links a:hover { text-decoration: underline; }
          .copyright { margin-top: 20px; color: #9CA3AF; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎫 Vendix Soporte</h1>
            <div class="subtitle">Ticket de Soporte</div>
          </div>
          <div class="content">
            <div class="welcome-section">
              <div class="welcome-emoji">✅</div>
              <div class="welcome-title">¡Ticket creado exitosamente!</div>
              <div class="welcome-message">
                Hola <strong>${data.creatorName}</strong>, tu ticket ha sido creado.
                Te notificaremos cuando haya actualizaciones.
              </div>
            </div>

            <div class="ticket-card">
              <div class="ticket-number">#${data.ticketNumber}</div>
              <div class="ticket-title">${displayTitle}</div>
              <div>
                <span class="badge badge-priority">Prioridad: ${priorityLabels[data.priority as keyof typeof priorityLabels] || data.priority}</span>
                <span class="badge badge-category">${displayCategory}</span>
              </div>
              <div class="info-grid">
                <div class="info-item">
                  <div class="info-label">Estado Actual</div>
                  <div class="info-value">🆕 Nuevo</div>
                </div>
                <div class="info-item">
                  <div class="info-label">Tiempo de Respuesta</div>
                  <div class="info-value">⏱️ 24-48h</div>
                </div>
              </div>
            </div>

            <div style="text-align: center; margin: 30px 0; padding: 25px; background-color: #F8FAFC; border-radius: 12px; border: 1px solid #E2E8F0;">
              <div style="color: #4B5563; font-size: 14px; line-height: 1.7;">
                📌 <strong>Puedes hacer seguimiento a tu ticket desde el panel de soporte.</strong><br><br>
                Te notificaremos por correo cuando haya actualizaciones en tu ticket.<br>
                Si tienes alguna pregunta adicional, no dudes en responder este correo.
              </div>
            </div>
          </div>
          <div class="footer">
            <div class="footer-logo">Vendix</div>
            <div class="footer-links">
              <a href="https://vendix.com">Sitio Web</a>
              <a href="mailto:soporte@vendix.com">Soporte</a>
              <a href="https://help.vendix.com">Ayuda</a>
            </div>
            <div class="copyright">
              © ${new Date().getFullYear()} Vendix. Todos los derechos reservados.<br>
              Este ticket será atendido lo antes posible.
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private generateTicketAssignedEmail(data: {
    ticketNumber: string;
    title: string;
    assigneeName: string;
  }): string {
    const displayTitle = data.title || 'Ticket creado';
    return `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Ticket Asignado</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #F8FAFC; }
          .container { max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
          .header { background: linear-gradient(135deg, #7ED7A5 0%, #2F6F4E 100%); padding: 50px 30px; text-align: center; position: relative; }
          .header::before { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="white" stroke-width="0.5" opacity="0.1"/></pattern></defs><rect width="100" height="100" fill="url(%23grid)"/></svg>') repeat; opacity: 0.1; }
          .header h1 { color: #FFFFFF; margin: 0; font-size: 32px; font-weight: 700; position: relative; z-index: 1; }
          .header .subtitle { color: rgba(255, 255, 255, 0.9); margin: 10px 0 0 0; font-size: 16px; position: relative; z-index: 1; }
          .content { padding: 50px 30px; }
          .welcome-section { text-align: center; margin-bottom: 40px; }
          .welcome-emoji { font-size: 48px; margin-bottom: 20px; }
          .welcome-title { font-size: 24px; color: #1F2937; margin-bottom: 15px; font-weight: 700; }
          .welcome-message { color: #4B5563; line-height: 1.7; margin-bottom: 30px; font-size: 16px; }
          .ticket-card { background: linear-gradient(135deg, #DBEAFE 0%, #BFDBFE 100%); border: 2px solid #3B82F6; border-radius: 12px; padding: 30px; margin: 30px 0; text-align: center; }
          .ticket-number { font-size: 28px; font-weight: bold; color: #1E3A8A; margin-bottom: 10px; }
          .ticket-title { font-size: 16px; color: #1E40AF; }
          .footer { background-color: #1F2937; padding: 30px; text-align: center; color: #D1D5DB; font-size: 14px; }
          .footer-logo { font-size: 24px; font-weight: 700; color: #7ED7A5; margin-bottom: 15px; }
          .footer-links { margin: 20px 0; }
          .footer-links a { color: #7ED7A5; text-decoration: none; margin: 0 10px; }
          .copyright { margin-top: 20px; color: #9CA3AF; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📋 Vendix Soporte</h1>
            <div class="subtitle">Ticket Asignado</div>
          </div>
          <div class="content">
            <div class="welcome-section">
              <div class="welcome-emoji">📌</div>
              <div class="welcome-title">Nuevo ticket asignado</div>
              <div class="welcome-message">
                Hola <strong>${data.assigneeName}</strong>, se te ha asignado un nuevo ticket de soporte.
              </div>
            </div>

            <div class="ticket-card">
              <div class="ticket-number">#${data.ticketNumber}</div>
              <div class="ticket-title">${displayTitle}</div>
              <div style="margin-top: 20px; color: #1E40AF; font-size: 14px;">
                Por favor revisa los detalles y toma las acciones necesarias lo antes posible.
              </div>
            </div>

            <div style="text-align: center; margin: 30px 0; padding: 25px; background-color: #F8FAFC; border-radius: 12px; border: 1px solid #E2E8F0;">
              <div style="color: #4B5563; font-size: 14px;">
                💡 <strong>Puedes ver y gestionar este ticket desde el panel de soporte.</strong>
              </div>
            </div>
          </div>
          <div class="footer">
            <div class="footer-logo">Vendix</div>
            <div class="footer-links">
              <a href="https://vendix.com">Sitio Web</a>
              <a href="mailto:soporte@vendix.com">Soporte</a>
            </div>
            <div class="copyright">
              © ${new Date().getFullYear()} Vendix. Todos los derechos reservados.
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private generateStatusChangedEmail(data: {
    ticketNumber: string;
    title: string;
    oldStatus: string;
    newStatus: string;
    customerName: string;
  }): string {
    const statusLabels: Record<string, string> = {
      NEW: 'Nuevo',
      OPEN: 'Abierto',
      IN_PROGRESS: 'En Progreso',
      WAITING_RESPONSE: 'Esperando Respuesta',
      RESOLVED: 'Resuelto',
      CLOSED: 'Cerrado',
      REOPENED: 'Reabierto',
    };

    const statusColors: Record<string, string> = {
      NEW: '#6c757d',
      OPEN: '#0d6efd',
      IN_PROGRESS: '#0dcaf0',
      WAITING_RESPONSE: '#ffc107',
      RESOLVED: '#198754',
      CLOSED: '#dc3545',
    };

    const displayTitle = data.title || 'Ticket creado';
    const oldStatusLabel = statusLabels[data.oldStatus] || data.oldStatus;
    const newStatusLabel = statusLabels[data.newStatus] || data.newStatus;

    return `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Actualización de Ticket</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #F8FAFC; }
          .container { max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
          .header { background: linear-gradient(135deg, #7ED7A5 0%, #2F6F4E 100%); padding: 50px 30px; text-align: center; position: relative; }
          .header::before { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="white" stroke-width="0.5" opacity="0.1"/></pattern></defs><rect width="100" height="100" fill="url(%23grid)"/></svg>') repeat; opacity: 0.1; }
          .header h1 { color: #FFFFFF; margin: 0; font-size: 32px; font-weight: 700; position: relative; z-index: 1; }
          .header .subtitle { color: rgba(255, 255, 255, 0.9); margin: 10px 0 0 0; font-size: 16px; position: relative; z-index: 1; }
          .content { padding: 50px 30px; }
          .welcome-section { text-align: center; margin-bottom: 40px; }
          .welcome-emoji { font-size: 48px; margin-bottom: 20px; }
          .welcome-title { font-size: 24px; color: #1F2937; margin-bottom: 15px; font-weight: 700; }
          .welcome-message { color: #4B5563; line-height: 1.7; margin-bottom: 30px; font-size: 16px; }
          .ticket-card { background: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%); border: 2px solid #F59E0B; border-radius: 12px; padding: 30px; margin: 30px 0; }
          .ticket-number { font-size: 28px; font-weight: bold; color: #92400E; margin-bottom: 10px; }
          .status-change { display: flex; align-items: center; justify-content: center; gap: 15px; margin: 20px 0; }
          .status-box { padding: 12px 20px; border-radius: 8px; font-weight: 600; }
          .arrow { font-size: 24px; color: #92400E; }
          .footer { background-color: #1F2937; padding: 30px; text-align: center; color: #D1D5DB; font-size: 14px; }
          .footer-logo { font-size: 24px; font-weight: 700; color: #7ED7A5; margin-bottom: 15px; }
          .copyright { margin-top: 20px; color: #9CA3AF; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📊 Vendix Soporte</h1>
            <div class="subtitle">Actualización de Ticket</div>
          </div>
          <div class="content">
            <div class="welcome-section">
              <div class="welcome-emoji">🔔</div>
              <div class="welcome-title">Tu ticket ha sido actualizado</div>
              <div class="welcome-message">
                Hola <strong>${data.customerName}</strong>, hay novedades en tu ticket de soporte.
              </div>
            </div>

            <div class="ticket-card">
              <div class="ticket-number">#${data.ticketNumber}</div>
              <div style="color: #92400E; font-size: 14px; margin-bottom: 20px;">${displayTitle}</div>
              <div class="status-change">
                <div class="status-box" style="background-color: ${statusColors[data.oldStatus] || '#6c757d'}; color: white;">${oldStatusLabel}</div>
                <div class="arrow">→</div>
                <div class="status-box" style="background-color: ${statusColors[data.newStatus] || '#6c757d'}; color: white;">${newStatusLabel}</div>
              </div>
            </div>

            <div style="text-align: center; margin: 30px 0; padding: 25px; background-color: #F8FAFC; border-radius: 12px; border: 1px solid #E2E8F0;">
              <div style="color: #4B5563; font-size: 14px;">
                📌 Te notificaremos cuando haya más cambios en tu ticket.<br>
                💡 Puedes hacer seguimiento desde el panel de soporte.
              </div>
            </div>
          </div>
          <div class="footer">
            <div class="footer-logo">Vendix</div>
            <div class="copyright">
              © ${new Date().getFullYear()} Vendix. Todos los derechos reservados.
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private generateTicketClosedEmail(data: {
    ticketNumber: string;
    title: string;
    resolutionSummary?: string;
    customerName: string;
  }): string {
    const displayTitle = data.title || 'Ticket creado';
    return `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Ticket Cerrado</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #F8FAFC; }
          .container { max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
          .header { background: linear-gradient(135deg, #7ED7A5 0%, #2F6F4E 100%); padding: 50px 30px; text-align: center; position: relative; }
          .header::before { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="white" stroke-width="0.5" opacity="0.1"/></pattern></defs><rect width="100" height="100" fill="url(%23grid)"/></svg>') repeat; opacity: 0.1; }
          .header h1 { color: #FFFFFF; margin: 0; font-size: 32px; font-weight: 700; position: relative; z-index: 1; }
          .header .subtitle { color: rgba(255, 255, 255, 0.9); margin: 10px 0 0 0; font-size: 16px; position: relative; z-index: 1; }
          .content { padding: 50px 30px; }
          .welcome-section { text-align: center; margin-bottom: 40px; }
          .welcome-emoji { font-size: 48px; margin-bottom: 20px; }
          .welcome-title { font-size: 24px; color: #1F2937; margin-bottom: 15px; font-weight: 700; }
          .welcome-message { color: #4B5563; line-height: 1.7; margin-bottom: 30px; font-size: 16px; }
          .ticket-card { background: linear-gradient(135deg, #D1FAE5 0%, #A7F3D0 100%); border: 2px solid #10B981; border-radius: 12px; padding: 30px; margin: 30px 0; }
          .ticket-number { font-size: 28px; font-weight: bold; color: #065F46; margin-bottom: 10px; }
          .resolution-box { background-color: #FFFFFF; border-radius: 8px; padding: 20px; margin-top: 20px; border: 1px solid #A7F3D0; }
          .resolution-label { color: #059669; font-size: 14px; font-weight: 600; margin-bottom: 10px; }
          .resolution-text { color: #047857; line-height: 1.6; }
          .footer { background-color: #1F2937; padding: 30px; text-align: center; color: #D1D5DB; font-size: 14px; }
          .footer-logo { font-size: 24px; font-weight: 700; color: #7ED7A5; margin-bottom: 15px; }
          .copyright { margin-top: 20px; color: #9CA3AF; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ Vendix Soporte</h1>
            <div class="subtitle">Ticket Cerrado</div>
          </div>
          <div class="content">
            <div class="welcome-section">
              <div class="welcome-emoji">🎉</div>
              <div class="welcome-title">¡Tu ticket ha sido resuelto!</div>
              <div class="welcome-message">
                Hola <strong>${data.customerName}</strong>, tu ticket de soporte ha sido cerrado exitosamente.
              </div>
            </div>

            <div class="ticket-card">
              <div class="ticket-number">#${data.ticketNumber}</div>
              <div style="color: #047857; font-size: 14px; margin-bottom: 15px;">${displayTitle}</div>
              ${data.resolutionSummary ? `
              <div class="resolution-box">
                <div class="resolution-label">📋 Resolución:</div>
                <div class="resolution-text">${data.resolutionSummary}</div>
              </div>
              ` : '<div style="color: #047857; font-size: 14px;">Esperamos haber resuelto tu solicitud satisfactoriamente.</div>'}
            </div>

            <div style="text-align: center; margin: 30px 0; padding: 25px; background-color: #F8FAFC; border-radius: 12px; border: 1px solid #E2E8F0;">
              <div style="color: #4B5563; font-size: 14px; line-height: 1.7;">
                💡 Si tienes alguna pregunta adicional o el problema persiste,<br>
                puedes crear un nuevo ticket desde el panel de soporte.<br><br>
                ¡Gracias por contactarnos! 🙏
              </div>
            </div>
          </div>
          <div class="footer">
            <div class="footer-logo">Vendix</div>
            <div class="copyright">
              © ${new Date().getFullYear()} Vendix. Todos los derechos reservados.<br>
              Estamos aquí para ayudarte.
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private generateUrgentTicketEmail(data: {
    ticketNumber: string;
    title: string;
    priority: string;
    adminName: string;
  }): string {
    const displayTitle = data.title || 'Ticket creado';
    const priorityColors = {
      P0: '#dc2626',
      P1: '#ea580c',
    };

    const priorityLabels = {
      P0: 'Crítica',
      P1: 'Urgente',
    };

    const headerColor = priorityColors[data.priority as keyof typeof priorityColors] || '#dc2626';
    const priorityLabel = priorityLabels[data.priority as keyof typeof priorityLabels] || data.priority;

    return `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>⚠️ Ticket Urgente</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #F8FAFC; }
          .container { max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
          .header { background: linear-gradient(135deg, ${headerColor} 0%, #991B1B 100%); padding: 50px 30px; text-align: center; position: relative; }
          .header::before { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="white" stroke-width="0.5" opacity="0.2"/></pattern></defs><rect width="100" height="100" fill="url(%23grid)"/></svg>') repeat; opacity: 0.15; }
          .header h1 { color: #FFFFFF; margin: 0; font-size: 32px; font-weight: 700; position: relative; z-index: 1; }
          .header .subtitle { color: rgba(255, 255, 255, 0.9); margin: 10px 0 0 0; font-size: 16px; position: relative; z-index: 1; }
          .content { padding: 50px 30px; }
          .welcome-section { text-align: center; margin-bottom: 40px; }
          .welcome-emoji { font-size: 48px; margin-bottom: 20px; }
          .welcome-title { font-size: 24px; color: #1F2937; margin-bottom: 15px; font-weight: 700; }
          .welcome-message { color: #4B5563; line-height: 1.7; margin-bottom: 30px; font-size: 16px; }
          .urgent-card { background: linear-gradient(135deg, #FEE2E2 0%, #FECACA 100%); border: 2px solid #DC2626; border-radius: 12px; padding: 30px; margin: 30px 0; }
          .ticket-number { font-size: 28px; font-weight: bold; color: #991B1B; margin-bottom: 10px; }
          .priority-badge { display: inline-block; background-color: ${headerColor}; color: white; padding: 8px 16px; border-radius: 6px; font-weight: 600; font-size: 14px; margin: 10px 0; }
          .alert-box { background-color: #FFFFFF; border-radius: 8px; padding: 20px; margin-top: 20px; border-left: 4px solid #DC2626; }
          .alert-text { color: #991B1B; font-size: 14px; line-height: 1.6; }
          .footer { background-color: #1F2937; padding: 30px; text-align: center; color: #D1D5DB; font-size: 14px; }
          .footer-logo { font-size: 24px; font-weight: 700; color: #7ED7A5; margin-bottom: 15px; }
          .copyright { margin-top: 20px; color: #9CA3AF; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>⚠️ Vendix Soporte</h1>
            <div class="subtitle">Ticket Urgente</div>
          </div>
          <div class="content">
            <div class="welcome-section">
              <div class="welcome-emoji">🚨</div>
              <div class="welcome-title">Se requiere atención inmediata</div>
              <div class="welcome-message">
                Hola <strong>${data.adminName}</strong>, se ha creado un ticket de alta prioridad que requiere tu atención urgente.
              </div>
            </div>

            <div class="urgent-card">
              <div class="ticket-number">#${data.ticketNumber}</div>
              <div style="color: #991B1B; font-size: 16px; margin-bottom: 15px; font-weight: 600;">${displayTitle}</div>
              <div class="priority-badge">Prioridad: ${priorityLabel}</div>
              <div class="alert-box">
                <div class="alert-text">
                  <strong>⚠️ Acción requerida:</strong> Por favor revisa este ticket lo antes posible y toma las acciones necesarias para resolverlo.
                </div>
              </div>
            </div>

            <div style="text-align: center; margin: 30px 0; padding: 25px; background-color: #F8FAFC; border-radius: 12px; border: 1px solid #E2E8F0;">
              <div style="color: #4B5563; font-size: 14px;">
                💡 <strong>Accede al panel de soporte para gestionar este ticket.</strong>
              </div>
            </div>
          </div>
          <div class="footer">
            <div class="footer-logo">Vendix</div>
            <div class="copyright">
              © ${new Date().getFullYear()} Vendix. Todos los derechos reservados.<br>
              Gracias por tu atención rápida.
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}
