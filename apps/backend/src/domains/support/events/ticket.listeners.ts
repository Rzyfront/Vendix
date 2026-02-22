import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SupportNotificationsService } from '../notifications/support-notifications.service';

@Injectable()
export class TicketListeners {
  private readonly logger = new Logger(TicketListeners.name);

  constructor(
    private readonly notificationsService: SupportNotificationsService,
  ) {}

  @OnEvent('ticket.created')
  async handleTicketCreated(payload: any) {
    this.logger.log(`Ticket created event received: #${payload.ticket_number}`);
    await this.notificationsService.notifyTicketCreated(payload);
  }

  @OnEvent('ticket.assigned')
  async handleTicketAssigned(payload: any) {
    this.logger.log(`Ticket assigned event received: #${payload.ticket_number} -> user ${payload.assigned_to_user_id}`);
    await this.notificationsService.notifyTicketAssigned(payload);
  }

  @OnEvent('ticket.status_changed')
  async handleStatusChanged(payload: any) {
    this.logger.log(
      `Ticket status changed event received: #${payload.ticket_number} ${payload.old_status} -> ${payload.new_status}`,
    );
    await this.notificationsService.notifyStatusChanged(payload);
  }

  @OnEvent('ticket.closed')
  async handleTicketClosed(payload: any) {
    this.logger.log(`Ticket closed event received: #${payload.ticket_number}`);
    await this.notificationsService.notifyTicketClosed(payload);
  }

  @OnEvent('ticket.comment_added')
  async handleCommentAdded(payload: any) {
    this.logger.log(`Comment added event received: ticket #${payload.ticket_id}`);
    // Comments can be handled with real-time notifications later
  }
}
