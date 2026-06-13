/**
 * Cross-stage coherence helpers — used to assert/preserve invariants
 * across the synthetic dataset.
 *
 * These don't run in production; they only run during the seed.
 */

import type { PrismaClient } from '@prisma/client';

export interface CoherenceCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export async function checkAccountingBalance(
  prisma: PrismaClient,
  organizationId: number,
): Promise<CoherenceCheck> {
  const unbalanced: Array<{ id: number; debit: number; credit: number }> = await prisma.$queryRaw`
    SELECT
      ae.id,
      COALESCE(SUM(ael.debit_amount), 0)::float AS debit,
      COALESCE(SUM(ael.credit_amount), 0)::float AS credit
    FROM accounting_entries ae
    LEFT JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
    WHERE ae.organization_id = ${organizationId}
    GROUP BY ae.id
    HAVING COALESCE(SUM(ael.debit_amount), 0) <> COALESCE(SUM(ael.credit_amount), 0)
  `;
  if (unbalanced.length === 0) {
    return { name: 'accounting_entries balanced', ok: true };
  }
  return {
    name: 'accounting_entries balanced',
    ok: false,
    detail: `${unbalanced.length} unbalanced entries (e.g. id=${unbalanced[0]?.id} debit=${unbalanced[0]?.debit} credit=${unbalanced[0]?.credit})`,
  };
}

export async function checkStockCoherence(
  prisma: PrismaClient,
  storeId: number,
): Promise<CoherenceCheck> {
  const stocks = await prisma.stock_levels.findMany({
    where: { products: { store_id: storeId } },
  });
  const productTotals = new Map<number, number>();
  for (const s of stocks) {
    const v = s.product_variant_id ?? -s.product_id; // group by product or by variant
    productTotals.set(v, (productTotals.get(v) ?? 0) + Number(s.quantity_on_hand));
  }
  // Allow ±5% variance due to active reservations.
  const products = await prisma.products.findMany({
    where: { store_id: storeId },
    select: { id: true, stock_quantity: true },
  });
  let mismatches = 0;
  for (const p of products) {
    const expected = productTotals.get(-p.id) ?? 0;
    const actual = Number(p.stock_quantity);
    if (Math.abs(expected - actual) > Math.max(5, actual * 0.05)) {
      mismatches++;
    }
  }
  if (mismatches === 0) {
    return { name: 'stock_levels vs products.stock_quantity', ok: true };
  }
  return {
    name: 'stock_levels vs products.stock_quantity',
    ok: false,
    detail: `${mismatches} products with mismatch > 5%`,
  };
}

export function makeChecksLine(results: CoherenceCheck[]): string {
  return results
    .map((c) => `${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
    .join('\n  ');
}
