import { Module } from '@nestjs/common';
import { TicketsModule } from './tickets/tickets.module';
import { CommentsModule } from './comments/comments.module';
import { SupportNotificationsModule } from './notifications/support-notifications.module';
import { PqrModule } from './pqr/pqr.module';
import { TicketListeners } from './events/ticket.listeners';

@Module({
  imports: [TicketsModule, CommentsModule, SupportNotificationsModule, PqrModule],
  providers: [TicketListeners],
  exports: [TicketsModule, CommentsModule, PqrModule],
})
export class SupportModule {}
