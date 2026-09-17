import { Decimal } from './decimal';
import { toDecimal, type DianNumericInput } from './dian-money';

/**
 * Redondea un monto a CENTAVOS ENTEROS y lo devuelve como `number`.
 *
 * Único punto de conversión "dinero -> entero" de este kernel. La conversión
 * pasa por `Decimal` (no por `value * 100` en punto flotante) porque
 * `Number.prototype * 100` ya puede traer error de representación ANTES de
 * redondear — exactamente el problema que {@link differsByAtLeastCents}
 * existe para eliminar en la comparación. El resultado es un entero exacto
 * (representable sin pérdida por cualquier `number` de JS hasta magnitudes
 * muy por encima de cualquier factura real), así que restarlo con `-` normal
 * es seguro.
 */
export function toCents(value: DianNumericInput): number {
  return toDecimal(value)
    .times(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

/**
 * Compara dos montos de dinero por su diferencia en CENTAVOS ENTEROS.
 * Reemplaza cualquier `Math.abs(a - b) >= 0.0X` escrito a mano sobre dos
 * `number` — esa resta vive en punto flotante y el mismo centavo de
 * diferencia cruza o no cruza el umbral según la MAGNITUD de `a` y `b`, no
 * según si hay o no diferencia real.
 *
 * EL BUG QUE CIERRA (medido en Node, `apps/backend`, 2026-09-14):
 *
 * ```
 * 13603.13 - 13603.12 = 0.00999999999839...  >= 0.01 ? false  (NO dispara)
 *   551.06 -   551.05 = 0.00999999999999...  >= 0.01 ? false  (NO dispara)
 *     2425 -  2424.99 = 0.01000000000021...  >= 0.01 ? true   (dispara)
 *  2223.09 -  2223.08 = 0.01000000000021...  >= 0.01 ? true   (dispara)
 * ```
 *
 * Los cuatro pares de arriba son EL MISMO centavo de diferencia. Con esta
 * función los cuatro dan el mismo veredicto (`true`, difieren en 1 centavo)
 * porque la resta ocurre sobre los enteros que devuelve {@link toCents}, no
 * sobre los dos `number` originales.
 *
 * Una tienda con precios alrededor de 2.500 y otra alrededor de 13.600
 * tienen HOY el mismo defecto de redondeo (§ADR-16) pero una compuerta que
 * reste dobles lo detecta en una tienda y no en la otra — 17 de los 25
 * sitios del repo que comparan dinero así usan el resultado para RECHAZAR un
 * cobro. Migrar esos sitios a `differsByAtLeastCents` es trabajo de otro
 * agente (fuera del alcance de este paquete); esta función es la
 * herramienta correcta a la que deben migrar.
 *
 * @param cents umbral en centavos enteros, inclusive (default 1 == 1 ¢).
 */
export function differsByAtLeastCents(
  a: DianNumericInput,
  b: DianNumericInput,
  cents: number = 1,
): boolean {
  return Math.abs(toCents(a) - toCents(b)) >= cents;
}
