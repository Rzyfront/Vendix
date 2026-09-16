import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StorePrismaService } from '../prisma/services/store-prisma.service';

/**
 * F-114 (CP-pos-exclusive-tax-double-charge) — `accounting_entry_failures`
 * tenía dos escritores (`AccountingEntryFailureService.recordFailure` /
 * `.recordSkip`, incluida la nueva causa `DETECTED_TAX_MISMATCH` de F-111) y
 * CERO lectores: `GET /store/accounting/entry-failures` existe y está
 * registrado en `accounting.module.ts`, pero `grep -rn "entry-failures"
 * apps/frontend/src` no arroja resultados, no hay notificación ni job — un
 * operador solo se enteraba de un fallo contable corriendo curl a mano. Este
 * job cierra ese hueco con una alerta diaria.
 *
 * Mecanismo: el MISMO de `certificate-expiry-alert.job.ts` — creación
 * directa de filas en `notifications` (sin BullMQ, sin `NotificationsService`),
 * incluyendo su mismo patrón de fan-out cuando el hecho es a nivel
 * organización (sin `store_id` propio) hacia todas las tiendas activas.
 *
 * Única diferencia deliberada con la referencia: se inyecta
 * `StorePrismaService` (y se opera vía `.withoutScope()`, el mismo escape
 * hatch que ya usa `AccountingEntryFailureService`) en vez de
 * `GlobalPrismaService`, porque `GlobalPrismaService` no expone un getter
 * para `accounting_entry_failures` (es una lista curada de modelos) y
 * añadirle uno cae fuera del alcance de archivos de este trabajo
 * (`prisma/services/global-prisma.service.ts` es compartido y no está en la
 * lista de archivos autorizados). `.withoutScope()` devuelve el mismo
 * `baseClient` crudo que usa `GlobalPrismaService` por debajo, así que el
 * acceso a `notifications.create` es idéntico en efecto.
 *
 * Reutilización del enum: `notification_type_enum` no tiene un valor para
 * "alerta contable operativa" y no se permiten migraciones. Se reutiliza
 * `weekly_report` (visto como "informe periódico al dueño de la tienda",
 * el ajuste semántico más cercano disponible) siguiendo el mismo precedente
 * que `certificate-expiry-alert.job.ts` sentó al reutilizar `low_stock`.
 * Verificado que ningún consumidor del frontend distingue/enruta por
 * `type === 'weekly_report'` (grep sin resultados) — el riesgo de colisión
 * visual es nulo hoy. Se desambigua igualmente vía `data.alert_type` por si
 * alguna vista futura empieza a filtrar por tipo.
 */
@Injectable()
export class AccountingEntryFailuresAlertJob {
  private readonly logger = new Logger(AccountingEntryFailuresAlertJob.name);

  /** Marca en `notifications.data` que identifica esta alerta, no un weekly_report real. */
  private static readonly ALERT_TYPE = 'accounting_entry_failures';

  /**
   * Techo defensivo de filas leídas por corrida. `accounting_entry_failures`
   * no tiene hoy volumen que se acerque a esto; es solo para que un bug
   * ajeno que dejara de resolver filas nunca convierta este job en un
   * full-scan sin límite.
   */
  private static readonly MAX_ROWS_PER_RUN = 5000;

  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Corre a diario a las 9 AM (una hora después de la alerta de certificados
   * DIAN, para no competir por el mismo minuto de cron).
   */
  @Cron('0 9 * * *')
  async handleAccountingEntryFailuresAlert() {
    this.logger.log('Running accounting entry failures alert check...');

    try {
      const db = this.prisma.withoutScope();
      const rows = await db.accounting_entry_failures.findMany({
        where: { resolved_at: null },
        select: {
          id: true,
          organization_id: true,
          store_id: true,
          error_message: true,
          created_at: true,
        },
        orderBy: { created_at: 'asc' },
        take: AccountingEntryFailuresAlertJob.MAX_ROWS_PER_RUN,
      });

      if (rows.length === 0) {
        this.logger.debug('No unresolved accounting entry failures found');
        return;
      }
      if (rows.length === AccountingEntryFailuresAlertJob.MAX_ROWS_PER_RUN) {
        this.logger.warn(
          `accounting_entry_failures unresolved rows hit the ${AccountingEntryFailuresAlertJob.MAX_ROWS_PER_RUN} cap for this run — some rows were not considered.`,
        );
      }

      // Agrupa en memoria por (organization_id, store_id). El volumen
      // esperado (fallos contables no resueltos) es bajo — no amerita un
      // `groupBy` de Prisma, y en memoria es más simple de auditar.
      const groups = new Map<
        string,
        {
          organization_id: number;
          store_id: number | null;
          rows: { id: number; error_message: string; created_at: Date }[];
        }
      >();
      for (const row of rows) {
        const key = `${row.organization_id}:${row.store_id ?? 'null'}`;
        const existing = groups.get(key);
        if (existing) {
          existing.rows.push(row);
        } else {
          groups.set(key, {
            organization_id: row.organization_id,
            store_id: row.store_id,
            rows: [row],
          });
        }
      }

      let notifications_sent = 0;
      for (const group of groups.values()) {
        try {
          notifications_sent += await this.notifyGroup(db, group);
        } catch (err: any) {
          this.logger.error(
            `Failed to process accounting entry failures group org=${group.organization_id} store=${group.store_id ?? 'null'}: ${err.message}`,
          );
        }
      }

      if (notifications_sent > 0) {
        this.logger.log(
          `Sent ${notifications_sent} accounting entry failures alert(s)`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Accounting entry failures check failed: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Notifica un grupo (organización + tienda, o toda la organización cuando
   * `store_id` es null). Devuelve cuántas notificaciones creó.
   */
  private async notifyGroup(
    db: ReturnType<StorePrismaService['withoutScope']>,
    group: {
      organization_id: number;
      store_id: number | null;
      rows: { id: number; error_message: string; created_at: Date }[];
    },
  ): Promise<number> {
    // Mismo patrón que certificate-expiry-alert.job.ts: un fallo sin
    // store_id propio es a nivel organización (p.ej. un evento contable que
    // no traía tienda) — se notifica a cada tienda activa para que algún
    // admin lo vea, sin importar el panel en el que esté.
    let target_store_ids: number[];
    if (group.store_id !== null) {
      target_store_ids = [group.store_id];
    } else {
      const stores = await db.stores.findMany({
        where: { organization_id: group.organization_id, is_active: true },
        select: { id: true },
      });
      target_store_ids = stores.map((s) => s.id);
    }

    const causes = this.extractCauses(group.rows.map((r) => r.error_message));
    const total_unresolved = group.rows.length;
    const newest_row_created_at = group.rows.reduce(
      (max, r) => (r.created_at > max ? r.created_at : max),
      group.rows[0].created_at,
    );

    let sent = 0;
    for (const target_store_id of target_store_ids) {
      try {
        // ANTI-RUIDO (obligatorio): sin esto, correr a diario sobre filas
        // que siguen `resolved_at IS NULL` para siempre notificaría a la
        // MISMA tienda el MISMO conteo cada día, indefinidamente, hasta que
        // alguien resuelva la fila. Decisión: buscar la última alerta que
        // este job ya mandó a esta tienda (vía el marcador
        // `data.alert_type`) y comparar su fecha contra la fila NO resuelta
        // más nueva del grupo. Si no hay filas nuevas desde esa última
        // alerta, no se manda nada.
        //
        // CONSECUENCIA documentada: una tienda con un fallo abierto que
        // nadie resuelve y al que no le llegan fallos nuevos deja de recibir
        // recordatorios después de la primera alerta — no hay "recordatorio
        // diario del backlog viejo". Esto es intencional (evita la fatiga de
        // alerta descrita arriba) pero significa que un fallo antiguo puede
        // quedar fuera de la vista de un operador que no revisó la primera
        // alerta ni la bandeja `GET /store/accounting/entry-failures`. Si
        // en el futuro se quiere un recordatorio periódico del backlog (no
        // solo de lo nuevo), agregar un segundo umbral explícito (p.ej.
        // "recordar cada 7 días si sigue sin resolver") en vez de quitar
        // este filtro.
        const last_alert = await db.notifications.findFirst({
          where: {
            store_id: target_store_id,
            type: 'weekly_report' as any,
            data: {
              path: ['alert_type'],
              equals: AccountingEntryFailuresAlertJob.ALERT_TYPE,
            },
          },
          orderBy: { created_at: 'desc' },
          select: { created_at: true },
        });

        const new_since_last_alert = last_alert
          ? group.rows.filter((r) => r.created_at > last_alert.created_at)
              .length
          : total_unresolved;

        if (new_since_last_alert === 0) {
          continue;
        }

        const title =
          new_since_last_alert === total_unresolved
            ? `${total_unresolved} fallo(s) contable(s) sin resolver`
            : `${new_since_last_alert} fallo(s) contable(s) nuevo(s) sin resolver`;
        const body =
          `Hay ${total_unresolved} asiento(s) automático(s) pendientes de revisión ` +
          `(${new_since_last_alert} nuevo(s) desde la última alerta). ` +
          `Causas: ${causes.join(', ')}. Revise Contabilidad > Fallos de asientos.`;

        await db.notifications.create({
          data: {
            store_id: target_store_id,
            type: 'weekly_report' as any, // Reusing existing enum — no migration allowed
            severity: 'warning' as any,
            title,
            body,
            data: {
              alert_type: AccountingEntryFailuresAlertJob.ALERT_TYPE,
              organization_id: group.organization_id,
              total_unresolved,
              new_since_last_alert,
              causes,
              newest_failure_created_at: newest_row_created_at.toISOString(),
            },
          },
        });
        sent++;
      } catch (err: any) {
        this.logger.error(
          `Failed to create accounting entry failures notification for store ${target_store_id}: ${err.message}`,
        );
      }
    }
    return sent;
  }

  /**
   * `error_message` se escribe como `${CAUSE}: ${detail}` desde
   * `recordSkip` (p.ej. `DETECTED_TAX_MISMATCH: tipo=iva ...`), pero
   * `recordFailure` guarda el mensaje crudo de la excepción, sin prefijo de
   * causa. Se extrae el prefijo `[A-Z_]+:` cuando existe; si no, se agrupa
   * bajo `ERROR` (un fallo real de posteo, no una omisión deliberada).
   */
  private extractCauses(error_messages: string[]): string[] {
    const causes = new Set<string>();
    for (const message of error_messages) {
      const match = /^([A-Z][A-Z_]+):/.exec(message);
      causes.add(match ? match[1] : 'ERROR');
    }
    return Array.from(causes).sort();
  }
}
