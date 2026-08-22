/* eslint-disable no-console */
/**
 * CP-PURCHASE-TRANSPARENCY D.5 — saneamiento de existencia fantasma de
 * productos YA ARCHIVADOS.
 * ==========================================================================
 *
 * EL PROBLEMA
 * -----------
 * Hay filas de `stock_levels` con `quantity_on_hand > 0` cuyo producto está en
 * `state = 'archived'`. Es existencia fantasma: el operador borró el producto y
 * el sistema siguió contándolo como activo — infla el inventario del balance y
 * envenena el costo promedio.
 *
 * POR QUÉ NO SIRVE LA PUERTA QUE YA EXISTE
 * ----------------------------------------
 * `ProductsService.remove(id, opts)` ya hace exactamente este castigo (ajuste
 * de tipo `loss`, `reason_code: 'product_archived'`, todo en una transacción,
 * con asiento contable). Pero empieza por `loadProductForArchive()`, que filtra
 * `state != archived` — y estos productos YA están archivados. La puerta les
 * está cerrada por construcción.
 *
 * Este script es la vía de saneamiento equivalente para productos ya
 * archivados. NO vuelve a tocar `products.state`: sólo lleva la existencia a
 * cero por la MISMA ruta de producción.
 *
 * REGLAS DURAS QUE RESPETA
 * ------------------------
 *  1. TODO ajuste pasa por `InventoryAdjustmentsService`
 *     (`createAdjustmentInTransaction`). Cero SQL de escritura, cero UPDATE a
 *     mano, cero migraciones de datos.
 *  2. Nada de TRUNCATE / DROP / DELETE sin WHERE / CASCADE.
 *  3. `reason_code = 'product_archived_backfill'`, distinguible en auditoría de
 *     los ajustes que emite el flujo normal de archivado.
 *  4. El evento `inventory.adjusted` SÍ se emite (después del commit) para que
 *     nazca el asiento DR 529505 Faltantes de inventario / CR 1435 Inventario.
 *     Ese asiento es la razón por la que esto se hace por el servicio y no por
 *     SQL.
 *
 * GARANTÍAS
 * ---------
 *  - `--dry-run` es el DEFAULT. Sin `--execute` no se escribe nada.
 *  - Respaldo JSON con marca de tiempo ANTES de tocar nada. Si el volcado
 *    falla, el script aborta.
 *  - Las filas con `quantity_reserved > 0` se SALTAN y se enumeran: esa
 *    existencia está comprometida con un pedido vivo.
 *  - Idempotente y reanudable: la fila se relee DENTRO de su transacción y, si
 *    ya está en cero, no se emite ajuste.
 *  - Cada fila es una transacción independiente: un fallo no aborta el lote.
 *  - Después de cada ajuste se VERIFICA que el asiento exista o que su fallo
 *    haya quedado registrado en `accounting_entry_failures`. El silencio cuenta
 *    como fallo de esa fila.
 *
 * USO
 * ---
 *   # Dry-run (default, no escribe nada)
 *   docker exec vendix_backend sh -lc 'cd /app && npx ts-node -r tsconfig-paths/register --transpile-only scripts/writeoff-archived-product-stock.ts'
 *
 *   # Ejecución real, acotada a dos organizaciones
 *   docker exec vendix_backend sh -lc 'cd /app && npx ts-node -r tsconfig-paths/register --transpile-only scripts/writeoff-archived-product-stock.ts --execute --orgs=10,33'
 *
 * BANDERAS
 * --------
 *   --execute                   Escribe. Sin ella, DRY-RUN.
 *   --orgs=10,33                Acota a esas organizaciones. Sin ella, todas.
 *   --limit=N                   Castiga como mucho N filas (las saltadas no
 *                               consumen cupo). Para escalonar el primer lote.
 *   --user-id=N                 Autor y aprobador de los ajustes. Sin ella, sistema.
 *   --backup-dir=RUTA           Default `scripts/backups` (relativo al cwd).
 *   --progress-every=N          Avance cada N filas procesadas. Default 25.
 *   --accounting-timeout-ms=N   Espera máxima al asiento. Default 15000.
 *   --accounting-poll-ms=N      Intervalo del sondeo. Default 200.
 */

import 'dotenv/config';

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { StorePrismaService } from '../src/prisma/services/store-prisma.service';
import { InventoryAdjustmentsService } from '../src/domains/store/inventory/adjustments/inventory-adjustments.service';
import {
  RequestContextService,
  RequestContext,
} from '../src/common/context/request-context.service';

import {
  ACCOUNTING_SOURCE_TYPE,
  AUDIT_ACTION,
  AccountingOutcome,
  CliOptions,
  FailedRow,
  PhantomStockRow,
  ProcessedRow,
  SkippedRow,
  WRITE_OFF_REASON_CODE,
  backupFileName,
  classifyRow,
  estimateRowValue,
  formatMoney,
  formatProgressLine,
  parseArgs,
  resolveUnitCost,
  summarize,
} from './writeoff-archived-product-stock.logic';

const RULE = '='.repeat(78);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Descubrimiento
// ---------------------------------------------------------------------------

/**
 * Las filas candidatas, leídas con el cliente SIN ALCANCE.
 *
 * Es deliberado: el universo hay que verlo entero y cruzando organizaciones
 * ANTES de decidir. El alcance se aplica después, fila por fila, forjando el
 * contexto de la tienda dueña de la ubicación — que es el único que le permite
 * al servicio de ajustes escribir esa fila.
 */
async function discover(
  base: any,
  options: CliOptions,
): Promise<PhantomStockRow[]> {
  const rows = await base.stock_levels.findMany({
    where: {
      quantity_on_hand: { gt: 0 },
      products: { is: { state: 'archived' } },
      ...(options.orgs
        ? {
            inventory_locations: {
              is: { organization_id: { in: options.orgs } },
            },
          }
        : {}),
    },
    select: {
      id: true,
      product_id: true,
      product_variant_id: true,
      location_id: true,
      quantity_on_hand: true,
      quantity_reserved: true,
      cost_per_unit: true,
      products: {
        select: {
          name: true,
          sku: true,
          store_id: true,
          track_inventory: true,
          cost_price: true,
        },
      },
      product_variants: { select: { sku: true, cost_price: true } },
      inventory_locations: {
        select: {
          name: true,
          store_id: true,
          organization_id: true,
          is_central_warehouse: true,
          organizations: { select: { name: true } },
        },
      },
    },
    orderBy: [
      { location_id: 'asc' },
      { product_id: 'asc' },
      { id: 'asc' },
    ],
  });

  return rows.map(
    (row: any): PhantomStockRow => ({
      stock_level_id: row.id,
      product_id: row.product_id,
      product_variant_id: row.product_variant_id ?? null,
      location_id: row.location_id,
      location_name: row.inventory_locations?.name ?? `#${row.location_id}`,
      location_store_id: row.inventory_locations?.store_id ?? null,
      is_central_warehouse:
        row.inventory_locations?.is_central_warehouse ?? false,
      organization_id: row.inventory_locations?.organization_id ?? null,
      organization_name: row.inventory_locations?.organizations?.name ?? null,
      product_name: row.products?.name ?? `#${row.product_id}`,
      product_sku: row.products?.sku ?? null,
      product_store_id: row.products?.store_id ?? null,
      product_track_inventory: row.products?.track_inventory ?? false,
      product_cost_price:
        row.products?.cost_price != null ? Number(row.products.cost_price) : null,
      variant_sku: row.product_variants?.sku ?? null,
      variant_cost_price:
        row.product_variants?.cost_price != null
          ? Number(row.product_variants.cost_price)
          : null,
      quantity_on_hand: Number(row.quantity_on_hand) || 0,
      quantity_reserved: Number(row.quantity_reserved) || 0,
      cost_per_unit: row.cost_per_unit != null ? Number(row.cost_per_unit) : null,
    }),
  );
}

// ---------------------------------------------------------------------------
// Respaldo
// ---------------------------------------------------------------------------

/**
 * Vuelca a disco TODAS las filas descubiertas — las que se van a castigar y las
 * que se saltan, cada una con su motivo — antes de tocar nada.
 *
 * Si esto falla, el script ABORTA: destruir existencia sin haber podido guardar
 * de qué existencia se trataba no es una opción.
 */
function writeBackup(
  rows: PhantomStockRow[],
  options: CliOptions,
  startedAt: Date,
  runId: string,
): string {
  const dir = path.resolve(process.cwd(), options.backupDir);
  fs.mkdirSync(dir, { recursive: true });

  const file = path.join(dir, backupFileName(startedAt, options.execute));

  const payload = {
    run_id: runId,
    generated_at: startedAt.toISOString(),
    mode: options.execute ? 'execute' : 'dry-run',
    reason_code: WRITE_OFF_REASON_CODE,
    filters: { orgs: options.orgs, limit: options.limit },
    totals: {
      rows: rows.length,
      products: new Set(rows.map((row) => row.product_id)).size,
      units: rows.reduce((sum, row) => sum + row.quantity_on_hand, 0),
      estimated_value: rows.reduce((sum, row) => sum + estimateRowValue(row), 0),
    },
    rows: rows.map((row) => {
      const plan = classifyRow(row);
      return {
        stock_level_id: row.stock_level_id,
        organization_id: row.organization_id,
        organization_name: row.organization_name,
        store_id: row.location_store_id,
        location_id: row.location_id,
        location_name: row.location_name,
        product_id: row.product_id,
        product_name: row.product_name,
        product_sku: row.product_sku,
        product_variant_id: row.product_variant_id,
        variant_sku: row.variant_sku,
        quantity_on_hand: row.quantity_on_hand,
        quantity_reserved: row.quantity_reserved,
        cost_per_unit: row.cost_per_unit,
        resolved_unit_cost: resolveUnitCost(row),
        estimated_value: estimateRowValue(row),
        plan:
          plan.action === 'process'
            ? { action: 'process' }
            : { action: 'skip', reason: plan.reason, detail: plan.detail },
      };
    }),
  };

  // `writeFileSync` sin try/catch: si no se puede escribir, que reviente aquí
  // y el lote no empiece.
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  return file;
}

// ---------------------------------------------------------------------------
// Verificación contable
// ---------------------------------------------------------------------------

/**
 * El evento `inventory.adjusted` se despacha con `emit()`, no con `emitAsync()`:
 * el manejador contable corre como promesa suelta y NO está terminado cuando
 * `emitInventoryAdjusted` retorna. Por eso hay que sondear.
 *
 * Tres desenlaces legítimos y uno inaceptable:
 *   - costo 0 → el servicio NI SIQUIERA emite (compuerta `cost_amount > 0`).
 *     No debe haber asiento. Se cuenta aparte, no como éxito contable.
 *   - asiento en `accounting_entries` → posteado.
 *   - fila en `accounting_entry_failures` → el fallo quedó registrado (la causa
 *     más probable en producción es `FISCAL_PERIOD_CLOSED`).
 *   - nada de lo anterior dentro del plazo → FALLO de la fila. El precedente de
 *     este repositorio (21 de 79 recepciones sin asiento y la tabla de fallos
 *     vacía) es la razón exacta de esta comprobación.
 */
async function verifyAccounting(
  base: any,
  organizationId: number,
  adjustmentId: number,
  costAmount: number,
  options: CliOptions,
): Promise<AccountingOutcome> {
  if (!(Math.abs(costAmount) > 0)) {
    return { status: 'not_applicable_zero_cost' };
  }

  const deadline = Date.now() + options.accountingTimeoutMs;

  for (;;) {
    const entry = await base.accounting_entries.findFirst({
      where: {
        organization_id: organizationId,
        source_type: ACCOUNTING_SOURCE_TYPE,
        source_id: adjustmentId,
      },
      select: { id: true, entry_number: true },
    });
    if (entry) {
      return {
        status: 'posted',
        entry_id: entry.id,
        entry_number: entry.entry_number,
      };
    }

    const failure = await base.accounting_entry_failures.findFirst({
      where: {
        organization_id: organizationId,
        source_type: ACCOUNTING_SOURCE_TYPE,
        source_id: adjustmentId,
      },
      select: { id: true, error_message: true },
      orderBy: { id: 'desc' },
    });
    if (failure) {
      return {
        status: 'failed_recorded',
        failure_id: failure.id,
        cause: failure.error_message ?? 'sin mensaje',
      };
    }

    if (Date.now() >= deadline) return { status: 'missing' };
    await delay(options.accountingPollMs);
  }
}

// ---------------------------------------------------------------------------
// Castigo de una fila
// ---------------------------------------------------------------------------

type RowOutcome =
  | { kind: 'processed'; processed: ProcessedRow }
  | { kind: 'skipped'; skipped: SkippedRow }
  | { kind: 'failed'; failed: FailedRow };

/**
 * Una fila, una transacción, un contexto forjado.
 *
 * `runIsolated` y no `run`: `run` deja el contexto en un estático de clase que
 * `getContext()` usa de respaldo cuando el ALS está vacío, así que forjar el
 * contexto de un tenant ajeno con `run` convertiría ese estático en «el último
 * tenant que alguien miró».
 */
async function writeOffRow(
  storePrisma: StorePrismaService,
  adjustments: InventoryAdjustmentsService,
  base: any,
  row: PhantomStockRow,
  options: CliOptions,
  runId: string,
  backupFile: string,
): Promise<RowOutcome> {
  const organizationId = row.organization_id as number;
  const storeId = row.location_store_id as number;

  const context: RequestContext = {
    organization_id: organizationId,
    store_id: storeId,
    user_id: options.userId ?? undefined,
    is_super_admin: true,
    is_owner: true,
    request_id: runId,
  };

  return RequestContextService.runIsolated(context, async () => {
    // `!`: el único camino que llega debajo del try/catch es el que asignó
    // `committed`; el catch retorna siempre.
    let committed!: {
      adjustment_id: number;
      quantity_change: number;
      cost_amount: number;
    };

    try {
      const result = await storePrisma.$transaction(
        async (tx: any) => {
          // RELECTURA DENTRO DE LA TRANSACCIÓN. Es el mecanismo de
          // idempotencia y de reanudación: si otra corrida (o esta misma,
          // interrumpida y relanzada) ya la llevó a cero, aquí no se emite
          // NADA — ni ajuste, ni movimiento, ni asiento.
          const fresh = await tx.stock_levels.findFirst({
            where: { id: row.stock_level_id },
            select: {
              id: true,
              quantity_on_hand: true,
              quantity_reserved: true,
              cost_per_unit: true,
            },
          });

          if (!fresh) {
            throw new Error(
              `La fila de stock #${row.stock_level_id} no es visible con el alcance de la ` +
                `tienda #${storeId}. No se escribió nada.`,
            );
          }

          if (fresh.quantity_on_hand <= 0) {
            return { kind: 'already_zero' as const };
          }

          // Segunda lectura de la reserva, ya en la transacción: entre el
          // descubrimiento y este punto pudo nacer una.
          if (fresh.quantity_reserved > 0) {
            return {
              kind: 'reserved_now' as const,
              reserved: fresh.quantity_reserved,
            };
          }

          const adjustment =
            await adjustments.createAdjustmentInTransaction(
              tx,
              {
                product_id: row.product_id,
                product_variant_id: row.product_variant_id ?? undefined,
                location_id: row.location_id,
                type: 'loss',
                quantity_after: 0,
                reason_code: WRITE_OFF_REASON_CODE,
                description:
                  `Saneamiento D.5: baja de existencia fantasma del producto archivado ` +
                  `#${row.product_id} (${row.product_name}) en ${row.location_name}.`,
              },
              { approvedByUserId: options.userId ?? undefined },
            );

          // NO ES CEREMONIA. `StockLevelManager.updateStock` devuelve un NO-OP
          // SILENCIOSO (`{stock_level: null}`) si el producto no es visible con
          // el alcance vigente o si no lleva inventario: la fila de ajuste
          // quedaría escrita y el stock intacto. Comprobarlo aquí, dentro de la
          // transacción, convierte ese silencio en una reversión.
          const after = await tx.stock_levels.findFirst({
            where: { id: row.stock_level_id },
            select: { quantity_on_hand: true },
          });

          if (!after || after.quantity_on_hand !== 0) {
            throw new Error(
              `El ajuste #${adjustment.adjustment.id} no llevó la fila de stock ` +
                `#${row.stock_level_id} a cero (quedó ${after?.quantity_on_hand ?? 'ilegible'}). ` +
                'Transacción revertida: no queda ni el ajuste ni el movimiento.',
            );
          }

          // La bitácora va DENTRO de la transacción y SIN try/catch, igual que
          // en D.8: si no se puede dejar rastro, el castigo no debe ocurrir.
          await tx.audit_logs.create({
            data: {
              user_id: options.userId ?? null,
              store_id: storeId,
              organization_id: organizationId,
              action: AUDIT_ACTION,
              resource: 'stock_levels',
              resource_id: row.stock_level_id,
              request_id: runId,
              old_values: {
                quantity_on_hand: fresh.quantity_on_hand,
                quantity_reserved: fresh.quantity_reserved,
                cost_per_unit:
                  fresh.cost_per_unit != null
                    ? Number(fresh.cost_per_unit)
                    : null,
              },
              new_values: { quantity_on_hand: 0 },
              metadata: {
                source: 'script:writeoff-archived-product-stock',
                plan_step: 'CP-PURCHASE-TRANSPARENCY D.5',
                run_id: runId,
                backup_file: backupFile,
                reason_code: WRITE_OFF_REASON_CODE,
                adjustment_id: adjustment.adjustment.id,
                product_id: row.product_id,
                product_name: row.product_name,
                product_variant_id: row.product_variant_id,
                location_id: row.location_id,
                quantity_change: adjustment.quantity_change,
                cost_amount: adjustment.cost_amount,
                // Valor cero aquí significa COSTO DESCONOCIDO, no mercancía
                // gratis: la cadena canónica se agotó sin encontrar costo.
                zero_cost: !(Math.abs(adjustment.cost_amount) > 0),
              },
            },
          });

          return {
            kind: 'written' as const,
            adjustment_id: adjustment.adjustment.id,
            quantity_change: adjustment.quantity_change,
            cost_amount: adjustment.cost_amount,
            emit_payload: adjustment,
          };
        },
        // Cada ajuste arrastra el movimiento de stock, el consumo de capas de
        // costo, el espejo denormalizado y el snapshot de valoración. Los 5 s
        // por defecto de Prisma no alcanzan.
        { timeout: 120_000, maxWait: 15_000 },
      );

      if (result.kind === 'already_zero') {
        return {
          kind: 'skipped',
          skipped: {
            row,
            reason: 'already_zero',
            detail:
              'La fila ya estaba en cero al abrir su transacción (idempotencia).',
          },
        };
      }

      if (result.kind === 'reserved_now') {
        return {
          kind: 'skipped',
          skipped: {
            row,
            reason: 'reserved_stock',
            detail:
              `${result.reserved} unidad(es) quedaron reservadas para un pedido vivo entre el ` +
              'descubrimiento y la escritura. No se toca existencia comprometida.',
          },
        };
      }

      committed = {
        adjustment_id: result.adjustment_id,
        quantity_change: result.quantity_change,
        cost_amount: result.cost_amount,
      };

      // El evento contable SIEMPRE después del commit: anunciar un hecho que
      // todavía puede revertirse es peor que no anunciarlo.
      adjustments.emitInventoryAdjusted(
        result.emit_payload,
        organizationId,
        options.userId ?? null,
      );
    } catch (error: any) {
      return {
        kind: 'failed',
        failed: {
          row,
          stage: 'transaction',
          message: error?.message ?? String(error),
        },
      };
    }

    let accounting: AccountingOutcome;
    try {
      accounting = await verifyAccounting(
        base,
        organizationId,
        committed.adjustment_id,
        committed.cost_amount,
        options,
      );
    } catch (error: any) {
      return {
        kind: 'failed',
        failed: {
          row,
          stage: 'accounting_verification',
          message:
            `El stock SÍ se movió (ajuste #${committed.adjustment_id}), pero la verificación ` +
            `del asiento falló: ${error?.message ?? String(error)}`,
        },
      };
    }

    return {
      kind: 'processed',
      processed: {
        row,
        adjustment_id: committed.adjustment_id,
        quantity_change: committed.quantity_change,
        cost_amount: committed.cost_amount,
        accounting,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const runId = `d5-writeoff-${randomUUID()}`;

  console.log(RULE);
  console.log(
    'CP-PURCHASE-TRANSPARENCY D.5 — baja de existencia de productos archivados',
  );
  console.log(
    `Modo: ${options.execute ? 'EJECUCIÓN REAL (ESCRITURA)' : 'DRY-RUN (no escribe nada)'}`,
  );
  console.log(
    `Organizaciones: ${options.orgs ? options.orgs.join(', ') : 'TODAS'}` +
      ` · Límite: ${options.limit ?? 'sin límite'}` +
      ` · Usuario: ${options.userId ?? 'sistema (null)'}`,
  );
  console.log(`run_id: ${runId}`);
  console.log(RULE);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
    abortOnError: false,
  });

  let exitCode = 0;

  try {
    const storePrisma = app.get(StorePrismaService, { strict: false });
    const adjustments = app.get(InventoryAdjustmentsService, { strict: false });
    const base = storePrisma.withoutScope() as any;

    const rows = await discover(base, options);

    const totalUnits = rows.reduce((sum, row) => sum + row.quantity_on_hand, 0);
    const totalValue = rows.reduce((sum, row) => sum + estimateRowValue(row), 0);
    const totalProducts = new Set(rows.map((row) => row.product_id)).size;

    console.log(
      `\nDescubiertas ${rows.length} fila(s) de stock_levels con existencia en ` +
        `${totalProducts} producto(s) archivado(s): ` +
        `${formatMoney(totalUnits)} unidades · ${formatMoney(totalValue)} COP estimados.`,
    );

    if (rows.length === 0) {
      console.log('\nNada que sanear. Fin.');
      return;
    }

    // Respaldo ANTES de tocar nada — también en dry-run, que es justamente el
    // artefacto que se revisa antes de autorizar la ejecución.
    const backupFile = writeBackup(rows, options, startedAt, runId);
    console.log(`Respaldo escrito en: ${backupFile}`);

    // Clasificación
    const planned: PhantomStockRow[] = [];
    const skipped: SkippedRow[] = [];

    for (const row of rows) {
      const plan = classifyRow(row);
      if (plan.action === 'skip') {
        skipped.push({ row, reason: plan.reason, detail: plan.detail });
        continue;
      }
      if (options.limit !== null && planned.length >= options.limit) {
        skipped.push({
          row,
          reason: 'over_limit',
          detail:
            `Fuera del cupo de --limit=${options.limit}. No se evaluó ni se tocó; ` +
            'sigue pendiente para la siguiente tanda.',
        });
        continue;
      }
      planned.push(row);
    }

    const plannedUnits = planned.reduce(
      (sum, row) => sum + row.quantity_on_hand,
      0,
    );
    const plannedValue = planned.reduce(
      (sum, row) => sum + estimateRowValue(row),
      0,
    );

    console.log(
      `\nA castigar: ${planned.length} fila(s) · ${formatMoney(plannedUnits)} unidades · ` +
        `${formatMoney(plannedValue)} COP estimados.`,
    );
    console.log(`A saltar:   ${skipped.length} fila(s).`);

    if (skipped.length > 0) {
      printSkipped(skipped);
    }

    if (!options.execute) {
      console.log(`\n${RULE}`);
      console.log(
        'DRY-RUN: no se escribió nada. Revisa el respaldo y vuelve a lanzar con --execute.',
      );
      console.log(RULE);
      return;
    }

    // Ejecución
    console.log(`\n${RULE}`);
    console.log('EJECUCIÓN REAL — una transacción por fila.');
    console.log(RULE);

    const processed: ProcessedRow[] = [];
    const failed: FailedRow[] = [];
    let runningUnits = 0;
    let runningValue = 0;

    for (let index = 0; index < planned.length; index++) {
      const row = planned[index];
      const outcome = await writeOffRow(
        storePrisma,
        adjustments,
        base,
        row,
        options,
        runId,
        backupFile,
      );

      if (outcome.kind === 'processed') {
        processed.push(outcome.processed);
        runningUnits += Math.abs(outcome.processed.quantity_change);
        runningValue += Math.abs(outcome.processed.cost_amount);
        if (outcome.processed.accounting.status === 'missing') {
          failed.push({
            row,
            stage: 'accounting_verification',
            message:
              `El stock se movió (ajuste #${outcome.processed.adjustment_id}) pero no apareció ` +
              'ni el asiento ni una fila en accounting_entry_failures dentro del plazo. ' +
              'Revísalo a mano: es exactamente el silencio que este plan vino a eliminar.',
          });
        }
      } else if (outcome.kind === 'skipped') {
        skipped.push(outcome.skipped);
      } else {
        failed.push(outcome.failed);
        console.log(
          `  ✗ fila stock_levels#${row.stock_level_id} (producto #${row.product_id} ` +
            `${row.product_name}): ${outcome.failed.message}`,
        );
      }

      const done = index + 1;
      if (done % options.progressEvery === 0 || done === planned.length) {
        console.log(
          formatProgressLine(done, planned.length, runningUnits, runningValue),
        );
      }
    }

    const summary = summarize(rows.length, processed, skipped, failed);
    printSummary(summary, processed, skipped, failed, backupFile);

    if (summary.failed > 0) exitCode = 1;
  } finally {
    await app.close();
  }

  process.exitCode = exitCode;
}

function printSkipped(skipped: SkippedRow[]) {
  const byReason = new Map<string, SkippedRow[]>();
  for (const entry of skipped) {
    const bucket = byReason.get(entry.reason) ?? [];
    bucket.push(entry);
    byReason.set(entry.reason, bucket);
  }

  console.log('\nFilas SALTADAS y por qué:');
  for (const [reason, entries] of byReason) {
    console.log(`\n  · ${reason} — ${entries.length} fila(s)`);
    console.log(`    ${entries[0].detail}`);
    for (const entry of entries) {
      console.log(
        `      stock_levels#${entry.row.stock_level_id} · org ${entry.row.organization_id ?? '?'}` +
          ` · tienda ${entry.row.location_store_id ?? 'null'}` +
          ` · producto #${entry.row.product_id} ${entry.row.product_name}` +
          (entry.row.product_variant_id
            ? ` (variante #${entry.row.product_variant_id})`
            : '') +
          ` · on_hand ${entry.row.quantity_on_hand}` +
          ` · reservadas ${entry.row.quantity_reserved}`,
      );
    }
  }
}

function printSummary(
  summary: ReturnType<typeof summarize>,
  processed: ProcessedRow[],
  skipped: SkippedRow[],
  failed: FailedRow[],
  backupFile: string,
) {
  console.log(`\n${RULE}`);
  console.log('RESUMEN');
  console.log(RULE);
  console.log(`  Descubiertas : ${summary.scanned}`);
  console.log(`  Procesadas   : ${summary.processed}`);
  console.log(`  Saltadas     : ${summary.skipped}`);
  console.log(`  Fallidas     : ${summary.failed}`);
  console.log(
    `  Unidades dadas de baja : ${formatMoney(summary.units_written_off)}`,
  );
  console.log(
    `  Valor contabilizado    : ${formatMoney(summary.value_written_off)} COP`,
  );
  console.log('\n  Asientos contables:');
  console.log(`    posteados                 : ${summary.accounting_posted}`);
  console.log(
    `    sin asiento (costo cero)  : ${summary.accounting_zero_cost}  ` +
      '(costo DESCONOCIDO, no mercancía gratis)',
  );
  console.log(
    `    fallo registrado          : ${summary.accounting_failed_recorded}`,
  );
  console.log(
    `    AUSENTES SIN REGISTRO     : ${summary.accounting_missing}  ` +
      '(cuentan como fila fallida)',
  );

  const recorded = processed.filter(
    (entry) => entry.accounting.status === 'failed_recorded',
  );
  if (recorded.length > 0) {
    console.log('\n  Fallos contables registrados:');
    for (const entry of recorded) {
      const accounting = entry.accounting as {
        status: 'failed_recorded';
        failure_id: number;
        cause: string;
      };
      console.log(
        `    ajuste #${entry.adjustment_id} · accounting_entry_failures#${accounting.failure_id}` +
          ` · ${accounting.cause}`,
      );
    }
  }

  if (skipped.length > 0) {
    console.log('\n  Saltadas por motivo:');
    for (const [reason, count] of Object.entries(summary.skipped_by_reason)) {
      console.log(`    ${reason}: ${count}`);
    }
  }

  if (failed.length > 0) {
    console.log('\n  Fallidas (detalle):');
    for (const entry of failed) {
      console.log(
        `    stock_levels#${entry.row.stock_level_id} [${entry.stage}] ${entry.message}`,
      );
    }
  }

  console.log(`\n  Respaldo: ${backupFile}`);
  console.log(RULE);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
