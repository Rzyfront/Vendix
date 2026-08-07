/**
 * QUI-628 — Backfill de carts.converted_order_id / converted_at / state
 * =====================================================================
 *
 * Corre DESPUÉS de la migración `20260805120000_carts_abandoned_state`
 * (que agrega las columnas). Para cada orden NO-POS (`channel IN
 * ('ecommerce','whatsapp','agent','marketplace')`) en el pasado, busca el
 * cart del mismo user (en el mismo store) con `created_at <= order.placed_at`
 * y que NO esté ya convertido, y lo marca como `state='converted'` con el
 * order id y timestamp de la orden.
 *
 * Estrategia del join cart→order (best-effort, no FK histórica):
 *
 *   - Si el cart SÍ tiene `converted_order_id` ya seteado por la nueva lógica
 *     del checkout, se respeta — no se sobreescribe (first-write-wins).
 *   - Si NO, se busca el cart del user en el mismo store cuyo `created_at`
 *     sea el más reciente ≤ `order.placed_at`, dentro de una ventana de 7
 *     días. Un usuario con varios carts abandon+recover+abandon en la misma
 *     semana puede quedar mal mapeado, pero el caso típico (1 cart por
 *     sesión de compra) cuadra.
 *
 * Seguro e idempotente:
 *
 *   - `--dry-run` es el DEFAULT: solo reporta, no escribe nada.
 *   - Solo escribe carts con `converted_order_id IS NULL` (first-write-wins).
 *   - El reporte al final lista cuántos carts quedaron sin mapear — esos
 *     son los que el dueño del producto debería revisar manualmente si
 *     quiere re-mapear un histórico específico.
 *
 * Uso:
 *   npm run migrate:cart-conversions -- --dry-run          (default)
 *   npm run migrate:cart-conversions -- --run
 *   npm run migrate:cart-conversions -- --run --store-id=10
 */
import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface BackfillReport {
  dryRun: boolean;
  scanned_orders: number;
  carts_marked: number;
  carts_unmatched: number;
  unmatched_samples: Array<{
    order_id: number;
    user_id: number;
    placed_at: Date;
    reason: string;
  }>;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--run');
  const storeIdArg = args.find((a) => a.startsWith('--store-id='));
  const storeId = storeIdArg
    ? parseInt(storeIdArg.split('=')[1], 10)
    : undefined;

  console.log(
    `[backfill-cart-conversions] starting (dryRun=${dryRun}${storeId ? `, storeId=${storeId}` : ''})`,
  );

  // 1. Find all non-POS orders in the past. POS orders have no cart (the
  // cart flow is ecommerce / whatsapp / agent / marketplace).
  const orders = await prisma.orders.findMany({
    where: {
      state: { notIn: ['cancelled'] }, // cancelled orders never converted
      ...(storeId ? { store_id: storeId } : {}),
      channel: { in: ['ecommerce', 'whatsapp', 'agent', 'marketplace'] },
    },
    select: {
      id: true,
      store_id: true,
      customer_id: true,
      placed_at: true,
      created_at: true,
    },
    orderBy: { placed_at: 'asc' },
  });

  console.log(`[backfill-cart-conversions] scanning ${orders.length} non-POS orders`);

  let cartsMarked = 0;
  let cartsUnmatched = 0;
  const unmatchedSamples: BackfillReport['unmatched_samples'] = [];

  for (const order of orders) {
    if (!order.customer_id) {
      cartsUnmatched++;
      if (unmatchedSamples.length < 10) {
        unmatchedSamples.push({
          order_id: order.id,
          user_id: 0,
          placed_at: order.placed_at ?? order.created_at ?? new Date(0),
          reason: 'guest order, no customer_id',
        });
      }
      continue;
    }

    // placed_at is nullable; fall back to created_at; created_at has
    // `@default(now())` so it should always be non-null in practice but the
    // schema lets it be null.
    const placedAt: Date =
      order.placed_at ?? order.created_at ?? new Date(0);

    // Find the user's cart in the same store, closest BEFORE the order, that
    // hasn't been converted yet. `converted_order_id` was added in the QUI-628
    // migration but the public `@prisma/client` types have not been regenerated
    // yet on this branch, so cast the where clause through `any` to keep the
    // script compiling against the migrated schema.
    const candidate = await prisma.carts.findFirst({
      where: {
        store_id: order.store_id,
        user_id: order.customer_id,
        converted_order_id: null,
        created_at: {
          lte: placedAt,
          gte: new Date(placedAt.getTime() - 7 * 24 * 60 * 60 * 1000),
        },
      } as any,
      orderBy: { created_at: 'desc' },
    });

    if (!candidate) {
      cartsUnmatched++;
      if (unmatchedSamples.length < 10) {
        unmatchedSamples.push({
          order_id: order.id,
          user_id: order.customer_id,
          placed_at: placedAt,
          reason: 'no matching cart within 7-day window',
        });
      }
      continue;
    }

    if (!dryRun) {
      // The new columns (`state`, `converted_order_id`, `converted_at`,
      // `last_activity_at`) ship in this PR's migration but the public
      // `@prisma/client` types are regenerated by `prisma generate`. Until
      // that step runs in the deploy, cast through `any` so the script
      // compiles against the migrated schema.
      await prisma.carts.update({
        where: { id: candidate.id },
        data: {
          state: 'converted',
          converted_order_id: order.id,
          converted_at: placedAt,
        } as any,
      });
    }
    cartsMarked++;
  }

  const report: BackfillReport = {
    dryRun,
    scanned_orders: orders.length,
    carts_marked: cartsMarked,
    carts_unmatched: cartsUnmatched,
    unmatched_samples: unmatchedSamples,
  };

  console.log('[backfill-cart-conversions] DONE');
  console.log(JSON.stringify(report, null, 2));
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error('[backfill-cart-conversions] FAILED', err);
    await prisma.$disconnect();
    process.exit(1);
  });
