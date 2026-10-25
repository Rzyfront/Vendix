import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StorePrismaService } from '../prisma/services/store-prisma.service';
import { NotificationsService } from '../domains/store/notifications/notifications.service';

/** Reconciles process-crash cases where an access email remained in `sending` or `pending`. */
@Injectable()
export class ServiceSessionEmailReconciliationJob {
  private readonly logger = new Logger(ServiceSessionEmailReconciliationJob.name);
  private static readonly STALE_AFTER_MS = 10 * 60_000;
  private static readonly MAX_ROWS_PER_RUN = 500;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('*/5 * * * *')
  async reconcileStaleDeliveries() {
    const cutoff = new Date(Date.now() - ServiceSessionEmailReconciliationJob.STALE_AFTER_MS);
    try {
      const db = this.prisma.withoutScope();
      const rows = await db.service_session_email_deliveries.findMany({
        where: { status: { in: ['sending', 'pending'] }, updated_at: { lt: cutoff } },
        select: { id: true, store_id: true, session_id: true, status: true, updated_at: true },
        orderBy: { updated_at: 'asc' },
        take: ServiceSessionEmailReconciliationJob.MAX_ROWS_PER_RUN,
      });

      for (const row of rows) {
        const reconciledAt = new Date();
        const changed = await db.service_session_email_deliveries.updateMany({
          where: { id: row.id, store_id: row.store_id, status: row.status, updated_at: row.updated_at },
          data: {
            status: 'failed',
            last_error: `Email delivery remained in ${row.status} beyond the reconciliation threshold`,
            updated_at: reconciledAt,
          },
        });
        if (changed.count !== 1) continue;

        const notification = await this.notifications.createAndBroadcast(
          row.store_id,
          'service_session_email_failed',
          'Correo de seguimiento sin confirmar',
          `La atención ${row.session_id} no confirmó el envío del correo. Revisa la sesión y reenvía el enlace si corresponde.`,
          { session_id: row.session_id, route: '/admin/reservations' },
        );
        if (!notification) {
          this.logger.warn(`Stale service-session email reconciled but operator notification failed (store ${row.store_id}, session ${row.session_id}, delivery ${row.id}).`);
        }
      }

      if (rows.length === ServiceSessionEmailReconciliationJob.MAX_ROWS_PER_RUN) {
        this.logger.warn(`Service-session email reconciliation reached its ${ServiceSessionEmailReconciliationJob.MAX_ROWS_PER_RUN} row cap.`);
      }
    } catch (error) {
      this.logger.error('Service-session email reconciliation failed.', error instanceof Error ? error.stack : undefined);
    }
  }
}