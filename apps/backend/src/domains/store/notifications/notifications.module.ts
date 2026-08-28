import { Module, forwardRef } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationSoundsCatalogController } from './notification-sounds-catalog.controller';
import { NotificationsService } from './notifications.service';
import { NotificationSoundsCatalogService } from './notification-sounds-catalog.service';
import { NotificationsSseService } from './notifications-sse.service';
import { NotificationsPushService } from './notifications-push.service';
import { NotificationsEventsListener } from './notifications-events.listener';
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
  ],
  exports: [
    NotificationsService,
    NotificationsSseService,
    NotificationsPushService,
  ],
})
export class NotificationsModule {}
