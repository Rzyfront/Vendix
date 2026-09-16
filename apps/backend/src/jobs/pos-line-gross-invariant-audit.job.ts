import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';

/**
 * G-3 (ADR-11, plan CP-pos-exclusive-tax-double-charge, paso B.4).
 *
 * Job de SÓLO LECTURA. No corrige nada, no migra nada, no lanza: cuenta, por
 * tienda y por carril, las líneas de `order_items` de las últimas 24 h que
 * violan el mismo invariante de bruto que la compuerta de escritura (G-1,
 * `payments.service.ts` → `buildOrderItemSnapshot`):
 *
 *   unit_price + (weight > 0 ? tax_amount_item / weight : tax_amount_item)
 *     ≠ final_unit_price   (±0,02)
 *
 * Por qué éste y no el predicado viejo: `|unit_price × tax_rate −
 * tax_amount_item| ≤ 0,02` es CIERTO en la orden 5928 (`6.188.000 × 0,19 =
 * 1.175.720`) porque el defecto de QUI-832 era internamente consistente. El
 * predicado de arriba sí lo ve (`7.363.720 ≠ 6.188.000`, delta 1.175.720).
 *
 * G-1 sólo cubre el carril que P1 arregla (`buildPosOrderItem`, venta nueva y
 * cierre de mesa vía `payments.service.ts`). Este job cubre TODA `order_items`
 * de las últimas 24 h, incluyendo los carriles que P1 NO toca — órdenes
 * (`orders.service.ts` / checkout), mesas (`table-sessions.service.ts
 * addItems`) y `kitchen-fire.service.ts` — porque son justo donde P2/P3 van a
 * trabajar y hoy no tienen ninguna señal.
 *
 * Clasificación de carril: no existe columna `lane`/`source` en
 * `order_items` (eso es trabajo de D.13, no de P1), así que se infiere con
 * las señales que YA existen y son de sólo lectura:
 *   - `inventory_consumed_at_fire = true`  → 'kitchen-fire'
 *   - la orden tiene `table_sessions`      → 'mesa'
 *   - `orders.channel = 'pos'`             → 'pos'
 *   - cualquier otro caso                  → 'ordenes'
 * Es una inferencia, no una verdad de schema — el propio nombre del evento
 * lo dice (`*_by_lane`) para que quien lo lea sepa que es una clasificación
 * derivada, no un campo persistido.
 *
 * Sin el índice de D.13 (`registry/db.md` DB-01/DB-03) este `findMany` es un
 * recorrido secuencial acotado a 24 h — aceptable al volumen actual (ADR-11,
 * Consequences), caro cuando crezca. Patrón copiado de
 * `certificate-expiry-alert.job.ts` (`@Cron`, `GlobalPrismaService`, logger
 * estructurado, try/catch que nunca deja escapar una excepción del cron).
 */

/** Prisma Decimal|number|null → number (0 cuando nulo). Mismo patrón que
 * `dispatch-analytics.service.ts` (`toNumber`), repetido aquí en vez de
 * importado: es una utilidad de 5 líneas y no hay un módulo compartido de
 * coerción de Decimal en `apps/backend/src`. */
function decimalToNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toNumber?: unknown }).toNumber === 'function'
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
}

type AuditedOrderItem = {
  unit_price: unknown;
  tax_amount_item: unknown;
  weight: unknown;
  final_unit_price: unknown;
  inventory_consumed_at_fire: boolean;
  orders: {
    store_id: number;
    channel: string;
    table_sessions: { id: number }[];
  } | null;
};

const GROSS_MISMATCH_TOLERANCE = 0.02;

@Injectable()
export class PosLineGrossInvariantAuditJob {
  private readonly logger = new Logger(PosLineGrossInvariantAuditJob.name);

  constructor(private readonly prisma: GlobalPrismaService) {}

  /**
   * Corre una vez al día, fuera del camino crítico de cobro (ADR-11, Blast
   * radius). Horario propio (03:20) para no competir con el resto de jobs de
   * `@Cron('0 8 * * *')` registrados en `jobs.module.ts`.
   */
  @Cron('20 3 * * *')
  async handlePosLineGrossInvariantAudit() {
    this.logger.log(
      'Running POS line gross invariant audit (G-3, ADR-11)...',
    );

    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const items: AuditedOrderItem[] =
        await this.prisma.order_items.findMany({
          where: {
            created_at: { gte: since },
            cancelled_at: null,
            final_unit_price: { not: null },
          },
          select: {
            unit_price: true,
            tax_amount_item: true,
            weight: true,
            final_unit_price: true,
            inventory_consumed_at_fire: true,
            orders: {
              select: {
                store_id: true,
                channel: true,
                table_sessions: { select: { id: true } },
              },
            },
          },
        });

      if (items.length === 0) {
        this.logger.debug(
          'G-3: no hay líneas con bruto declarado en las últimas 24h.',
        );
        return;
      }

      // `store_id:lane` -> conteo de líneas violadoras.
      const violationCounts = new Map<string, number>();

      for (const item of items) {
        const unitPrice = decimalToNumber(item.unit_price);
        const taxAmountItem = decimalToNumber(item.tax_amount_item);
        const weight = decimalToNumber(item.weight);
        const finalUnitPrice = decimalToNumber(item.final_unit_price);

        const computedGrossUnitPrice =
          unitPrice + (weight > 0 ? taxAmountItem / weight : taxAmountItem);
        const delta = computedGrossUnitPrice - finalUnitPrice;

        if (Math.abs(delta) <= GROSS_MISMATCH_TOLERANCE) continue;

        const storeId = item.orders?.store_id ?? null;
        const lane = this.resolveLane(item);
        const key = `${storeId ?? 'unknown'}:${lane}`;
        violationCounts.set(key, (violationCounts.get(key) ?? 0) + 1);
      }

      if (violationCounts.size === 0) {
        this.logger.debug(
          'G-3: 0 líneas violan el invariante de bruto en las últimas 24h.',
        );
        return;
      }

      for (const [key, count] of violationCounts) {
        const [storeIdRaw, lane] = key.split(':');
        this.logger.error({
          event: 'pos.line_gross_mismatch_by_lane',
          store_id: storeIdRaw === 'unknown' ? null : Number(storeIdRaw),
          lane,
          count,
          window_hours: 24,
        });
      }
    } catch (error) {
      this.logger.error(
        `POS line gross invariant audit failed: ${error.message}`,
        error.stack,
      );
    }
  }

  private resolveLane(item: AuditedOrderItem): string {
    if (item.inventory_consumed_at_fire) return 'kitchen-fire';
    if ((item.orders?.table_sessions?.length ?? 0) > 0) return 'mesa';
    if (item.orders?.channel === 'pos') return 'pos';
    return 'ordenes';
  }
}
