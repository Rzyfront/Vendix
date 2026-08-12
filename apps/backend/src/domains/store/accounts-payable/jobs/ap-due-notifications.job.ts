import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaClient } from '@prisma/client';

import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { mergeStoreSettingsWithDefaults } from '../../settings/defaults/default-store-settings';

/** Anticipación por defecto del aviso, en días. Configurable por tienda. */
const DEFAULT_DUE_SOON_DAYS = 1;

/**
 * Tope del sobre-barrido: el job consulta el barrido completo con el horizonte
 * máximo posible para no depender de qué tiendas tienen override, y luego
 * aplica el horizonte REAL de cada tienda por fila. Coincide con el `@Max(30)`
 * del DTO de settings (`notifications.ap_due_soon_days`).
 */
const MAX_DUE_SOON_DAYS = 30;

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
 *     de anticipación de SU tienda (`notifications.ap_due_soon_days`, default
 *     1, rango 0-30), y `ap_installment.overdue` para las que ya pasaron.
 *   - El barrido consulta con horizonte máximo 30 días y UNA sola lectura de
 *     `store_settings` por corrida (Map<store_id, días>); el horizonte de cada
 *     tienda se aplica por fila, sin N+1.
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

      // Sobre-barrido: se consulta con el horizonte máximo permitido (30 días)
      // para no depender de qué tiendas tienen override. El horizonte REAL de
      // cada tienda se aplica por fila abajo — consultar settings por fila
      // sería N+1 sobre el barrido completo.
      const maxHorizon = new Date(today);
      maxHorizon.setUTCDate(maxHorizon.getUTCDate() + MAX_DUE_SOON_DAYS);

      const schedules = await client.ap_payment_schedules.findMany({
        where: {
          status: 'scheduled',
          scheduled_date: { lte: maxHorizon },
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

      // Única lectura de settings por corrida: Map<store_id, días de
      // anticipación>. El deep-merge con defaults (`mergeStoreSettingsWithDefaults`)
      // inyecta `ap_due_soon_days` aunque la tienda nunca haya persistido la
      // llave, así que la ausencia de fila en `store_settings` no es un caso a
      // resolver aquí: el fallback vive en la clasificación por fila.
      const storeIds = [
        ...new Set(
          schedules
            .map((schedule) => schedule.accounts_payable?.store_id)
            .filter((id): id is number => typeof id === 'number'),
        ),
      ];

      const settingsRows = await client.store_settings.findMany({
        where: { store_id: { in: storeIds } },
        select: { store_id: true, settings: true },
      });

      const dueSoonDaysByStore = new Map<number, number>();
      for (const row of settingsRows) {
        const days = mergeStoreSettingsWithDefaults(
          row.settings,
        ).notifications?.ap_due_soon_days;
        if (typeof days === 'number' && Number.isFinite(days)) {
          dueSoonDaysByStore.set(row.store_id, days);
        }
      }

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

        // Horizonte de la tienda de la cuota: override de settings si lo
        // configuró, default 1 si no. La vencida se re-emite SIN depender de
        // esta ventana (comportamiento deliberado documentado en la cabecera).
        const storeDays =
          dueSoonDaysByStore.get(ap.store_id) ?? DEFAULT_DUE_SOON_DAYS;
        const storeHorizon = new Date(today);
        storeHorizon.setUTCDate(storeHorizon.getUTCDate() + storeDays);

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
        } else if (scheduledDate.getTime() <= storeHorizon.getTime()) {
          dueSoon++;
          this.eventEmitter.emit('ap_installment.due_soon', payload);
        }
        // Una cuota que vence más allá de la ventana de SU tienda fue traída
        // solo por el sobre-barrido de 30 días: se omite en silencio.
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
