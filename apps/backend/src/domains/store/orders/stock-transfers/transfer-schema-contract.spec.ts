/**
 * Contrato schema ↔ migraciones ↔ guard de deploy para transferencias.
 *
 * Los specs de servicio mockean Prisma por completo, así que no ven dos fallos
 * que solo aparecen con la base real:
 * - una columna declarada en `schema.prisma` que ninguna migración crea
 *   (Prisma la nombra en cada SELECT/RETURNING y todo el módulo da 500);
 * - `to_location_id` obligatorio en el schema aunque la migración lo haga
 *   nullable (el cliente rechaza `to_location_id: null` y el destino externo
 *   nunca se crea).
 *
 * Todo se lee de archivos del repo y de los tipos del cliente generado: no
 * hace falta base de datos.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Prisma } from '@prisma/client';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const gate = require('../../../../../prisma/assert-schema-columns.js') as {
  REQUIRED_COLUMNS: string[];
  REQUIRED_ENUM_TYPES: string[];
  REQUIRED_ENUM_VALUES: Record<string, string[]>;
};

const BACKEND_DIR = path.resolve(__dirname, '../../../../..');
const SCHEMA_PATH = path.join(BACKEND_DIR, 'prisma/schema.prisma');
const MIGRATIONS_DIR = path.join(BACKEND_DIR, 'prisma/migrations');
const P2_MIGRATION = '20261215090000_transfer_transport_remision';

const PRISMA_SCALARS = new Set([
  'Int',
  'BigInt',
  'String',
  'Boolean',
  'DateTime',
  'Decimal',
  'Float',
  'Json',
  'Bytes',
]);

const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

function modelBlock(model: string): string {
  const match = schema.match(
    new RegExp(`\\nmodel ${model} \\{\\n([\\s\\S]*?)\\n\\}`),
  );
  if (!match) throw new Error(`No existe el modelo ${model} en el schema`);
  return match[1];
}

const enumNames = new Set(
  Array.from(schema.matchAll(/\nenum (\w+) \{/g)).map((m) => m[1]),
);

/** Columnas escalares (y enums) del modelo, con su `@map` si lo tiene. */
function schemaColumns(model: string): Map<string, string> {
  const columns = new Map<string, string>();
  for (const raw of modelBlock(model).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
    const [name, type = ''] = line.split(/\s+/);
    const baseType = type.replace(/[?[\]]/g, '');
    if (!PRISMA_SCALARS.has(baseType) && !enumNames.has(baseType)) continue;
    const mapped = line.match(/@map\("([^"]+)"\)/);
    columns.set(mapped ? mapped[1] : name, type);
  }
  return columns;
}

function readMigrations(): Array<{ name: string; sql: string }> {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((dir) =>
      fs.existsSync(path.join(MIGRATIONS_DIR, dir, 'migration.sql')),
    )
    .sort()
    .map((dir) => ({
      name: dir,
      sql: fs
        .readFileSync(path.join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8')
        .replace(/--[^\n]*/g, ''),
    }));
}

const migrations = readMigrations();

/** Columnas que las migraciones crean (CREATE TABLE, ADD COLUMN, RENAME). */
function migratedColumns(table: string): Set<string> {
  const tableRef = `(?:"public"\\.)?"${table}"`;
  const columns = new Set<string>();
  for (const { sql } of migrations) {
    const create = sql.match(
      new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${tableRef} \\(([\\s\\S]*?)\\n\\);`),
    );
    if (create) {
      for (const col of create[1].matchAll(/^\s*"(\w+)"\s/gm)) {
        columns.add(col[1]);
      }
    }
    for (const alter of sql.matchAll(
      new RegExp(`ALTER TABLE (?:IF EXISTS )?(?:ONLY )?${tableRef}([\\s\\S]*?);`, 'g'),
    )) {
      for (const col of alter[1].matchAll(
        /ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"(\w+)"/g,
      )) {
        columns.add(col[1]);
      }
      for (const col of alter[1].matchAll(
        /RENAME COLUMN\s+"\w+"\s+TO\s+"(\w+)"/g,
      )) {
        columns.add(col[1]);
      }
    }
  }
  return columns;
}

describe('transferencias: contrato schema ↔ migraciones ↔ guard de deploy', () => {
  it.each(['stock_transfers', 'stock_transfer_items'])(
    'toda columna de %s en el schema la crea alguna migración',
    (table) => {
      const created = migratedColumns(table);
      const missing = Array.from(schemaColumns(table).keys()).filter(
        (column) => !created.has(column),
      );
      expect(missing).toEqual([]);
    },
  );

  it('to_location_id es opcional en el schema y la migración P2 le quita el NOT NULL', () => {
    expect(schemaColumns('stock_transfers').get('to_location_id')).toBe(
      'Int?',
    );
    const p2 = migrations.find((m) => m.name === P2_MIGRATION);
    expect(p2?.sql).toMatch(
      /ALTER TABLE "stock_transfers" ALTER COLUMN "to_location_id" DROP NOT NULL/,
    );
  });

  it('el cliente generado acepta una transferencia a destino externo con to_location_id null', () => {
    // Chequeo de tipos: si el cliente se genera con `to_location_id Int`, este
    // archivo no compila y el spec falla antes de correr.
    const data = {
      organization_id: 1,
      transfer_number: 'TRF-20261215-0001',
      from_location_id: 10,
      to_location_id: null,
      is_external_destination: true,
      external_destination_name: 'Cliente mayorista',
    } satisfies Prisma.stock_transfersUncheckedCreateInput;

    expect(data.to_location_id).toBeNull();
  });

  it('el guard de deploy exige cada columna, enum y valor que agrega la migración P2', () => {
    const p2 = migrations.find((m) => m.name === P2_MIGRATION);
    expect(p2).toBeDefined();
    const sql = p2!.sql;

    const added: string[] = [];
    for (const alter of sql.matchAll(/ALTER TABLE "(\w+)"([\s\S]*?);/g)) {
      for (const col of alter[2].matchAll(
        /ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"(\w+)"/g,
      )) {
        added.push(`${alter[1]}.${col[1]}`);
      }
    }
    expect(added.length).toBeGreaterThan(0);
    expect(added.filter((c) => !gate.REQUIRED_COLUMNS.includes(c))).toEqual(
      [],
    );

    const types = Array.from(sql.matchAll(/CREATE TYPE "(\w+)"/g)).map(
      (m) => m[1],
    );
    expect(types.filter((t) => !gate.REQUIRED_ENUM_TYPES.includes(t))).toEqual(
      [],
    );

    for (const value of sql.matchAll(
      /ALTER TYPE "(\w+)" ADD VALUE IF NOT EXISTS '(\w+)'/g,
    )) {
      expect(gate.REQUIRED_ENUM_VALUES[value[1]]).toContain(value[2]);
    }
  });
});
