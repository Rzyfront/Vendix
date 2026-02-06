import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as pg from 'pg';

/**
 * Stock Reconciliation Script
 *
 * This script synchronizes products.stock_quantity and product_variants.stock_quantity
 * with the actual values from stock_levels table.
 *
 * Use cases:
 * - Fix historical data that became desynchronized before the bug fix
 * - Verify data integrity after migrations
 * - Recovery from data corruption
 *
 * Safe to run multiple times (idempotent).
 *
 * Usage:
 *   npx ts-node prisma/scripts/reconcile-stock.ts
 *   npx ts-node prisma/scripts/reconcile-stock.ts --dry-run
 */

interface ReconciliationResult {
  products_updated: number;
  products_skipped: number;
  variants_updated: number;
  variants_skipped: number;
  errors: string[];
}

async function reconcileStock(
  prisma: PrismaClient,
  dryRun: boolean = false,
): Promise<ReconciliationResult> {
  const result: ReconciliationResult = {
    products_updated: 0,
    products_skipped: 0,
    variants_updated: 0,
    variants_skipped: 0,
    errors: [],
  };

  console.log(`\n🔄 Starting stock reconciliation${dryRun ? ' (DRY RUN)' : ''}...\n`);

  // 1. Reconcile all products
  console.log('📦 Processing products...');
  const products = await prisma.products.findMany({
    select: {
      id: true,
      name: true,
      stock_quantity: true,
    },
  });

  for (const product of products) {
    try {
      // Calculate real stock from stock_levels
      const realStock = await prisma.stock_levels.aggregate({
        where: { product_id: product.id },
        _sum: { quantity_available: true },
      });

      const calculatedStock = realStock._sum.quantity_available || 0;
      const currentStock = product.stock_quantity || 0;

      if (calculatedStock !== currentStock) {
        console.log(
          `  📝 Product #${product.id} "${product.name}": ${currentStock} → ${calculatedStock}`,
        );

        if (!dryRun) {
          await prisma.products.update({
            where: { id: product.id },
            data: {
              stock_quantity: calculatedStock,
              updated_at: new Date(),
            },
          });
        }
        result.products_updated++;
      } else {
        result.products_skipped++;
      }
    } catch (error) {
      const errorMsg = `Error processing product #${product.id}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`  ❌ ${errorMsg}`);
      result.errors.push(errorMsg);
    }
  }

  // 2. Reconcile all product variants
  console.log('\n🏷️  Processing product variants...');
  const variants = await prisma.product_variants.findMany({
    select: {
      id: true,
      product_id: true,
      sku: true,
      stock_quantity: true,
    },
  });

  for (const variant of variants) {
    try {
      // Calculate real stock for this specific variant
      const realStock = await prisma.stock_levels.aggregate({
        where: {
          product_id: variant.product_id,
          product_variant_id: variant.id,
        },
        _sum: { quantity_available: true },
      });

      const calculatedStock = realStock._sum.quantity_available || 0;
      const currentStock = variant.stock_quantity || 0;

      if (calculatedStock !== currentStock) {
        console.log(
          `  📝 Variant #${variant.id} (SKU: ${variant.sku}): ${currentStock} → ${calculatedStock}`,
        );

        if (!dryRun) {
          await prisma.product_variants.update({
            where: { id: variant.id },
            data: {
              stock_quantity: calculatedStock,
              updated_at: new Date(),
            },
          });
        }
        result.variants_updated++;
      } else {
        result.variants_skipped++;
      }
    } catch (error) {
      const errorMsg = `Error processing variant #${variant.id}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`  ❌ ${errorMsg}`);
      result.errors.push(errorMsg);
    }
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const connectionString =
    process.env.DATABASE_URL ||
    'postgresql://username:password@localhost:5432/vendix_db?schema=public';

  const pool = new pg.Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  console.log('═'.repeat(70));
  console.log('🔧 STOCK RECONCILIATION SCRIPT');
  console.log('═'.repeat(70));
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN (no changes will be made)' : '⚡ LIVE (will update database)'}`);

  const startTime = Date.now();

  try {
    const result = await reconcileStock(prisma, dryRun);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n' + '═'.repeat(70));
    console.log(`📊 RECONCILIATION SUMMARY (completed in ${duration}s)`);
    console.log('═'.repeat(70));
    console.log(`  Products updated:  ${result.products_updated}`);
    console.log(`  Products skipped:  ${result.products_skipped} (already in sync)`);
    console.log(`  Variants updated:  ${result.variants_updated}`);
    console.log(`  Variants skipped:  ${result.variants_skipped} (already in sync)`);

    if (result.errors.length > 0) {
      console.log(`\n  ⚠️  Errors: ${result.errors.length}`);
      result.errors.forEach((err) => console.log(`     - ${err}`));
    }

    console.log('═'.repeat(70));

    if (dryRun && (result.products_updated > 0 || result.variants_updated > 0)) {
      console.log('\n💡 Run without --dry-run to apply these changes.');
    }

    if (result.errors.length > 0) {
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('💥 Script failed with unhandled error:');
  console.error(error);
  process.exit(1);
});

export { reconcileStock };
