import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { NotificationsService } from '../../store/notifications/notifications.service';

@Injectable()
export class PayrollDefaultsNotificationsListener {
  private readonly logger = new Logger(PayrollDefaultsNotificationsListener.name);

  constructor(
    private readonly global_prisma: GlobalPrismaService,
    private readonly notifications_service: NotificationsService,
  ) {}

  @OnEvent('payroll_defaults.published')
  async handlePayrollDefaultsPublished(event: {
    year: number;
    decree_ref?: string | null;
  }) {
    try {
      const orgs = await this.global_prisma.organizations.findMany({
        select: { id: true },
      });

      let notified_count = 0;

      for (const org of orgs) {
        const stores = await this.global_prisma.stores.findMany({
          where: { organization_id: org.id },
          select: { id: true },
        });

        for (const store of stores) {
          try {
            await this.notifications_service.createAndBroadcast(
              store.id,
              'payroll_rules_update',
              `Actualización de nómina ${event.year}`,
              `Nuevos parámetros de nómina disponibles para ${event.year}${event.decree_ref ? '. ' + event.decree_ref : ''}.`,
              { year: event.year, decree_ref: event.decree_ref ?? null },
            );
            notified_count++;
          } catch (store_err) {
            this.logger.warn(
              `Failed to notify store #${store.id}: ${store_err.message}`,
            );
          }
        }
      }

      this.logger.log(
        `Payroll defaults ${event.year} published — notified ${notified_count} stores across ${orgs.length} organizations`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to broadcast payroll defaults notification: ${error.message}`,
        error.stack,
      );
    }
  }
}
