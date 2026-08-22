/**
 * CP-PURCHASE-TRANSPARENCY D.5 — lógica PURA del saneamiento de existencia
 * fantasma de productos ya archivados.
 * ==========================================================================
 *
 * Este archivo NO importa Nest, NO importa Prisma y NO toca la base. Sólo
 * contiene las decisiones: cómo se leen las banderas, qué fila se castiga, cuál
 * se salta y por qué, cómo se valora, y cómo se resume el lote.
 *
 * Vive separado del ejecutor (`writeoff-archived-product-stock.ts`) por una
 * razón concreta: el ejecutor arranca el grafo completo de Nest, así que
 * importarlo desde un `spec` levantaría la aplicación entera. Con la lógica
 * aquí, la decisión que gobierna una operación irreversible se puede probar en
 * milisegundos y sin base de datos.
 */

/** Motivo por el que una fila NO se castiga. Cada uno se reporta aparte. */
export type SkipReason =
  /**
   * Hay unidades comprometidas con un pedido vivo. Llevarlas a cero deja un
   * pedido que no se puede cumplir: eso ya no es «un producto archivado que
   * infla el activo», es mercancía real reservada. NUNCA se toca.
   */
  | 'reserved_stock'
  /** Ya está en cero. Es el mecanismo de idempotencia y de reanudación. */
  | 'already_zero'
  /**
   * La existencia vive en una ubicación de ORGANIZACIÓN (`store_id IS NULL`,
   * típicamente la bodega central). El servicio de ajustes de tienda no puede
   * escribirla: `products` está scopeado por tienda en `StorePrismaService` y
   * sin `store_id` en el contexto la lectura lanza `ForbiddenException`. Es
   * exactamente la misma existencia que el archivado normal BLOQUEA como
   * `out_of_scope`. Se reporta, no se destruye.
   */
  | 'org_level_location'
  /**
   * `products.store_id` no coincide con `inventory_locations.store_id`. Con el
   * contexto de la tienda de la ubicación, `StockLevelManager.updateStock`
   * no encontraría el producto y devolvería un NO-OP SILENCIOSO
   * (`{stock_level: null}`) — dejaría la fila de ajuste escrita y el stock
   * intacto. Se salta antes de llegar ahí.
   */
  | 'store_mismatch'
  /**
   * `track_inventory = false`: `updateStock` sale por la primera guarda y no
   * mueve nada, otra vez en silencio. Que quede existencia en una fila de un
   * producto que no lleva inventario es un defecto aparte; este script no lo
   * arregla, lo denuncia.
   */
  | 'inventory_not_tracked'
  /** Sin tienda ni organización resolubles: no hay contexto que forjar. */
  | 'unresolvable_context'
  /**
   * Quedó fuera del cupo de `--limit`. NO se evaluó y NO se tocó: sigue
   * pendiente para la siguiente tanda. Existe como motivo propio para que un
   * lote escalonado no se lea como «ya estaba en cero».
   */
  | 'over_limit';

/** Una fila de `stock_levels` candidata, ya desnormalizada. */
export interface PhantomStockRow {
  stock_level_id: number;
  product_id: number;
  product_variant_id: number | null;
  location_id: number;
  location_name: string;
  location_store_id: number | null;
  is_central_warehouse: boolean;
  organization_id: number | null;
  organization_name: string | null;
  product_name: string;
  product_sku: string | null;
  product_store_id: number | null;
  product_track_inventory: boolean;
  product_cost_price: number | null;
  variant_sku: string | null;
  variant_cost_price: number | null;
  quantity_on_hand: number;
  quantity_reserved: number;
  cost_per_unit: number | null;
}

export type RowPlan =
  | { action: 'process' }
  | { action: 'skip'; reason: SkipReason; detail: string };

export interface CliOptions {
  /** `false` = DRY-RUN. Es el default: sin `--execute` no se escribe nada. */
  execute: boolean;
  /** `--orgs=10,33`. `null` = todas las organizaciones. */
  orgs: number[] | null;
  /** `--limit=N` filas A CASTIGAR (las saltadas no consumen cupo). */
  limit: number | null;
  /** `--user-id=N`: autor y aprobador de los ajustes. `null` = sistema. */
  userId: number | null;
  /** Directorio del respaldo JSON. */
  backupDir: string;
  /** Cada cuántas filas procesadas se imprime el avance. */
  progressEvery: number;
  /** Cuánto se espera al asiento contable (el evento es asíncrono). */
  accountingTimeoutMs: number;
  /** Intervalo del sondeo del asiento. */
  accountingPollMs: number;
}

export const DEFAULT_CLI_OPTIONS: CliOptions = {
  execute: false,
  orgs: null,
  limit: null,
  userId: null,
  backupDir: 'scripts/backups',
  progressEvery: 25,
  accountingTimeoutMs: 15_000,
  accountingPollMs: 200,
};

/**
 * `reason_code` propio y distinguible. Existe para que una auditoría pueda
 * separar estas bajas de saneamiento de las que emite el flujo normal de
 * archivado (`product_archived`, desde `ProductsService.remove`).
 */
export const WRITE_OFF_REASON_CODE = 'product_archived_backfill';

/** `audit_logs.action` de cada fila castigada. */
export const AUDIT_ACTION = 'ARCHIVED_PRODUCT_STOCK_WRITE_OFF';

/** `source_type` del asiento contable que debería nacer de cada ajuste. */
export const ACCOUNTING_SOURCE_TYPE = 'inventory.adjusted';

function readNumberFlag(argv: string[], flag: string): number | null {
  const raw = argv.find((arg) => arg.startsWith(`${flag}=`))?.split('=')[1];
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function readStringFlag(argv: string[], flag: string): string | null {
  const raw = argv.find((arg) => arg.startsWith(`${flag}=`))?.split('=')[1];
  if (raw === undefined || raw.trim() === '') return null;
  return raw;
}

/**
 * Lee las banderas. LA OPCIÓN SEGURA ES LA QUE OCURRE POR DESCUIDO: sin
 * `--execute` el modo es DRY-RUN, y cualquier bandera mal escrita cae en el
 * default en vez de habilitar la escritura.
 */
export function parseArgs(argv: string[]): CliOptions {
  const orgsRaw = readStringFlag(argv, '--orgs');
  const orgs = orgsRaw
    ? orgsRaw
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((value) => Number.isInteger(value) && value > 0)
    : null;

  const limit = readNumberFlag(argv, '--limit');
  const userId = readNumberFlag(argv, '--user-id');
  const progressEvery = readNumberFlag(argv, '--progress-every');
  const accountingTimeoutMs = readNumberFlag(argv, '--accounting-timeout-ms');
  const accountingPollMs = readNumberFlag(argv, '--accounting-poll-ms');

  return {
    execute: argv.includes('--execute'),
    orgs: orgs && orgs.length > 0 ? orgs : null,
    limit: limit !== null && limit > 0 ? Math.floor(limit) : null,
    userId: userId !== null && userId > 0 ? Math.floor(userId) : null,
    backupDir:
      readStringFlag(argv, '--backup-dir') ?? DEFAULT_CLI_OPTIONS.backupDir,
    progressEvery:
      progressEvery !== null && progressEvery > 0
        ? Math.floor(progressEvery)
        : DEFAULT_CLI_OPTIONS.progressEvery,
    accountingTimeoutMs:
      accountingTimeoutMs !== null && accountingTimeoutMs >= 0
        ? Math.floor(accountingTimeoutMs)
        : DEFAULT_CLI_OPTIONS.accountingTimeoutMs,
    accountingPollMs:
      accountingPollMs !== null && accountingPollMs > 0
        ? Math.floor(accountingPollMs)
        : DEFAULT_CLI_OPTIONS.accountingPollMs,
  };
}

/**
 * Costo unitario por la CADENA CANÓNICA, la misma que usa
 * `ProductsService.buildArchiveWriteOffPlan`:
 * `stock_levels.cost_per_unit` → `product_variants.cost_price` →
 * `products.cost_price`.
 *
 * `||` y no `??` A PROPÓSITO: un 0 espurio debe caer al siguiente eslabón en
 * vez de fijar el costo en cero. El valor resultante es una ESTIMACIÓN para el
 * informe y el respaldo; el costo que se contabiliza lo decide
 * `CostingService.consumeCostLayers` dentro del ajuste (FIFO o CPP según la
 * configuración), y puede diferir.
 */
export function resolveUnitCost(row: PhantomStockRow): number {
  return (
    Number(row.cost_per_unit) ||
    Number(row.variant_cost_price) ||
    Number(row.product_cost_price) ||
    0
  );
}

/** Valor estimado de la fila (unidades × costo unitario canónico). */
export function estimateRowValue(row: PhantomStockRow): number {
  return row.quantity_on_hand * resolveUnitCost(row);
}

/**
 * Decide qué se hace con la fila. Todo lo que no sea `process` se salta, se
 * cuenta y se explica en el informe final — nunca se destruye en silencio.
 */
export function classifyRow(row: PhantomStockRow): RowPlan {
  if (row.quantity_on_hand <= 0) {
    return {
      action: 'skip',
      reason: 'already_zero',
      detail: 'La fila ya está en cero; no hay existencia que dar de baja.',
    };
  }

  if (row.quantity_reserved > 0) {
    return {
      action: 'skip',
      reason: 'reserved_stock',
      detail:
        `${row.quantity_reserved} unidad(es) están reservadas para un pedido vivo. ` +
        'Llevar esta fila a cero dejaría ese pedido sin mercancía con la que cumplirse. ' +
        'Libera o cumple la reserva y vuelve a correr el saneamiento.',
    };
  }

  if (row.organization_id == null) {
    return {
      action: 'skip',
      reason: 'unresolvable_context',
      detail:
        `La ubicación #${row.location_id} no resuelve organización; no hay contexto que forjar.`,
    };
  }

  if (row.location_store_id == null) {
    return {
      action: 'skip',
      reason: 'org_level_location',
      detail:
        `La existencia vive en «${row.location_name}» (#${row.location_id}), una ubicación de ` +
        'ORGANIZACIÓN sin tienda' +
        (row.is_central_warehouse ? ' (bodega central)' : '') +
        '. El servicio de ajustes de tienda no puede escribirla, y el archivado normal ' +
        'también la bloquea como existencia fuera de alcance. Requiere decisión aparte.',
    };
  }

  if (!row.product_track_inventory) {
    return {
      action: 'skip',
      reason: 'inventory_not_tracked',
      detail:
        `El producto #${row.product_id} tiene track_inventory = false: el gestor de stock ` +
        'saldría sin mover nada y dejaría una fila de ajuste mintiendo. ' +
        'Que además tenga existencia es un defecto aparte que este script no arregla.',
    };
  }

  if (row.product_store_id !== row.location_store_id) {
    return {
      action: 'skip',
      reason: 'store_mismatch',
      detail:
        `El producto pertenece a la tienda #${row.product_store_id ?? 'null'} pero la existencia ` +
        `está en una ubicación de la tienda #${row.location_store_id}. Con cualquiera de los dos ` +
        'contextos el ajuste no puede mover el stock; hace falta transferirla o corregir el dueño.',
    };
  }

  return { action: 'process' };
}

/** Resultado contable de una fila castigada. */
export type AccountingOutcome =
  /** Ajuste con costo cero: no se emite evento, no debe haber asiento. */
  | { status: 'not_applicable_zero_cost' }
  /** Asiento encontrado. */
  | { status: 'posted'; entry_id: number; entry_number: string }
  /** No hay asiento, pero el fallo/omisión quedó registrado. */
  | { status: 'failed_recorded'; failure_id: number; cause: string }
  /** Ni asiento ni registro de fallo: es un FALLO de la fila. */
  | { status: 'missing' };

export interface ProcessedRow {
  row: PhantomStockRow;
  adjustment_id: number;
  quantity_change: number;
  cost_amount: number;
  accounting: AccountingOutcome;
}

export interface FailedRow {
  row: PhantomStockRow;
  stage: 'transaction' | 'accounting_verification';
  message: string;
}

export interface SkippedRow {
  row: PhantomStockRow;
  reason: SkipReason;
  detail: string;
}

export interface RunSummary {
  scanned: number;
  processed: number;
  skipped: number;
  failed: number;
  units_written_off: number;
  value_written_off: number;
  accounting_posted: number;
  accounting_zero_cost: number;
  accounting_failed_recorded: number;
  accounting_missing: number;
  skipped_by_reason: Record<string, number>;
}

export function summarize(
  scanned: number,
  processed: ProcessedRow[],
  skipped: SkippedRow[],
  failed: FailedRow[],
): RunSummary {
  const skipped_by_reason: Record<string, number> = {};
  for (const entry of skipped) {
    skipped_by_reason[entry.reason] =
      (skipped_by_reason[entry.reason] ?? 0) + 1;
  }

  return {
    scanned,
    processed: processed.length,
    skipped: skipped.length,
    failed: failed.length,
    units_written_off: processed.reduce(
      (sum, entry) => sum + Math.abs(entry.quantity_change),
      0,
    ),
    value_written_off: processed.reduce(
      (sum, entry) => sum + Math.abs(entry.cost_amount),
      0,
    ),
    accounting_posted: processed.filter(
      (entry) => entry.accounting.status === 'posted',
    ).length,
    accounting_zero_cost: processed.filter(
      (entry) => entry.accounting.status === 'not_applicable_zero_cost',
    ).length,
    accounting_failed_recorded: processed.filter(
      (entry) => entry.accounting.status === 'failed_recorded',
    ).length,
    accounting_missing: processed.filter(
      (entry) => entry.accounting.status === 'missing',
    ).length,
    skipped_by_reason,
  };
}

/**
 * Una fila cuyo asiento no aparece NI COMO ASIENTO NI COMO FALLO REGISTRADO es
 * una fila fallida, aunque su stock sí se haya movido. El precedente de este
 * repositorio es explícito: 21 de 79 recepciones se quedaron sin asiento y
 * `accounting_entry_failures` tenía cero filas. El silencio no vuelve a contar
 * como éxito.
 */
export function accountingCountsAsFailure(outcome: AccountingOutcome): boolean {
  return outcome.status === 'missing';
}

export function formatMoney(value: number): string {
  return value.toLocaleString('es-CO', { maximumFractionDigits: 2 });
}

export function formatProgressLine(
  done: number,
  total: number,
  units: number,
  value: number,
): string {
  const pct = total > 0 ? Math.round((done / total) * 100) : 100;
  return (
    `  … ${done}/${total} filas (${pct}%) · ` +
    `${formatMoney(units)} unidades dadas de baja · ` +
    `${formatMoney(value)} COP acumulados`
  );
}

/** Nombre del respaldo, con marca de tiempo. */
export function backupFileName(startedAt: Date, execute: boolean): string {
  const stamp = startedAt
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('Z', 'Z');
  return `archived-stock-writeoff-${execute ? 'exec' : 'dryrun'}-${stamp}.json`;
}
