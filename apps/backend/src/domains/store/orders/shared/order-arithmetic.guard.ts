import { Logger } from '@nestjs/common';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { differsByAtLeastCents } from '@common/money-kernel';
import { resolveLineUnits } from '../../taxes/utils/final-price.util';

/**
 * D.13 — Compuerta G3 (plan crítico CP-pos-exclusive-tax-double-charge,
 * QUI-832). Ver `evidence/design-P3-data.md §7` del bundle del plan.
 *
 * QUÉ ES: la afirmación en código de I-1 (`canonical-line-semantics.md §5`):
 * `total_price = unit_price × line_units`, donde `line_units` es el MISMO
 * multiplicador canónico (`resolveLineUnits`, ya usado por
 * `payments.service.ts`, `orders.service.ts` y `table-sessions.service.ts`
 * desde C.12 de este plan) — no se reinventa una segunda fórmula.
 *
 * POR QUÉ ESTÁ APAGADA (bandera en `false`, HOY 2026-09-14): el diseño (§7,
 * fila G3) es explícito — "Cualquier escritor aún no conforme (mesa, split,
 * kitchen-fire, gateway) dejaría de poder escribir ⇒ la tienda no cobra. Se
 * habilita sólo después de que G2 devuelva 0 violaciones durante 30 días."
 * G2 (job `@Cron` nocturno de invariantes, ticket propio) **no existe
 * todavía** — no hay reloj corriendo para esos 30 días. Encender esta
 * bandera antes de esa evidencia es apostar el cobro en el mostrador contra
 * un escritor que nadie ha auditado todavía.
 *
 * QUÉ NO HACE (a propósito, fuera de este paso): NO está cableada a ninguno
 * de los ~10 escritores de `order_items` inventariados en
 * `canonical-line-semantics.md §8` (`orders.service.ts`,
 * `table-sessions.service.ts`, `checkout.service.ts`,
 * `order-flow.service.ts`, `kitchen-fire.service.ts`,
 * `split-order.service.ts`, `payment-gateway.service.ts`, …). `F-109`
 * registra que esa integración se propuso y se DEJÓ CAER de los 8 commits
 * del plan — cablearla ahora, en un árbol compartido con otros dos agentes
 * editando esos mismos archivos en paralelo, repetiría el error que F-109
 * describe (una decisión de alcance tomada sin registro escrito). El
 * cableado real es trabajo de código nuevo y va en su propio paso/ticket,
 * después de G2.
 *
 * P2-4 (reactivación en modo log + métrica, 2026-09-22): la comparación ya
 * NO es en floats — se mide en centavos enteros con `differsByAtLeastCents`
 * (el `Math.abs(a − b) <= 0.02` fallaba en el borde según la magnitud:
 * `10000.02 − 10000 = 0.020000000000436557`). Con la bandera OFF la
 * violación deja un `warn` estructurado (`orders.line_total_invariant_violation`,
 * apto para una métrica basada en logs) y suma al contador de proceso
 * `getOrderLineInvariantViolationCount()`; NUNCA lanza. El primer escritor
 * cableado es `PaymentsService.buildOrderItemSnapshot` (POS), donde
 * `total_price = round(unit_price × line_units)` se cumple por construcción:
 * es la línea base de la métrica, sin riesgo para el cobro. Encender el
 * bloqueo (`ORDER_ARITHMETIC_GUARD_ENABLED=true`) sigue condicionado a la
 * evidencia de abajo (G2 / 30 días) y a cablear el resto de escritores.
 *
 * REVISAR: no antes de 30 días corridos de G2 en verde en producción. G2 no
 * existe aún — ver el ticket de G2 en `evidence/P3-tickets-vigilancia.md`.
 * Dueño natural: P1, junto a este archivo (ver ADR-09 propuesto en
 * `design-P3-data.md §7`).
 */

// Bandera explícita, no implícita: por defecto `false` salvo que alguien la
// active a propósito. `=== 'true'` (no truthy genérico) para que un valor
// mal escrito en el `.env` (`"1"`, `"yes"`) no la encienda por accidente.
export const ORDER_ARITHMETIC_GUARD_ENABLED =
  process.env.ORDER_ARITHMETIC_GUARD_ENABLED === 'true';

export interface OrderLineTotalInvariantInput {
  order_item_id?: number | null;
  unit_price: number | string;
  total_price: number | string;
  quantity: number | string;
  weight?: number | string | null;
  price_unit_quantity?: number | string | null;
}

// Misma tolerancia que el resto del plan usa para I-1 (registry/db.md DB-01:
// `ABS(tax_amount_item×units − unit_price×tax_rate) > 0,02` ⇒ violación),
// expresada en centavos enteros: tolera 2 ¢, viola desde 3 ¢.
const DEFAULT_TOLERANCE_CENTS = 3;

const logger = new Logger('OrderArithmeticGuard');
let violationCount = 0;

/** Métrica de proceso: violaciones de I-1 vistas desde el arranque. */
export function getOrderLineInvariantViolationCount(): number {
  return violationCount;
}

/**
 * Afirma I-1 para una línea. Con la bandera en `false` (default HOY) NUNCA
 * lanza — sólo deja un rastro en `debug` si la línea ya viola el invariante,
 * para que activar la bandera más adelante no sea un salto a ciegas. Con la
 * bandera en `true`, lanza `ORD_LINE_TOTAL_MISMATCH_001` (422) cuando
 * `|total_price − unit_price × line_units| > tolerance`.
 */
export function assertOrderLineTotalInvariant(
  line: OrderLineTotalInvariantInput,
  options: {
    /** Umbral de violación en centavos enteros (default 3: tolera 2 ¢). */
    tolerance_cents?: number;
    enabled?: boolean;
    /** Contexto para el log (tienda, escritor). */
    context?: Record<string, unknown>;
  } = {},
): void {
  const tolerance_cents = options.tolerance_cents ?? DEFAULT_TOLERANCE_CENTS;
  const enabled = options.enabled ?? ORDER_ARITHMETIC_GUARD_ENABLED;

  const unit_price = Number(line.unit_price);
  const total_price = Number(line.total_price);
  const line_units = resolveLineUnits({
    weight: line.weight ?? undefined,
    quantity: line.quantity,
    price_unit_quantity: line.price_unit_quantity ?? undefined,
  });

  if (!Number.isFinite(unit_price) || !Number.isFinite(total_price)) {
    // Entradas no numéricas son responsabilidad de la validación de DTO
    // (ver `vendix-validation`), no de esta compuerta aritmética.
    return;
  }

  const expected_total = Math.round(unit_price * line_units * 100) / 100;
  if (!differsByAtLeastCents(total_price, expected_total, tolerance_cents)) {
    return;
  }
  const residual =
    Math.abs(Math.round(total_price * 100) - Math.round(expected_total * 100)) /
    100;

  violationCount += 1;
  if (!enabled) {
    // nunca bloquea. Ver docblock del archivo (fecha de revisión).
    logger.warn({
      event: 'orders.line_total_invariant_violation',
      blocking: false,
      order_item_id: line.order_item_id ?? null,
      unit_price,
      total_price,
      line_units,
      expected_total,
      residual,
      tolerance_cents,
      ...(options.context ?? {}),
    });
    return;
  }

  throw new VendixHttpException(
    ErrorCodes.ORD_LINE_TOTAL_MISMATCH_001,
    `La línea no cuadra: total_price (${total_price}) se aparta de unit_price × line_units (${expected_total}) por ${residual}, fuera de tolerancia (${tolerance_cents} ¢).`,
    {
      order_item_id: line.order_item_id ?? null,
      unit_price,
      total_price,
      line_units,
      residual,
    },
  );
}
