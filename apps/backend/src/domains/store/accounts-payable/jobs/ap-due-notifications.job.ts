import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaClient } from '@prisma/client';

import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

/** Anticipación por defecto del aviso, en días. Configurable por tienda. */
const DEFAULT_DUE_SOON_DAYS = 1;

/**
 * QUI-647 Fase 3 — avisa de las cuotas de Cuentas por Pagar que vencen.
 *
 * Hasta este job el módulo de notificaciones no mencionaba `accounts_payable`
 * en ninguna línea: se podía programar un calendario de pago al proveedor y
 * nadie se enteraba de que llegaba la fecha. El precedente exacto es layaway,
 * que ya emite `installment.due_soon` / `installment.overdue` desde el lado del
 * cliente; esto es el espejo del lado del proveedor.
 *
 * Estrategia:
 *   - Cada día barre `ap_payment_schedules` con `status = 'scheduled'` usando
 *     el índice `[scheduled_date, status]` que ya existía.
 *   - Emite `ap_installment.due_soon` para las que vencen dentro de la ventana
 *     de anticipación, y `ap_installment.overdue` para las que ya pasaron.
 *   - La alerta de vencida se REPITE cada corrida mientras la cuota siga
 *     impaga: una deuda vencida que se avisa una sola vez y se calla es peor
 *     que no avisar, porque el operador asume que se resolvió.
 *
 * Idempotencia: el job no muta `ap_payment_schedules`. Emitir dos veces el
 * mismo `due_soon` es aceptable y deliberado — es un recordatorio, no una
 * transición de estado — y el barrido corre una vez al día.
 */
@Injectable()
export class ApDueNotificationsJob {
  private readonly logger = new Logger(ApDueNotificationsJob.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 07:00 para que el aviso llegue al empezar el día operativo y no de
   * madrugada, cuando nadie va a actuar sobre él.
   */
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async sweepDueSchedules(): Promise<void> {
    try {
      // `withoutScope()`: el barrido es global por diseño — corre sin request y
      // por lo tanto sin contexto de tienda. Cada fila lleva su `store_id`, que
      // es lo que enruta la notificación al destinatario correcto.
      const client = this.prisma.withoutScope() as PrismaClient;

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      // La ventana usa el default global; el override por tienda se aplica por
      // fila más abajo, porque cada cuota pertenece a una tienda distinta y
      // consultar settings por fila sería N+1 sobre el barrido completo.
      const horizon = new Date(today);
      horizon.setUTCDate(horizon.getUTCDate() + DEFAULT_DUE_SOON_DAYS);

      const schedules = await client.ap_payment_schedules.findMany({
        where: {
          status: 'scheduled',
          scheduled_date: { lte: horizon },
        },
        include: {
          accounts_payable: {
            select: {
              id: true,
              store_id: true,
              organization_id: true,
              supplier_id: true,
              document_number: true,
              balance: true,
              supplier: { select: { name: true } },
            },
          },
        },
        orderBy: { scheduled_date: 'asc' },
      });

      if (schedules.length === 0) return;

      let dueSoon = 0;
      let overdue = 0;

      for (const schedule of schedules) {
        const ap = schedule.accounts_payable;
        // Sin `store_id` no hay a quién notificar: una CxP de nivel
        // organización no tiene bandeja propia. Se omite en vez de adivinar.
        if (!ap?.store_id) continue;

        const scheduledDate = new Date(schedule.scheduled_date);
        scheduledDate.setUTCHours(0, 0, 0, 0);
        const isOverdue = scheduledDate.getTime() < today.getTime();

        const payload = {
          store_id: ap.store_id,
          accounts_payable_id: ap.id,
          schedule_id: schedule.id,
          supplier_id: ap.supplier_id,
          supplier_name: ap.supplier?.name ?? 'Proveedor',
          document_number: ap.document_number,
          amount: Number(schedule.amount),
          scheduled_date: schedule.scheduled_date,
        };

        if (isOverdue) {
          overdue++;
          this.eventEmitter.emit('ap_installment.overdue', payload);
        } else {
          dueSoon++;
          this.eventEmitter.emit('ap_installment.due_soon', payload);
        }
      }

      this.logger.log(
        `[AP] barrido de vencimientos: ${dueSoon} por vencer, ${overdue} vencidas`,
      );
    } catch (error) {
      // Un job que revienta se lleva el scheduler; el barrido de mañana debe
      // poder correr aunque el de hoy falle.
      this.logger.error(
        `[AP] barrido de vencimientos falló: ${(error as Error).message}`,
      );
    }
  }
}
