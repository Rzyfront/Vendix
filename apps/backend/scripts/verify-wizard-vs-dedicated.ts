/* eslint-disable no-console */
/**
 * verify-wizard-vs-dedicated.ts
 *
 * Compara semánticamente la activación fiscal/contable de dos tiendas:
 *   - Tienda A: activada vía el wizard de onboarding fiscal.
 *   - Tienda B: activada manualmente entrando a cada pantalla dedicada
 *     (DIAN config, Chart of Accounts, Fiscal periods, Tax categories,
 *      Tax rates, Account mappings, Settings.fiscal_data, Settings.payroll).
 *
 * El objetivo es validar que el wizard produce EXACTAMENTE el mismo estado
 * persistido que el flujo dedicado equivalente. Si hay 0 diferencias
 * semánticas, ambos caminos son intercambiables.
 *
 * ---------------------------------------------------------------------------
 * Uso:
 *   npx ts-node apps/backend/scripts/verify-wizard-vs-dedicated.ts <storeA> <storeB>
 *
 * - <storeA>: store_id de la tienda creada vía wizard.
 * - <storeB>: store_id de la tienda creada vía pantallas dedicadas.
 *
 * Exit codes:
 *   0 → 0 diferencias semánticas (wizard == dedicado).
 *   1 → ≥1 diferencia. Se imprime tabla con columna, valor A y valor B.
 *   2 → argumentos inválidos.
 *   3 → error en runtime / DB.
 *
 * ---------------------------------------------------------------------------
 * Cómo crear las dos tiendas semilla (resumen):
 *
 *   Tienda A (wizard):
 *     1. Crear nueva organización + tienda en onboarding.
 *     2. Completar el wizard fiscal end-to-end con un set fijo de inputs
 *        (NIT, software_id, plan de cuentas base, periodos fiscales,
 *         categorías de impuesto IVA 19% / IVA 5% / Exento, account_mappings
 *         estándar, settings.fiscal_data y settings.payroll).
 *
 *   Tienda B (pantallas dedicadas):
 *     1. Crear nueva organización + tienda SIN tocar el wizard.
 *     2. Ir a DIAN Config dedicada → cargar el MISMO NIT/software/etc.
 *     3. Ir a Chart of Accounts dedicado → importar el MISMO PUC base.
 *     4. Ir a Fiscal Periods dedicado → crear los MISMOS periodos.
 *     5. Ir a Tax Categories + Tax Rates dedicado → cargar las MISMAS tasas.
 *     6. Ir a Account Mappings dedicado → mapear las MISMAS mapping_keys.
 *     7. Ir a Settings → fiscal_data + payroll con los MISMOS valores.
 *
 *   Ambas tiendas DEBEN compartir tax/PUC/inputs idénticos para que el
 *   resultado tenga sentido.
 *
 * ---------------------------------------------------------------------------
 * Notas de scope:
 *
 *   Este script usa PrismaClient directo (NO los servicios scoped del backend
 *   como OrganizationPrismaService / StorePrismaService). Eso es equivalente
 *   a `withoutScope()`: el filtrado lo hacemos manualmente con
 *   `where: { store_id: { in: [A, B] } }` u `organization_id`.
 *
 *   Esto se hace a propósito: queremos auditar lo que realmente quedó
 *   persistido, sin que ningún interceptor de tenant context oculte filas.
 *   Esto está alineado con vendix-prisma-scopes (uso justificado de
 *   withoutScope para auditoría administrativa) y con vendix-multi-tenant-context
 *   (los IDs de scope los recibimos explícitamente vía argv, no vía AsyncLocalStorage).
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface Diff {
  table: string;
  rowKey: string;
  column: string;
  valueA: unknown;
  valueB: unknown;
}

type NormalizedRow = Record<string, unknown>;

// Campos no semánticos: difieren entre tiendas aunque el flujo sea equivalente.
const NORMALIZE_DROP: ReadonlyArray<string> = [
  'id',
  'created_at',
  'updated_at',
  'started_at',
  'completed_at',
  'organization_id',
  'store_id',
  'accounting_entity_id',
  'tax_category_id', // FK que cambia entre tiendas, comparamos por nombre
  'parent_id',       // FK interna del COA, comparamos por code/name
  'account_id',      // FK del mapping → comparamos por code de la cuenta
  'closed_by_user_id',
  'manager_user_id',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

function normalizeValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  // Prisma Decimal → toString()
  if (typeof v === 'object' && v !== null && typeof (v as { toString?: () => string }).toString === 'function') {
    // Solo si parece un Decimal (tiene s/e/d o método toFixed)
    const anyV = v as { d?: unknown; e?: unknown; s?: unknown; toFixed?: unknown };
    if (anyV.d !== undefined && anyV.e !== undefined && anyV.s !== undefined) {
      return (v as { toString: () => string }).toString();
    }
  }
  if (Array.isArray(v)) {
    return v.map(normalizeValue);
  }
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      out[k] = normalizeValue(v[k]);
    }
    return out;
  }
  return v;
}

function normalize(row: Record<string, unknown>, extraDrop: ReadonlyArray<string> = []): NormalizedRow {
  const drop = new Set<string>([...NORMALIZE_DROP, ...extraDrop]);
  const out: NormalizedRow = {};
  for (const k of Object.keys(row).sort()) {
    if (drop.has(k)) continue;
    out[k] = normalizeValue(row[k]);
  }
  return out;
}

function rowKeyOf(row: Record<string, unknown>, keys: ReadonlyArray<string>): string {
  return keys.map(k => `${k}=${String(row[k] ?? '∅')}`).join('|');
}

function diffRows(
  table: string,
  rowsA: ReadonlyArray<Record<string, unknown>>,
  rowsB: ReadonlyArray<Record<string, unknown>>,
  keyCols: ReadonlyArray<string>,
  extraDrop: ReadonlyArray<string> = [],
): Diff[] {
  const diffs: Diff[] = [];

  const mapA = new Map<string, Record<string, unknown>>();
  const mapB = new Map<string, Record<string, unknown>>();
  for (const r of rowsA) mapA.set(rowKeyOf(r, keyCols), r);
  for (const r of rowsB) mapB.set(rowKeyOf(r, keyCols), r);

  const allKeys = new Set<string>([...mapA.keys(), ...mapB.keys()]);

  for (const key of allKeys) {
    const a = mapA.get(key);
    const b = mapB.get(key);
    if (!a) {
      diffs.push({ table, rowKey: key, column: '<row>', valueA: '<missing>', valueB: '<present>' });
      continue;
    }
    if (!b) {
      diffs.push({ table, rowKey: key, column: '<row>', valueA: '<present>', valueB: '<missing>' });
      continue;
    }
    const nA = normalize(a, extraDrop);
    const nB = normalize(b, extraDrop);
    const cols = new Set<string>([...Object.keys(nA), ...Object.keys(nB)]);
    for (const col of cols) {
      const vA = nA[col];
      const vB = nB[col];
      if (JSON.stringify(vA) !== JSON.stringify(vB)) {
        diffs.push({ table, rowKey: key, column: col, valueA: vA, valueB: vB });
      }
    }
  }

  return diffs;
}

function deepGet(obj: unknown, path: ReadonlyArray<string>): unknown {
  let cur: unknown = obj;
  for (const p of path) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Extractores por tabla
// ---------------------------------------------------------------------------

async function loadOrgIds(storeA: number, storeB: number): Promise<{ orgA: number; orgB: number }> {
  const rows = await prisma.stores.findMany({
    where: { id: { in: [storeA, storeB] } },
    select: { id: true, organization_id: true },
  });
  const a = rows.find(r => r.id === storeA);
  const b = rows.find(r => r.id === storeB);
  if (!a) throw new Error(`store ${storeA} no existe`);
  if (!b) throw new Error(`store ${storeB} no existe`);
  return { orgA: a.organization_id, orgB: b.organization_id };
}

async function diffDianConfigs(storeA: number, storeB: number): Promise<Diff[]> {
  const rowsA = await prisma.dian_configurations.findMany({
    where: { store_id: storeA },
    orderBy: { nit: 'asc' },
  });
  const rowsB = await prisma.dian_configurations.findMany({
    where: { store_id: storeB },
    orderBy: { nit: 'asc' },
  });
  return diffRows(
    'dian_configurations',
    rowsA as unknown as Record<string, unknown>[],
    rowsB as unknown as Record<string, unknown>[],
    ['nit', 'configuration_type'],
    // certs son blobs/keys que difieren — comparar solo metadata
    ['certificate_s3_key', 'certificate_password_encrypted', 'software_pin_encrypted', 'last_test_result', 'test_set_id'],
  );
}

async function diffChartOfAccounts(orgA: number, orgB: number): Promise<Diff[]> {
  const rowsA = await prisma.chart_of_accounts.findMany({
    where: { organization_id: orgA },
    orderBy: { code: 'asc' },
  });
  const rowsB = await prisma.chart_of_accounts.findMany({
    where: { organization_id: orgB },
    orderBy: { code: 'asc' },
  });
  return diffRows(
    'chart_of_accounts',
    rowsA as unknown as Record<string, unknown>[],
    rowsB as unknown as Record<string, unknown>[],
    ['code'],
  );
}

async function diffFiscalPeriods(orgA: number, orgB: number): Promise<Diff[]> {
  const rowsA = await prisma.fiscal_periods.findMany({
    where: { organization_id: orgA },
    orderBy: [{ name: 'asc' }],
  });
  const rowsB = await prisma.fiscal_periods.findMany({
    where: { organization_id: orgB },
    orderBy: [{ name: 'asc' }],
  });
  return diffRows(
    'fiscal_periods',
    rowsA as unknown as Record<string, unknown>[],
    rowsB as unknown as Record<string, unknown>[],
    ['name'],
  );
}

async function diffTaxCategories(
  storeA: number,
  storeB: number,
  orgA: number,
  orgB: number,
): Promise<Diff[]> {
  // Una tienda puede tener tax_categories scoped por store_id (STORE) o
  // por organization_id (ORG). Cargamos ambas posibilidades y unimos por name.
  const rowsA = await prisma.tax_categories.findMany({
    where: { OR: [{ store_id: storeA }, { organization_id: orgA }] },
    orderBy: { name: 'asc' },
  });
  const rowsB = await prisma.tax_categories.findMany({
    where: { OR: [{ store_id: storeB }, { organization_id: orgB }] },
    orderBy: { name: 'asc' },
  });
  return diffRows(
    'tax_categories',
    rowsA as unknown as Record<string, unknown>[],
    rowsB as unknown as Record<string, unknown>[],
    ['name'],
  );
}

async function diffTaxRates(
  storeA: number,
  storeB: number,
  orgA: number,
  orgB: number,
): Promise<Diff[]> {
  // tax_rates no tiene organization_id directo: hay que ir vía tax_category.
  const rowsA = await prisma.tax_rates.findMany({
    where: {
      OR: [
        { store_id: storeA },
        { tax_categories: { OR: [{ store_id: storeA }, { organization_id: orgA }] } },
      ],
    },
    include: { tax_categories: { select: { name: true } } },
    orderBy: [{ name: 'asc' }],
  });
  const rowsB = await prisma.tax_rates.findMany({
    where: {
      OR: [
        { store_id: storeB },
        { tax_categories: { OR: [{ store_id: storeB }, { organization_id: orgB }] } },
      ],
    },
    include: { tax_categories: { select: { name: true } } },
    orderBy: [{ name: 'asc' }],
  });

  // Aplanar el nombre de la categoría para comparar por categoría + nombre.
  const flattenA = rowsA.map(r => ({
    ...r,
    tax_category_name: r.tax_categories?.name ?? null,
    tax_categories: undefined,
  }));
  const flattenB = rowsB.map(r => ({
    ...r,
    tax_category_name: r.tax_categories?.name ?? null,
    tax_categories: undefined,
  }));

  return diffRows(
    'tax_rates',
    flattenA as unknown as Record<string, unknown>[],
    flattenB as unknown as Record<string, unknown>[],
    ['tax_category_name', 'name'],
  );
}

async function diffAccountMappings(
  storeA: number,
  storeB: number,
  orgA: number,
  orgB: number,
): Promise<Diff[]> {
  // mapping_key + account.code es la identidad semántica.
  const rowsA = await prisma.accounting_account_mappings.findMany({
    where: {
      OR: [
        { store_id: storeA },
        { AND: [{ store_id: null }, { organization_id: orgA }] },
      ],
    },
    include: { account: { select: { code: true } } },
    orderBy: [{ mapping_key: 'asc' }],
  });
  const rowsB = await prisma.accounting_account_mappings.findMany({
    where: {
      OR: [
        { store_id: storeB },
        { AND: [{ store_id: null }, { organization_id: orgB }] },
      ],
    },
    include: { account: { select: { code: true } } },
    orderBy: [{ mapping_key: 'asc' }],
  });

  const flattenA = rowsA.map(r => ({
    ...r,
    account_code: r.account?.code ?? null,
    account: undefined,
  }));
  const flattenB = rowsB.map(r => ({
    ...r,
    account_code: r.account?.code ?? null,
    account: undefined,
  }));

  return diffRows(
    'accounting_account_mappings',
    flattenA as unknown as Record<string, unknown>[],
    flattenB as unknown as Record<string, unknown>[],
    ['mapping_key'],
  );
}

async function diffStoreSettings(storeA: number, storeB: number): Promise<Diff[]> {
  const a = await prisma.store_settings.findUnique({ where: { store_id: storeA } });
  const b = await prisma.store_settings.findUnique({ where: { store_id: storeB } });

  const settingsA = (a?.settings ?? {}) as Record<string, unknown>;
  const settingsB = (b?.settings ?? {}) as Record<string, unknown>;

  const diffs: Diff[] = [];

  // 1) fiscal_data: comparación profunda completa.
  const fiscalA = normalizeValue(deepGet(settingsA, ['fiscal_data']));
  const fiscalB = normalizeValue(deepGet(settingsB, ['fiscal_data']));
  if (JSON.stringify(fiscalA) !== JSON.stringify(fiscalB)) {
    diffs.push({
      table: 'store_settings.settings.fiscal_data',
      rowKey: `store_id=${storeA}↔${storeB}`,
      column: 'fiscal_data',
      valueA: fiscalA,
      valueB: fiscalB,
    });
  }

  // 2) payroll: comparación profunda completa.
  const payrollA = normalizeValue(deepGet(settingsA, ['payroll']));
  const payrollB = normalizeValue(deepGet(settingsB, ['payroll']));
  if (JSON.stringify(payrollA) !== JSON.stringify(payrollB)) {
    diffs.push({
      table: 'store_settings.settings.payroll',
      rowKey: `store_id=${storeA}↔${storeB}`,
      column: 'payroll',
      valueA: payrollA,
      valueB: payrollB,
    });
  }

  // 3) fiscal_status: solo `state` y `completed_steps` por área (NO timestamps ni IDs).
  const fsA = (deepGet(settingsA, ['fiscal_status']) ?? {}) as Record<string, unknown>;
  const fsB = (deepGet(settingsB, ['fiscal_status']) ?? {}) as Record<string, unknown>;
  const areas = new Set<string>([...Object.keys(fsA), ...Object.keys(fsB)]);
  for (const area of areas) {
    const areaA = (fsA[area] ?? {}) as Record<string, unknown>;
    const areaB = (fsB[area] ?? {}) as Record<string, unknown>;

    const stateA = areaA.state ?? null;
    const stateB = areaB.state ?? null;
    if (JSON.stringify(stateA) !== JSON.stringify(stateB)) {
      diffs.push({
        table: 'store_settings.settings.fiscal_status',
        rowKey: `area=${area}`,
        column: 'state',
        valueA: stateA,
        valueB: stateB,
      });
    }

    const stepsA = normalizeValue(areaA.completed_steps);
    const stepsB = normalizeValue(areaB.completed_steps);
    if (JSON.stringify(stepsA) !== JSON.stringify(stepsB)) {
      diffs.push({
        table: 'store_settings.settings.fiscal_status',
        rowKey: `area=${area}`,
        column: 'completed_steps',
        valueA: stepsA,
        valueB: stepsB,
      });
    }
  }

  return diffs;
}

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------

function truncate(v: unknown, max = 80): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined || s === null) return String(s);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function printDiffs(diffs: ReadonlyArray<Diff>): void {
  const rows = diffs.map(d => ({
    table: d.table,
    row: truncate(d.rowKey, 40),
    column: d.column,
    valueA: truncate(d.valueA, 60),
    valueB: truncate(d.valueB, 60),
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.table(rows as any);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2).map(Number);
  const storeA = argv[0];
  const storeB = argv[1];
  if (!storeA || !storeB || Number.isNaN(storeA) || Number.isNaN(storeB)) {
    console.error('usage: ts-node verify-wizard-vs-dedicated.ts <storeA> <storeB>');
    process.exit(2);
    return;
  }
  if (storeA === storeB) {
    console.error('storeA y storeB deben ser distintos');
    process.exit(2);
    return;
  }

  const { orgA, orgB } = await loadOrgIds(storeA, storeB);

  const allDiffs: Diff[] = [];
  allDiffs.push(...(await diffDianConfigs(storeA, storeB)));
  allDiffs.push(...(await diffChartOfAccounts(orgA, orgB)));
  allDiffs.push(...(await diffFiscalPeriods(orgA, orgB)));
  allDiffs.push(...(await diffTaxCategories(storeA, storeB, orgA, orgB)));
  allDiffs.push(...(await diffTaxRates(storeA, storeB, orgA, orgB)));
  allDiffs.push(...(await diffAccountMappings(storeA, storeB, orgA, orgB)));
  allDiffs.push(...(await diffStoreSettings(storeA, storeB)));

  if (allDiffs.length === 0) {
    console.log('✓ Wizard equivalente a pantallas dedicadas');
    process.exit(0);
    return;
  }

  console.log(`✗ Se detectaron ${allDiffs.length} diferencias semánticas:`);
  printDiffs(allDiffs);
  process.exit(1);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(3);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
