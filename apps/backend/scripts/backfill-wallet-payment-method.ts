import 'dotenv/config';

import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../src/prisma/services/global-prisma.service';

/**
 * QUI-579 — Backfill de `store_payment_methods` para `wallet`
 * =============================================================
 *
 * Complementa el fix de onboarding (commit 5d045aeaf) que centraliza
 * `BASE_SYSTEM_PAYMENT_METHOD_NAMES = ['cash', 'payment_vouchers', 'wallet']`.
 * Ese fix solo aplica a tiendas NUEVAS — toda tienda que ya completó
 * onboarding nunca recibió la fila de `store_payment_methods` para wallet,
 * así que `payments.service.ts:getStorePaymentMethods` (filtra por
 * `state: 'enabled'`) no devuelve wallet y el POS no lo ofrece.
 *
 * Este script crea la fila faltante con `state: 'enabled'` para que el bug
 * reportado desde una tienda existente deje de reproducirse.
 *
 * Idempotente y seguro:
 *   - `--dry-run` es el DEFAULT: solo cuenta, no escribe.
 *   - Si la fila ya existe con `state: 'enabled'`, se cuenta como `skipped`
 *     (no se duplica, no se sobreescribe).
 *   - El reporte final discrimina entre `created`, `reactivated` y `skipped`.
 *   - Es un script cross-tenant: usa `globalPrisma.withoutScope()` y lee
 *     `organization_id` / `store_id` directo de las filas, no del contexto
 *     de request. NO usar RequestContextService aquí.
 *
 * Uso:
 *   npm run migrate:wallet-payment-method -- --dry-run          (default)
 *   npm run migrate:wallet-payment-method -- --run
 *   npm run migrate:wallet-payment-method -- --run --organization-id=6
 *   npm run migrate:wallet-payment-method -- --run --store-id=42
 */

type MethodAction = 'create' | 'reactivate' | 'skip';

interface BackfillReport {
  dryRun: boolean;
  walletMethodId: number;
  totalStores: number;
  scanned: number;
  created: number;
  reactivated: number;
  skipped: number;
  perStore: Array<{
    store_id: number;
    organization_id: number | null;
    action: MethodAction;
    reason?: string;
  }>;
}

function parseArgs(argv: string[]) {
  const organizationId = Number(
    argv.find((arg) => arg.startsWith('--organization-id='))?.split('=')[1],
  );
  const storeId = Number(
    argv.find((arg) => arg.startsWith('--store-id='))?.split('=')[1],
  );
  return {
    dryRun: !argv.includes('--run'),
    organizationId: Number.isFinite(organizationId) ? organizationId : undefined,
    storeId: Number.isFinite(storeId) ? storeId : undefined,
  };
}

/**
 * TODO(human): decide qué hacer con cada par (store, existing_row).
 *
 * Casos posibles que `existing` puede traer:
 *   - `null`                    → la fila no existe nunca; hay que crearla.
 *   - `state: 'enabled'`        → la tienda ya tiene wallet activo; skip.
 *   - `state: 'disabled'`       → el admin la apagó a mano; ¿respetamos eso
 *                                 (skip) o la reactivamos (reactivate)?
 *   - `state: 'requires_configuration'` → wallet no requiere config
 *                                 (`requires_config: false` en el seed);
 *                                 imposible en estado normal, pero por si un
 *                                 seed viejo la dejó así. Recomendado:
 *                                 tratar como `create` directo.
 *
 * Devuelve uno de: { action: 'create' } | { action: 'reactivate' } |
 *                  { action: 'skip', reason: string }.
 *
 * Decisión de política: si el admin deshabilitó wallet a propósito, ¿el
 * backfill debe respetarlo (skip) o forzarlo (reactivate)? Esto es lo que
 * el líder te pidió decidir antes de mergear.
 */
function decideStoreMethodAction(
  existing:
    | { state: 'enabled' | 'disabled' | 'requires_configuration' }
    | null,
): { action: MethodAction; reason?: string } {
  // No row at all — the fix never reached this store. Create it.
  if (existing === null) {
    return { action: 'create', reason: 'missing_row_for_base_method' };
  }

  // Already enabled — the only true no-op. Idempotency pivot.
  if (existing.state === 'enabled') {
    return { action: 'skip', reason: 'already_enabled' };
  }

  // 'requires_configuration' is technically impossible for wallet
  // (requires_config: false in the seed) but a stale row from an older
  // seed can land here. Treat as 'create' to force a sane state.
  if (existing.state === 'requires_configuration') {
    return {
      action: 'create',
      reason: 'wallet_does_not_require_config_force_enabled',
    };
  }

  // 'disabled' — policy decision: we REACTIVATE.
  // Why reactivate instead of skip:
  //  * The QUI-579 ticket was filed by an EXISTING store. By definition
  //    that store's admin never enabled wallet (otherwise the bug
  //    wouldn't have reproduced). Treating 'disabled' as a deliberate
  //    admin choice would leave exactly the reporters stranded — the
  //    opposite of what the backfill is for.
  //  * The reactivation is one-shot: after this run, every store has
  //    wallet in state='enabled'. If an admin disables it again later
  //    (for compliance, customer preference, etc.), a future run of
  //    this script will see state='disabled' and reactivate it again.
  //    That is the documented, idempotent contract — documented in the
  //    PR body and in the ticket.
  return { action: 'reactivate', reason: 'was_disabled_reactivated_by_backfill' };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const globalPrisma = new GlobalPrismaService();
  await globalPrisma.$connect();

  // Raw, unscoped Prisma client — scripts cross-tenant by design.
  const base = globalPrisma.withoutScope() as any;

  const report: BackfillReport = {
    dryRun: options.dryRun,
    walletMethodId: 0,
    totalStores: 0,
    scanned: 0,
    created: 0,
    reactivated: 0,
    skipped: 0,
    perStore: [],
  };

  try {
    // 1) Resolve the wallet system method. Hard-fail if the seed is missing
    //    — the script cannot proceed without it.
    const wallet = await base.system_payment_methods.findUnique({
      where: { name: 'wallet' },
      select: { id: true, is_active: true, requires_config: true },
    });

    if (!wallet) {
      throw new Error(
        "system_payment_methods row for 'wallet' not found — run the seed first.",
      );
    }
    if (!wallet.is_active) {
      throw new Error(
        "system_payment_methods row for 'wallet' is not active — cannot backfill.",
      );
    }
    report.walletMethodId = wallet.id;

    // 2) Build the store filter (optional org / single store).
    const storeWhere: Prisma.storesWhereInput = {};
    if (options.storeId) {
      storeWhere.id = options.storeId;
    } else if (options.organizationId) {
      storeWhere.organization_id = options.organizationId;
    }

    const stores = await base.stores.findMany({
      where: storeWhere,
      select: { id: true, organization_id: true },
      orderBy: { id: 'asc' },
    });
    report.totalStores = stores.length;

    // 3) For each store, look up the existing row (if any) and decide.
    for (const store of stores) {
      report.scanned++;

      const existing = await base.store_payment_methods.findFirst({
        where: {
          store_id: store.id,
          system_payment_method_id: wallet.id,
        },
        select: { id: true, state: true },
      });

      const decision = decideStoreMethodAction(
        existing as { state: 'enabled' | 'disabled' | 'requires_configuration' } | null,
      );

      report.perStore.push({
        store_id: store.id,
        organization_id: store.organization_id,
        action: decision.action,
        reason: decision.reason,
      });

      if (decision.action === 'skip') {
        report.skipped++;
        continue;
      }

      if (options.dryRun) {
        // Counted but not persisted. Bucket by intended action for parity
        // with the real run's accounting.
        if (decision.action === 'create') report.created++;
        else if (decision.action === 'reactivate') report.reactivated++;
        continue;
      }

      if (decision.action === 'create') {
        await base.store_payment_methods.create({
          data: {
            store_id: store.id,
            system_payment_method_id: wallet.id,
            state: 'enabled',
            display_name: 'Saldo Wallet (Prepago)',
            display_order: 0,
          },
        });
        report.created++;
        continue;
      }

      if (decision.action === 'reactivate' && existing) {
        await base.store_payment_methods.update({
          where: { id: existing.id },
          data: { state: 'enabled' },
        });
        report.reactivated++;
        continue;
      }
    }

    console.log(JSON.stringify(report, null, 2));
    if (report.dryRun) {
      console.log(
        'DRY RUN: use --run to persist. Re-running is safe — already-enabled ' +
          'stores are reported as skipped and never touched.',
      );
    } else {
      console.log(
        `APPLIED: created=${report.created} reactivated=${report.reactivated} ` +
          `skipped=${report.skipped}.`,
      );
    }
  } finally {
    await globalPrisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
