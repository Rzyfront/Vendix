import 'dotenv/config';

import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../src/prisma/services/global-prisma.service';
import { StorePrismaService } from '../src/prisma/services/store-prisma.service';
import { OperatingScopeService } from '../src/common/services/operating-scope.service';
import { CostingService } from '../src/domains/store/inventory/shared/services/costing.service';
import { RequestContextService } from '../src/common/context/request-context.service';

/**
 * F2 — Backfill de products.cost_price / product_variants.cost_price
 * ==================================================================
 *
 * Segunda fase del fix de colapso del CPP. Corre DESPUES de la migracion
 * `20260706130000_backfill_stock_cost_per_unit` (que sanea
 * `stock_levels.cost_per_unit`). Este script recomputa el `cost_price` de
 * cada producto/variante como el promedio ponderado SCOPED (por
 * operating_scope: STORE vs ORGANIZATION) del `cost_per_unit` ya saneado,
 * reutilizando la MISMA logica de produccion que la recepcion de compra:
 * `CostingService.getScopedStockAggregate` + `OperatingScopeService`.
 *
 * Asi repara los `cost_price` que revaluaciones buggy pasadas colapsaron a 0.
 *
 * Seguro y idempotente:
 *   - `--dry-run` es el DEFAULT: solo reporta, no escribe nada.
 *   - Solo actualiza cuando el nuevo valor difiere del actual (tolerancia de
 *     redondeo a 2 decimales, la precision real de cost_price).
 *   - Nunca sobreescribe un cost_price sano con 0 (si no hay costo recuperable
 *     se salta y, si ademas no hay capas, se lista en `unrecoverable`).
 *
 * Reporte final JSON: { dryRun, organizationId, scanned, updated, skipped,
 *                       unrecoverable: [...] }.
 * `unrecoverable` = producto/variante con stock on-hand pero sin costo
 * recuperable (0 capas con costo y cost_price colapsado) -> captura manual.
 *
 * Uso:
 *   npm run migrate:cost-price -- --dry-run                  (default)
 *   npm run migrate:cost-price -- --run
 *   npm run migrate:cost-price -- --run --organization-id=6
 */

interface UnrecoverableItem {
  organization_id: number;
  product_id: number;
  product_variant_id: number | null;
  current_cost_price: number;
  reason: string;
}

interface BackfillReport {
  dryRun: boolean;
  organizationId?: number;
  scanned: number;
  updated: number;
  skipped: number;
  unrecoverable: UnrecoverableItem[];
}

interface StockGroupKey {
  product_id: number;
  product_variant_id: number | null;
  location_id: number;
}

function parseArgs(argv: string[]) {
  const organizationId = Number(
    argv.find((arg) => arg.startsWith('--organization-id='))?.split('=')[1],
  );
  return {
    // dry-run is the DEFAULT; only --run persists changes.
    dryRun: !argv.includes('--run'),
    organizationId: Number.isFinite(organizationId) ? organizationId : undefined,
  };
}

/** cost_price is Decimal(12,2) — compare/round at 2 decimals. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const globalPrisma = new GlobalPrismaService();
  await globalPrisma.$connect();
  // Store-scoped service is only needed to satisfy DI constructors; every call
  // below passes the UNSCOPED base client as `tx`, so scoping never kicks in.
  const storePrisma = new StorePrismaService();
  const operatingScopeService = new OperatingScopeService(storePrisma);
  const costingService = new CostingService(
    storePrisma,
    globalPrisma,
    operatingScopeService,
  );

  // Raw, unscoped Prisma client — read/write cross-tenant safely from a script.
  const base = globalPrisma.withoutScope() as any;

  const report: BackfillReport = {
    dryRun: options.dryRun,
    organizationId: options.organizationId,
    scanned: 0,
    updated: 0,
    skipped: 0,
    unrecoverable: [],
  };

  try {
    const organizations: Array<{ id: number }> = await base.organizations.findMany(
      {
        where: options.organizationId ? { id: options.organizationId } : {},
        select: { id: true },
        orderBy: { id: 'asc' },
      },
    );

    for (const org of organizations) {
      // getScopedStockAggregate reads the org id from the request context
      // (ALS). Wrap each org so the scoped aggregate resolves to THIS org.
      await RequestContextService.run(
        {
          organization_id: org.id,
          is_super_admin: true,
          is_owner: true,
        },
        () => processOrganization(base, costingService, org.id, options, report),
      );
    }

    console.log(JSON.stringify(report, null, 2));
    if (report.dryRun) {
      console.log(
        'DRY RUN: use --run to persist cost_price recomputations. Review ' +
          '`unrecoverable` for products needing manual cost capture.',
      );
    }
  } finally {
    await globalPrisma.$disconnect();
    await storePrisma.$disconnect();
  }
}

async function processOrganization(
  base: any,
  costingService: CostingService,
  organizationId: number,
  options: { dryRun: boolean },
  report: BackfillReport,
): Promise<void> {
  // On-hand stock rows for this org, heaviest quantity first so the first row
  // per (product, variant) is the representative location. In STORE scope
  // cost_price is a single scalar shared across stores; picking the location
  // with the most on-hand stock is a deterministic, defensible choice and
  // mirrors production behaviour (each receipt overwrites cost_price).
  const stockRows: Array<{
    product_id: number;
    product_variant_id: number | null;
    location_id: number;
    quantity_on_hand: number;
  }> = await base.stock_levels.findMany({
    where: {
      quantity_on_hand: { gt: 0 },
      inventory_locations: { is: { organization_id: organizationId } },
    },
    select: {
      product_id: true,
      product_variant_id: true,
      location_id: true,
      quantity_on_hand: true,
    },
    orderBy: [{ quantity_on_hand: 'desc' }],
  });

  // Group by (product_id, variant_id) keeping the representative location.
  const groups = new Map<string, StockGroupKey>();
  for (const row of stockRows) {
    const key = `${row.product_id}:${row.product_variant_id ?? 'null'}`;
    if (!groups.has(key)) {
      groups.set(key, {
        product_id: row.product_id,
        product_variant_id: row.product_variant_id,
        location_id: row.location_id,
      });
    }
  }

  for (const group of groups.values()) {
    report.scanned++;

    // Reuse the exact production aggregate (scoped by operating_scope). Pass
    // the unscoped base client as `tx` so location/scope lookups run raw.
    const aggregate = await costingService.getScopedStockAggregate(
      {
        product_id: group.product_id,
        variant_id: group.product_variant_id ?? undefined,
        location_id: group.location_id,
      },
      base,
    );
    const computed = round2(aggregate.cost_per_unit);

    const current = await currentCostPrice(base, group);

    if (computed > 0) {
      if (round2(current) === computed) {
        report.skipped++;
        continue;
      }
      if (!options.dryRun) {
        await persistCostPrice(base, group, computed);
      }
      report.updated++;
      continue;
    }

    // computed <= 0 → no cost recoverable from the scoped aggregate.
    if (round2(current) > 0) {
      // Keep the existing (sane) cost_price; nothing to do.
      report.skipped++;
      continue;
    }

    // No recoverable cost AND cost_price is collapsed. If there are no cost
    // layers carrying a real cost, this product needs manual capture.
    const recoverableLayers = await base.inventory_cost_layers.count({
      where: {
        organization_id: organizationId,
        product_id: group.product_id,
        product_variant_id: group.product_variant_id,
        unit_cost: { gt: 0 },
      },
    });

    if (recoverableLayers === 0) {
      report.unrecoverable.push({
        organization_id: organizationId,
        product_id: group.product_id,
        product_variant_id: group.product_variant_id,
        current_cost_price: current,
        reason: 'no_cost_layers_and_collapsed_cost_price',
      });
    } else {
      // Layers exist but aggregate is 0 (e.g. stock_levels not yet backfilled).
      // Skip; re-run after the SQL migration seeds cost_per_unit.
      report.skipped++;
    }
  }
}

async function currentCostPrice(
  base: any,
  group: StockGroupKey,
): Promise<number> {
  if (group.product_variant_id != null) {
    const variant = await base.product_variants.findUnique({
      where: { id: group.product_variant_id },
      select: { cost_price: true },
    });
    return Number(variant?.cost_price ?? 0);
  }
  const product = await base.products.findUnique({
    where: { id: group.product_id },
    select: { cost_price: true },
  });
  return Number(product?.cost_price ?? 0);
}

async function persistCostPrice(
  base: any,
  group: StockGroupKey,
  value: number,
): Promise<void> {
  const cost_price = new Prisma.Decimal(value);
  if (group.product_variant_id != null) {
    await base.product_variants.update({
      where: { id: group.product_variant_id },
      data: { cost_price },
    });
    return;
  }
  await base.products.update({
    where: { id: group.product_id },
    data: { cost_price },
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
