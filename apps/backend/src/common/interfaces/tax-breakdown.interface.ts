import { Prisma } from '@prisma/client';

/**
 * Fiscal tax breakdown contract shared across accounting events.
 *
 * Accounting events (invoice.accepted, support_document.accepted,
 * payment.received, credit_sale.created, refund.completed) carry this typed
 * breakdown alongside the scalar `tax_amount` total, so that AutoEntryService
 * can post one journal line per fiscal type (IVA → 2408, INC → 2436,
 * ICA → 241205) instead of collapsing everything to 2408.
 *
 * Values mirror the Prisma `tax_type_enum` and the `TaxFiscalType` DTO enum.
 */
export type TaxFiscalTypeValue =
  | 'iva'
  | 'inc'
  | 'ica'
  | 'withholding'
  | 'reteiva'
  | 'reteica';

export interface TaxBreakdownItem {
  tax_type: TaxFiscalTypeValue;
  tax_amount: number;
  /**
   * F-111 (CP-pos-exclusive-tax-double-charge) — tarifa como FRACCIÓN
   * (19 % = 0.19), NUNCA como porcentaje. `order_item_taxes.tax_rate` ya es
   * `Decimal(6,5)` fracción y viaja tal cual; `invoice_taxes.tax_rate` es
   * `Decimal(5,2)` PORCENTAJE — quien construye filas desde `invoice_taxes`
   * debe dividir por 100 ANTES de llamar a `buildTaxBreakdown`. La
   * normalización vive SIEMPRE en el borde (el lector de la fila), nunca
   * acá dentro: esta función no sabe ni le importa de qué tabla vino la fila.
   *
   * OPCIONAL a propósito: los 7 llamadores existentes de
   * `buildTaxBreakdown`/`scaleBreakdownToTotal` no traen tarifa y siguen
   * compilando sin tocarlos. La compuerta de detección de
   * `AutoEntryService.resolveTaxLines` (F-111) solo se arma donde SÍ hay
   * tarifa + base con las que armarla.
   */
  tax_rate?: number;
  /**
   * F-111 — base imponible NETA que produjo `tax_amount`, en la MISMA
   * unidad monetaria (pesos, no centavos). Para `order_item_taxes` es
   * `Σ order_items.total_price` de las líneas que aportan este
   * `(tax_type, tax_rate)` — la tabla no tiene columna de base propia, así
   * que se deriva del ESCRITOR de la línea de venta, nunca del escritor del
   * impuesto (derivarla de `tax_amount` volvería la comprobación
   * tautológica). Para `invoice_taxes` es la columna persistida
   * `taxable_amount`, sin derivar nada.
   */
  taxable_amount?: number;
}

/**
 * Collapses a list of typed tax rows (invoice_taxes / order_item_taxes) into a
 * deduplicated breakdown summing amounts per fiscal type. Rows without a
 * persisted type fall back to 'iva' (the de-facto prior behavior). Returns an
 * empty array when there are no taxes, which lets consumers fall back to the
 * legacy single-line `vat_payable` posting.
 *
 * F-111 — agrupa por `(tax_type, tax_rate)`, NO sólo por `tax_type`: dos
 * tarifas del mismo tipo (IVA 19 % e IVA 5 %) en la misma orden NO pueden
 * colapsarse en un ítem, porque colapsarlas mezclaría dos bases distintas
 * bajo una sola tarifa y la compuerta de `resolveTaxLines` compararía contra
 * un promedio ponderado en vez de la tarifa real de cada grupo — falsos
 * positivos garantizados. Cuando una fila NO trae `tax_rate` (comportamiento
 * histórico, la mayoría de los 7 llamadores) se agrupa sólo por `tax_type`
 * como siempre, y el ítem resultante sale SIN `tax_rate` ni
 * `taxable_amount` — la compuerta de detección no se arma para ese ítem,
 * comportamiento histórico intacto.
 *
 * Compatibilidad de salida: al agrupar por (tipo, tarifa) esta función puede
 * devolver MÁS ítems que antes (uno por tarifa distinta del mismo tipo). El
 * único consumidor que itera el array (`AutoEntryService.resolveTaxLines`)
 * emite una línea CR/DR por ítem a la MISMA cuenta PUC del tipo — dos
 * tarifas del mismo tipo dan dos líneas a la misma cuenta, lo cual sigue
 * cuadrando contablemente (la cuenta destino depende del `tax_type`, no de
 * la tarifa).
 *
 * GUARDA DE PLAUSIBILIDAD (no es normalización) — `row.tax_rate` sólo se
 * acepta como fracción cuando `0 < tax_rate ≤ 1`. Esto NO es una conversión
 * (`/100`) escondida dentro de la función compartida (eso sigue prohibido,
 * ver docblock de `TaxBreakdownItem.tax_rate`): es rechazar un dato
 * implausible, igual que se rechaza `tax_amount` cero. Existe porque
 * `invoice-flow.service.ts` llama a esta función pasando la fila COMPLETA
 * de `invoice_taxes` (`include: { invoice_taxes: true }`), y esa tabla tiene
 * `tax_rate Decimal(5,2)` NOT NULL — SIEMPRE presente y SIEMPRE en
 * PORCENTAJE (19.00), nunca en fracción. Sin esta guarda, ese llamador (no
 * tocado por F-111 a propósito — normalizar en su borde es cambio de otro
 * archivo) empezaría a adjuntar `tax_rate=19`/`taxable_amount` a cada ítem
 * por el simple hecho de que la columna existe en la fila, y la compuerta de
 * `resolveTaxLines` compararía contra una tarifa 100x mayor — falso positivo
 * en CADA factura/documento soporte aceptado. Una fila con tarifa fuera de
 * rango se trata exactamente como una fila SIN tarifa (agrupa solo por
 * tipo, sale sin `tax_rate` ni `taxable_amount`): mismo comportamiento
 * histórico, cero ruido.
 *
 * BASE TODO-O-NADA POR GRUPO — si dentro de un mismo `(tipo, tarifa)` alguna
 * fila trae `taxable_amount` y otra no, el grupo publica su `tax_amount`
 * completo y NINGUNA base. Sumar sólo las bases presentes daría una base más
 * chica que la que produjo el impuesto acumulado, y la compuerta de
 * `resolveTaxLines` marcaría como desviación un dato correcto. Sin esta regla
 * el resultado además dependería del ORDEN de las filas (base primero ⇒ suma
 * parcial; base después ⇒ se descarta), que es la peor forma de fallar: no
 * reproducible.
 */
export function buildTaxBreakdown(
  rows: Array<{
    tax_type?: string | null;
    tax_amount: unknown;
    tax_rate?: unknown;
    taxable_amount?: unknown;
  }>,
): TaxBreakdownItem[] {
  const byGroup = new Map<
    string,
    {
      tax_type: TaxFiscalTypeValue;
      tax_amount: number;
      tax_rate?: number;
      taxable_amount?: number;
      // F-111 — un grupo cuya base quedó INCOMPLETA no puede publicarla: ver
      // el bloque de acumulación de abajo.
      base_incomplete: boolean;
    }
  >();
  for (const row of rows ?? []) {
    const type = (row.tax_type as TaxFiscalTypeValue) || 'iva';
    const amount = Number(row.tax_amount || 0);
    if (!amount) continue;
    // `tax_rate`/`taxable_amount` son opcionales por fila: una fila que no
    // los trae (llamador histórico) sigue agrupando SOLO por tipo (todas
    // caen en el mismo grupo `${type}|`), reproduciendo el comportamiento
    // previo a F-111 al pie de la letra.
    //
    // `has_rate` exige además plausibilidad de FRACCIÓN (0, 1]: ver la
    // "GUARDA DE PLAUSIBILIDAD" en el docblock de esta función.
    const raw_rate = row.tax_rate != null ? Number(row.tax_rate) : undefined;
    const has_rate = raw_rate != null && raw_rate > 0 && raw_rate <= 1;
    const rate = has_rate ? raw_rate : undefined;
    // La base sólo se adjunta junto con una tarifa plausible: sin tarifa
    // válida, `tax_rate × taxable_amount` no significa nada y la compuerta
    // de `resolveTaxLines` no debe verlos como par.
    const has_base = has_rate && row.taxable_amount != null;
    const base = has_base ? Number(row.taxable_amount) : undefined;
    const group_key = `${type}|${has_rate ? rate : ''}`;

    const existing = byGroup.get(group_key);
    if (existing) {
      existing.tax_amount += amount;
      // F-111 — `tax_amount` acumula SIEMPRE, la base sólo si TODAS las filas
      // del grupo la traen. Una base parcial es peor que ninguna: `tax_amount`
      // llevaría la cuota de N filas y `taxable_amount` la base de menos de N,
      // así que `base × tarifa` saldría por debajo de lo declarado y la
      // compuerta de `resolveTaxLines` dispararía un falso positivo sobre un
      // dato correcto. En cuanto falta una, el grupo entero publica el
      // `tax_amount` y NINGUNA base: la compuerta no se arma, que es el
      // comportamiento histórico.
      if (base == null) {
        existing.base_incomplete = true;
      } else if (existing.taxable_amount != null) {
        existing.taxable_amount += base;
      } else {
        // La base llegó en una fila posterior a una que no la traía: el grupo
        // ya está incompleto y sumarla ahora daría el mismo total mentiroso.
        existing.base_incomplete = true;
      }
    } else {
      byGroup.set(group_key, {
        tax_type: type,
        tax_amount: amount,
        tax_rate: rate,
        taxable_amount: base,
        base_incomplete: false,
      });
    }
  }
  return Array.from(byGroup.values()).map((g) => ({
    tax_type: g.tax_type,
    tax_amount: g.tax_amount,
    ...(g.tax_rate != null ? { tax_rate: g.tax_rate } : {}),
    ...(g.taxable_amount != null && !g.base_incomplete
      ? { taxable_amount: g.taxable_amount }
      : {}),
  }));
}

/**
 * Scales a base breakdown so its amounts sum to `targetTotal`, preserving the
 * per-type proportions. Used by refund flows that know the scalar refunded tax
 * (proportional to the partial refund) but must keep the original fiscal type
 * mix. Returns [] when there is nothing to scale.
 *
 * B.1 (F-022) — todo en espacio `Decimal` con `ROUND_DOWN` (truncado DIAN,
 * nunca `Math.round`) + resto mayor (`largest-remainder`): cada parte se
 * trunca al centavo y los centavos que el truncado suelta se reparten de a 1¢
 * a las partes con mayor fracción, así la suma de las partes ES `targetTotal`
 * al centavo, nunca ±1¢. Desempate por contenido (tipo, monto), N4 round 2:
 * el mismo multiconjunto reparte idéntico sin importar el orden de entrada.
 *
 * NOTA CONTABLE — los reversos que escalan así son proporcionales al número
 * de la orden, NO espejan la absorción del snapshot de factura (la base
 * absorbida sólo existe en el snapshot persistido). Un reembolso parcial de
 * una línea absorbida reparte su cuota a prorrata; no reconstruye base 2777.78
 * + 222.22 desde el bruto.
 *
 * F-111 — el resultado NUNCA lleva `tax_rate` ni `taxable_amount`, aunque
 * `base` los traiga: se descartan A PROPÓSITO (ver el `.map` final, que solo
 * copia `tax_type`/`tax_amount`). El monto escalado es una PRORRATA sobre el
 * número de la orden, no la tarifa × base real de esta porción reembolsada
 * — comparar `tax_rate × taxable_amount` contra un `tax_amount` prorrateado
 * dispararía la compuerta de `AutoEntryService.resolveTaxLines` en CADA
 * reembolso parcial, un falso positivo permanente. Un reembolso parcial no
 * arma la compuerta.
 */
export function scaleBreakdownToTotal(
  base: TaxBreakdownItem[],
  targetTotal: number,
): TaxBreakdownItem[] {
  if (!Array.isArray(base) || base.length === 0) return [];
  const target = new Prisma.Decimal(targetTotal || 0);
  if (target.lessThanOrEqualTo(0)) return [];
  const sum = base.reduce(
    (acc: Prisma.Decimal, b) => acc.plus(new Prisma.Decimal(b.tax_amount || 0)),
    new Prisma.Decimal(0),
  );
  if (sum.lessThanOrEqualTo(0)) return [];

  const target_cents = target
    .times(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
  const floors = base.map((b) => {
    const exact = new Prisma.Decimal(b.tax_amount || 0)
      .dividedBy(sum)
      .times(target);
    const floored = exact.toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
    return { exact, floored };
  });
  const floored_cents_total = floors.reduce(
    (acc: Prisma.Decimal, f) =>
      acc.plus(f.floored.times(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN)),
    new Prisma.Decimal(0),
  );
  let remainder_cents = target_cents.minus(floored_cents_total).toNumber();
  // Por construcción 0 ≤ resto < n (cada truncado suelta < 1¢); el clamp es
  // cinturón, no camino: un resto fuera de rango sería un bug, no un reparto.
  remainder_cents = Math.max(
    0,
    Math.min(base.length, Math.floor(remainder_cents)),
  );

  // N4 (round 2): desempate determinista por CONTENIDO (tipo, monto), no por
  // orden de entrada: el mismo multiconjunto reparte idéntico aunque los
  // llamadores ordenen distinto, y filas idénticas son intercambiables (misma
  // cuenta PUC de todos modos). R3-02: comparación por unidades de código,
  // no `localeCompare` (el orden por locale depende del ICU del runtime y
  // puede variar entre máquinas; acá el orden solo reparte centavos).
  const order = floors
    .map((f, index) => ({
      index,
      fraction: f.exact.minus(f.floored),
    }))
    .sort((a, b) => {
      const cmp = b.fraction.comparedTo(a.fraction);
      if (cmp !== 0) return cmp;
      const type_a = String(base[a.index]?.tax_type ?? '');
      const type_b = String(base[b.index]?.tax_type ?? '');
      if (type_a !== type_b) return type_a < type_b ? -1 : 1;
      return (
        Number(base[b.index]?.tax_amount ?? 0) -
        Number(base[a.index]?.tax_amount ?? 0)
      );
    })
    .slice(0, remainder_cents)
    .map((entry) => entry.index);
  const winners = new Set(order);

  return base.map((b, index) => ({
    tax_type: b.tax_type,
    tax_amount: floors[index].floored
      .plus(winners.has(index) ? new Prisma.Decimal('0.01') : new Prisma.Decimal(0))
      .toNumber(),
  }));
}
