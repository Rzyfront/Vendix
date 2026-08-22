/**
 * Spec de la lógica pura de CP-PURCHASE-TRANSPARENCY D.5.
 *
 * Prueba las DECISIONES, que es lo que gobierna una operación irreversible: qué
 * bandera habilita la escritura, qué fila se castiga, cuál se salta y por qué,
 * cómo se valora y cómo se cuenta el desenlace contable.
 *
 * NO cubre la ejecución contra la base — eso se verificó a mano contra la base
 * local (ver `RUNBOOK-writeoff-archived-product-stock.md`).
 *
 * El `jest` del backend tiene `rootDir: "src"`, así que este spec NO entra en
 * `npm test`. Se corre explícitamente:
 *
 *   npx jest --rootDir=scripts --testRegex='.*\.spec\.ts$'
 */

import {
  DEFAULT_CLI_OPTIONS,
  PhantomStockRow,
  ProcessedRow,
  SkippedRow,
  accountingCountsAsFailure,
  backupFileName,
  classifyRow,
  estimateRowValue,
  parseArgs,
  resolveUnitCost,
  summarize,
} from './writeoff-archived-product-stock.logic';

function makeRow(overrides: Partial<PhantomStockRow> = {}): PhantomStockRow {
  return {
    stock_level_id: 1390,
    product_id: 378,
    product_variant_id: null,
    location_id: 50,
    location_name: 'Bodega Principal',
    location_store_id: 10,
    is_central_warehouse: false,
    organization_id: 6,
    organization_name: 'Org Demo',
    product_name: 'Cable QUI648 margen E2E',
    product_sku: 'SKU-378',
    product_store_id: 10,
    product_track_inventory: true,
    product_cost_price: 2,
    variant_sku: null,
    variant_cost_price: null,
    quantity_on_hand: 20000,
    quantity_reserved: 0,
    cost_per_unit: 3,
    ...overrides,
  };
}

function makeProcessed(
  overrides: Partial<ProcessedRow> = {},
): ProcessedRow {
  return {
    row: makeRow(),
    adjustment_id: 1,
    quantity_change: -20000,
    cost_amount: 60000,
    accounting: { status: 'posted', entry_id: 9, entry_number: 'AE-2026-000009' },
    ...overrides,
  };
}

describe('D.5 · parseArgs', () => {
  it('el DEFAULT es dry-run: sin banderas no escribe nada', () => {
    expect(parseArgs([]).execute).toBe(false);
  });

  it('sólo `--execute` habilita la escritura', () => {
    expect(parseArgs(['--execute']).execute).toBe(true);
  });

  it('una bandera mal escrita NO habilita la escritura', () => {
    // El fallo por descuido tiene que caer del lado seguro.
    for (const typo of ['--exec', '--execute=true', '-execute', '--run', '--force']) {
      expect(parseArgs([typo]).execute).toBe(false);
    }
  });

  it('acota por organización con --orgs=10,33', () => {
    expect(parseArgs(['--orgs=10,33']).orgs).toEqual([10, 33]);
    expect(parseArgs(['--orgs= 10 , 33 ']).orgs).toEqual([10, 33]);
  });

  it('sin --orgs recorre TODAS las organizaciones', () => {
    expect(parseArgs([]).orgs).toBeNull();
  });

  it('descarta identificadores de organización basura en vez de inventarlos', () => {
    expect(parseArgs(['--orgs=abc,0,-4']).orgs).toBeNull();
    expect(parseArgs(['--orgs=10,abc']).orgs).toEqual([10]);
  });

  it('--limit sólo acepta enteros positivos', () => {
    expect(parseArgs(['--limit=50']).limit).toBe(50);
    expect(parseArgs(['--limit=0']).limit).toBeNull();
    expect(parseArgs(['--limit=-3']).limit).toBeNull();
    expect(parseArgs(['--limit=abc']).limit).toBeNull();
    expect(parseArgs(['--limit=12.9']).limit).toBe(12);
  });

  it('--user-id viaja al ajuste; sin ella el autor es el sistema', () => {
    expect(parseArgs(['--user-id=7']).userId).toBe(7);
    expect(parseArgs([]).userId).toBeNull();
  });

  it('mantiene los defaults del resto de banderas', () => {
    const options = parseArgs([]);
    expect(options.backupDir).toBe(DEFAULT_CLI_OPTIONS.backupDir);
    expect(options.progressEvery).toBe(DEFAULT_CLI_OPTIONS.progressEvery);
    expect(options.accountingTimeoutMs).toBe(
      DEFAULT_CLI_OPTIONS.accountingTimeoutMs,
    );
  });

  it('permite mover el directorio del respaldo y el ritmo del avance', () => {
    const options = parseArgs([
      '--backup-dir=/tmp/d5',
      '--progress-every=5',
      '--accounting-timeout-ms=30000',
    ]);
    expect(options.backupDir).toBe('/tmp/d5');
    expect(options.progressEvery).toBe(5);
    expect(options.accountingTimeoutMs).toBe(30000);
  });
});

describe('D.5 · classifyRow', () => {
  it('castiga la fila fantasma sana', () => {
    expect(classifyRow(makeRow())).toEqual({ action: 'process' });
  });

  it('NUNCA toca existencia reservada, y lo dice', () => {
    const plan = classifyRow(makeRow({ quantity_reserved: 3 }));
    expect(plan.action).toBe('skip');
    if (plan.action !== 'skip') throw new Error('unreachable');
    expect(plan.reason).toBe('reserved_stock');
    expect(plan.detail).toMatch(/pedido vivo/);
  });

  it('la reserva pesa MÁS que cualquier otro defecto de la fila', () => {
    // Una fila reservada Y con dueño equivocado se reporta como reservada: es
    // la advertencia que el operador necesita ver.
    const plan = classifyRow(
      makeRow({ quantity_reserved: 8, product_store_id: 99 }),
    );
    if (plan.action !== 'skip') throw new Error('unreachable');
    expect(plan.reason).toBe('reserved_stock');
  });

  it('salta la fila que ya está en cero (idempotencia)', () => {
    const plan = classifyRow(makeRow({ quantity_on_hand: 0 }));
    if (plan.action !== 'skip') throw new Error('unreachable');
    expect(plan.reason).toBe('already_zero');
  });

  it('salta la bodega de organización en vez de destruirla', () => {
    const plan = classifyRow(
      makeRow({ location_store_id: null, is_central_warehouse: true }),
    );
    if (plan.action !== 'skip') throw new Error('unreachable');
    expect(plan.reason).toBe('org_level_location');
    expect(plan.detail).toMatch(/bodega central/);
  });

  it('salta el producto que no lleva inventario (updateStock sería un NO-OP mudo)', () => {
    const plan = classifyRow(makeRow({ product_track_inventory: false }));
    if (plan.action !== 'skip') throw new Error('unreachable');
    expect(plan.reason).toBe('inventory_not_tracked');
  });

  it('salta cuando el producto y la ubicación son de tiendas distintas', () => {
    const plan = classifyRow(
      makeRow({ product_store_id: 11, location_store_id: 10 }),
    );
    if (plan.action !== 'skip') throw new Error('unreachable');
    expect(plan.reason).toBe('store_mismatch');
  });

  it('salta cuando no hay organización que resolver', () => {
    const plan = classifyRow(makeRow({ organization_id: null }));
    if (plan.action !== 'skip') throw new Error('unreachable');
    expect(plan.reason).toBe('unresolvable_context');
  });
});

describe('D.5 · valoración', () => {
  it('usa cost_per_unit cuando existe', () => {
    expect(resolveUnitCost(makeRow({ cost_per_unit: 3 }))).toBe(3);
  });

  it('un 0 espurio CAE al siguiente eslabón en vez de fijar el costo en cero', () => {
    expect(
      resolveUnitCost(
        makeRow({ cost_per_unit: 0, variant_cost_price: 0, product_cost_price: 7 }),
      ),
    ).toBe(7);
  });

  it('prefiere el costo de la variante sobre el del producto', () => {
    expect(
      resolveUnitCost(
        makeRow({ cost_per_unit: null, variant_cost_price: 909.0909, product_cost_price: 5 }),
      ),
    ).toBeCloseTo(909.0909, 4);
  });

  it('agotada la cadena, el costo es CERO — que significa desconocido', () => {
    expect(
      resolveUnitCost(
        makeRow({ cost_per_unit: null, variant_cost_price: null, product_cost_price: null }),
      ),
    ).toBe(0);
  });

  it('el valor de la fila son unidades × costo canónico', () => {
    expect(estimateRowValue(makeRow({ quantity_on_hand: 100, cost_per_unit: 3 }))).toBe(300);
  });
});

describe('D.5 · resumen del lote', () => {
  const skipped: SkippedRow[] = [
    { row: makeRow(), reason: 'reserved_stock', detail: 'x' },
    { row: makeRow(), reason: 'reserved_stock', detail: 'x' },
    { row: makeRow(), reason: 'org_level_location', detail: 'x' },
  ];

  it('cuenta procesadas, saltadas y fallidas por separado', () => {
    const summary = summarize(
      10,
      [makeProcessed(), makeProcessed({ adjustment_id: 2 })],
      skipped,
      [{ row: makeRow(), stage: 'transaction', message: 'boom' }],
    );
    expect(summary.scanned).toBe(10);
    expect(summary.processed).toBe(2);
    expect(summary.skipped).toBe(3);
    expect(summary.failed).toBe(1);
    expect(summary.skipped_by_reason).toEqual({
      reserved_stock: 2,
      org_level_location: 1,
    });
  });

  it('suma unidades y valor en valor absoluto (el cambio es negativo)', () => {
    const summary = summarize(
      2,
      [
        makeProcessed({ quantity_change: -20000, cost_amount: 60000 }),
        makeProcessed({ adjustment_id: 2, quantity_change: -100, cost_amount: 1000 }),
      ],
      [],
      [],
    );
    expect(summary.units_written_off).toBe(20100);
    expect(summary.value_written_off).toBe(61000);
  });

  it('separa los cuatro desenlaces contables', () => {
    const summary = summarize(
      4,
      [
        makeProcessed({ accounting: { status: 'posted', entry_id: 1, entry_number: 'AE-1' } }),
        makeProcessed({ adjustment_id: 2, accounting: { status: 'not_applicable_zero_cost' } }),
        makeProcessed({
          adjustment_id: 3,
          accounting: { status: 'failed_recorded', failure_id: 5, cause: 'FISCAL_PERIOD_CLOSED' },
        }),
        makeProcessed({ adjustment_id: 4, accounting: { status: 'missing' } }),
      ],
      [],
      [],
    );
    expect(summary.accounting_posted).toBe(1);
    expect(summary.accounting_zero_cost).toBe(1);
    expect(summary.accounting_failed_recorded).toBe(1);
    expect(summary.accounting_missing).toBe(1);
  });
});

describe('D.5 · el asiento no puede fallar en silencio', () => {
  it('un asiento ausente SIN registro es un fallo de la fila', () => {
    expect(accountingCountsAsFailure({ status: 'missing' })).toBe(true);
  });

  it('un fallo REGISTRADO no es silencio: no cuenta como fila fallida', () => {
    expect(
      accountingCountsAsFailure({
        status: 'failed_recorded',
        failure_id: 1,
        cause: 'FISCAL_PERIOD_CLOSED',
      }),
    ).toBe(false);
  });

  it('costo cero no debe producir asiento y tampoco es un fallo', () => {
    expect(accountingCountsAsFailure({ status: 'not_applicable_zero_cost' })).toBe(false);
    expect(
      accountingCountsAsFailure({ status: 'posted', entry_id: 1, entry_number: 'AE-1' }),
    ).toBe(false);
  });
});

describe('D.5 · respaldo', () => {
  it('el nombre lleva marca de tiempo y distingue dry-run de ejecución', () => {
    const at = new Date('2026-08-22T15:04:05.678Z');
    expect(backupFileName(at, false)).toBe(
      'archived-stock-writeoff-dryrun-2026-08-22T15-04-05-678Z.json',
    );
    expect(backupFileName(at, true)).toBe(
      'archived-stock-writeoff-exec-2026-08-22T15-04-05-678Z.json',
    );
  });

  it('dos corridas distintas NO comparten fichero', () => {
    const a = backupFileName(new Date('2026-08-22T15:04:05.678Z'), true);
    const b = backupFileName(new Date('2026-08-22T15:04:06.678Z'), true);
    expect(a).not.toBe(b);
  });
});
