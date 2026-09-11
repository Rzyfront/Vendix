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
}

/**
 * Collapses a list of typed tax rows (invoice_taxes / order_item_taxes) into a
 * deduplicated breakdown summing amounts per fiscal type. Rows without a
 * persisted type fall back to 'iva' (the de-facto prior behavior). Returns an
 * empty array when there are no taxes, which lets consumers fall back to the
 * legacy single-line `vat_payable` posting.
 */
export function buildTaxBreakdown(
  rows: Array<{ tax_type?: string | null; tax_amount: unknown }>,
): TaxBreakdownItem[] {
  const byType = new Map<TaxFiscalTypeValue, number>();
  for (const row of rows ?? []) {
    const type = (row.tax_type as TaxFiscalTypeValue) || 'iva';
    const amount = Number(row.tax_amount || 0);
    if (!amount) continue;
    byType.set(type, (byType.get(type) ?? 0) + amount);
  }
  return Array.from(byType.entries()).map(([tax_type, tax_amount]) => ({
    tax_type,
    tax_amount,
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
  // cuenta PUC de todos modos).
  const order = floors
    .map((f, index) => ({
      index,
      fraction: f.exact.minus(f.floored),
    }))
    .sort((a, b) => {
      const cmp = b.fraction.comparedTo(a.fraction);
      if (cmp !== 0) return cmp;
      const type_cmp = String(base[a.index]?.tax_type ?? '').localeCompare(
        String(base[b.index]?.tax_type ?? ''),
      );
      if (type_cmp !== 0) return type_cmp;
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
