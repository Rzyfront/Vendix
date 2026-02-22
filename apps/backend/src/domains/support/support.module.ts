import { Module } from '@nestjs/common';
import { TicketsModule } from './tickets/tickets.module';
import { CommentsModule } from './comments/comments.module';
import { SupportNotificationsModule } from './notifications/support-notifications.module';
import { TicketListeners } from './events/ticket.listeners';

@Module({
  imports: [
    TicketsModule,
    CommentsModule,
    SupportNotificationsModule,
  ],
  providers: [
    TicketListeners,
  ],
  exports: [
    TicketsModule,
    CommentsModule,
  ],
})
export class SupportModule {}
