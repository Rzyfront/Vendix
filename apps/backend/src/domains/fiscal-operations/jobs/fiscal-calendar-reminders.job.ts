import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { localCivil } from '@common/utils/store-timezone.util';
import { FiscalContextResolverService } from '../services/fiscal-context-resolver.service';
import {
  FISCAL_CALENDAR_TIMEZONE,
  FiscalCalendarRemindersService,
} from '../services/fiscal-calendar-reminders.service';
import {
  periodEndDate,
  vatWindowCandidates,
} from '../services/fiscal-calendar-window.util';

/** Tenants por tanda: acota memoria y tiempo de cada consulta. */
export const FISCAL_CALENDAR_JOB_BATCH = 50;

export interface FiscalCalendarTenantRow {
  organization_id: number;
  /** 0 = entidad consolidada de la organización (fiscal_scope ORGANIZATION). */
  store_id: number;
}

/**
 * Calendario tributario (F4/F5) — «siempre al día».
 *
 * Cada madrugada (America/Bogota) recorre por tandas SOLO los tenants con
 * periodicidad de IVA configurada a los que les falta algo:
 *  - la obligación de IVA del periodo SIGUIENTE (la ventana rodó), o
 *  - un recordatorio «fecha por confirmar» cuya obligación sigue bloqueada por
 *    calendario (F5: cuando se carga el calendario DIAN del año nuevo, la
 *    sincronización le asigna la fecha oficial).
 * El filtro va en una sola consulta por tanda (sin N+1); la sincronización es
 * idempotente, así que repetir la corrida no duplica nada. En `api` los @Cron
 * se desmontan (main.ts): corre una sola vez, en el worker.
 */
@Injectable()
export class FiscalCalendarRemindersJob {
  private readonly logger = new Logger(FiscalCalendarRemindersJob.name);
  private running = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly contextResolver: FiscalContextResolverService,
    private readonly calendar: FiscalCalendarRemindersService,
  ) {}

  @Cron('0 30 5 * * *', {
    name: 'fiscal-calendar-reminders',
    timeZone: FISCAL_CALENDAR_TIMEZONE,
  })
  async handle(): Promise<number> {
    return this.run();
  }

  async run(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let synced = 0;
    try {
      let cursor: FiscalCalendarTenantRow = { organization_id: 0, store_id: -1 };
      for (;;) {
        const batch = await this.findTenantsNeedingSync(now, cursor);
        for (const tenant of batch) {
          try {
            const context = await this.contextResolver.resolveForTenant({
              organization_id: tenant.organization_id,
              store_id: tenant.store_id || null,
            });
            const result = await this.calendar.syncContext(context, { now, mode: 'job' });
            if (result.status === 'generated') synced++;
          } catch (error) {
            this.logger.error(
              `Fiscal calendar job failed for org ${tenant.organization_id} store ${tenant.store_id}: ${(error as Error).message}`,
            );
          }
        }
        if (batch.length < FISCAL_CALENDAR_JOB_BATCH) break;
        cursor = batch[batch.length - 1];
      }
      if (synced) this.logger.log(`Fiscal calendar job: ${synced} tenant(s) synced`);
      return synced;
    } finally {
      this.running = false;
    }
  }

  /**
   * Una tanda (keyset por organización/tienda) de tenants con periodicidad
   * configurada que necesitan sincronizar. Con fiscal_scope ORGANIZATION la
   * configuración vive en `organization_settings`; con STORE, en cada
   * `store_settings`.
   */
  async findTenantsNeedingSync(
    now: Date,
    after: FiscalCalendarTenantRow,
  ): Promise<FiscalCalendarTenantRow[]> {
    const civil = localCivil(now, FISCAL_CALENDAR_TIMEZONE);
    const nextEnd = (p: 'monthly' | 'bimonthly' | 'four_monthly') =>
      periodEndDate(vatWindowCandidates(p, civil).next);

    return this.prisma.$queryRaw<FiscalCalendarTenantRow[]>(Prisma.sql`
      WITH tenants AS (
        SELECT os.organization_id, 0 AS store_id,
               os.settings->'fiscal_data'->>'vat_periodicity' AS periodicity
          FROM organization_settings os
          JOIN organizations o ON o.id = os.organization_id
         WHERE o.fiscal_scope = 'ORGANIZATION'
        UNION ALL
        SELECT s.organization_id, ss.store_id,
               ss.settings->'fiscal_data'->>'vat_periodicity' AS periodicity
          FROM store_settings ss
          JOIN stores s ON s.id = ss.store_id AND s.is_active = true
          JOIN organizations o ON o.id = s.organization_id
         WHERE o.fiscal_scope = 'STORE'
      )
      SELECT t.organization_id, t.store_id
        FROM tenants t
       WHERE t.periodicity IN ('monthly', 'bimonthly', 'four_monthly')
         AND (t.organization_id, t.store_id) > (${after.organization_id}, ${after.store_id})
         AND (
           NOT EXISTS (
             SELECT 1 FROM fiscal_obligations fo
              WHERE fo.organization_id = t.organization_id
                AND fo.store_id IS NOT DISTINCT FROM NULLIF(t.store_id, 0)
                AND fo.type = 'vat_return'
                AND fo.jurisdiction_key = 'CO-DIAN'
                AND fo.periodicity = t.periodicity
                AND fo.status <> 'cancelled'
                AND fo.period_end >= CASE t.periodicity
                  WHEN 'monthly' THEN ${nextEnd('monthly')}::date
                  WHEN 'bimonthly' THEN ${nextEnd('bimonthly')}::date
                  ELSE ${nextEnd('four_monthly')}::date
                END
           )
           OR EXISTS (
             SELECT 1 FROM user_reminders ur
               JOIN fiscal_obligations fo ON fo.id = ur.fiscal_obligation_id
              WHERE ur.source = 'fiscal'
                AND ur.status = 'pending'
                AND ur.remind_at IS NULL
                AND fo.organization_id = t.organization_id
                AND fo.store_id IS NOT DISTINCT FROM NULLIF(t.store_id, 0)
                AND fo.due_date_verified = false
           )
         )
       ORDER BY t.organization_id, t.store_id
       LIMIT ${FISCAL_CALENDAR_JOB_BATCH}
    `);
  }
}
