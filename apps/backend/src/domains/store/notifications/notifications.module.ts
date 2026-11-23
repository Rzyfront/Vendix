import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createNotificationTools } from '../../../ai-engine/tools/domains/notifications.tools';
import { NotificationsController } from './notifications.controller';
import { NotificationSoundsCatalogController } from './notification-sounds-catalog.controller';
import { NotificationsService } from './notifications.service';
import { NotificationSoundsCatalogService } from './notification-sounds-catalog.service';
import { NotificationsSseService } from './notifications-sse.service';
import { NotificationsPushService } from './notifications-push.service';
import { NotificationsEventsListener } from './notifications-events.listener';
import { NotificationDispatcher } from './notification-dispatcher.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationRecipientsService } from './notification-recipients.service';
import { NotificationEmailService } from './notification-email.service';
import { NotificationDeliveriesJob } from './notification-deliveries.job';
import { MyNotificationsService } from './my-notifications.service';
import { ReminderScheduler } from './reminders/reminder-scheduler.service';
import { ReminderSourceRegistry } from './reminders/reminder-source.registry';
import { ScheduledRemindersJob } from './reminders/scheduled-reminders.job';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { EmailModule } from '../../../email/email.module';
import { S3Module } from '../../../common/services/s3.module';
import { AppointmentQueueModule } from '../reservations/appointment-queue/appointment-queue.module';
// La entrega PRIMARIA de facturas (`@OnEvent('invoice.pdf.generated')` en
// `notifications-events.listener.ts`) delega en `InvoiceDeliveryService` para
// armar el `.zip` con `AttachedDocument` que exige el Anexo Técnico 1.9 §9.1,
// en vez de reimplementarlo con adjuntos sueltos.
//
// Sin ciclo: `InvoiceDeliveryModule` importa Prisma/S3/Email/PrintFormats y
// ninguno de ellos conoce este módulo. Deliberadamente NO se usa
// `forwardRef`, porque no hay dependencia mutua que resolver — si algún día
// `InvoiceDeliveryModule` necesitara notificaciones, eso sería el ciclo real y
// debe resolverse ahí, no ocultarse aquí.
import { InvoiceDeliveryModule } from '../invoicing/delivery/invoice-delivery.module';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    EmailModule,
    S3Module,
    InvoiceDeliveryModule,
    forwardRef(() => AppointmentQueueModule),
  ],
  controllers: [NotificationsController, NotificationSoundsCatalogController],
  providers: [
    NotificationsService,
    NotificationsSseService,
    NotificationsPushService,
    NotificationsEventsListener,
    NotificationSoundsCatalogService,
    // Avisos personales con preferencias por canal (plan recordatorios §3.1).
    NotificationDispatcher,
    NotificationPreferencesService,
    NotificationRecipientsService,
    NotificationEmailService,
    MyNotificationsService,
    // Cron: solo corre en el worker (la API desmonta los @Cron en main.ts).
    NotificationDeliveriesJob,
    // Recordatorios con fecha (plan §3.1b): cada módulo registra su fuente en
    // `ReminderSourceRegistry` y programa con `ReminderScheduler`.
    ReminderScheduler,
    ReminderSourceRegistry,
    ScheduledRemindersJob,
  ],
  exports: [
    NotificationsService,
    NotificationsSseService,
    NotificationsPushService,
    NotificationDispatcher,
    NotificationPreferencesService,
    ReminderScheduler,
    ReminderSourceRegistry,
  ],
})
export class NotificationsModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly notificationsService: NotificationsService,
    private readonly pushService: NotificationsPushService,
  ) {}

  /**
   * D-12/D-13: registro descentralizado en el módulo dueño, no en
   * `AIEngineModule` (ciclo DI). `AIToolRegistry` viene del módulo global.
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createNotificationTools({
        notificationsService: this.notificationsService,
        pushService: this.pushService,
      }),
    );
  }
}
