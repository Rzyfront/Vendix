import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Static contract of the "dónde se produce" migration: additive only (nullable
 * columns + FK ON DELETE SET NULL), re-runnable and without touching rows.
 */
const sql = readFileSync(
  resolve(
    __dirname,
    '../../../../prisma/migrations/20261217090000_product_production_site/migration.sql',
  ),
  'utf8',
);
const executable = sql.replace(/--[^\n]*/g, '');

describe('migration 20261217090000_product_production_site', () => {
  it('declares its data impact and never drops, truncates, deletes, updates or cascades', () => {
    expect(sql).toContain('-- DATA IMPACT:');
    expect(executable).not.toMatch(/^\s*(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/im);
    expect(executable).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|CONSTRAINT)\b/i);
    expect(executable).not.toMatch(/CASCADE/i);
  });

  it('only adds nullable columns, guarded with IF NOT EXISTS', () => {
    const adds = executable.match(/ADD COLUMN[^;]+;/g) ?? [];
    expect(adds).toHaveLength(3);
    for (const add of adds) {
      expect(add).toContain('IF NOT EXISTS');
      expect(add).not.toMatch(/NOT NULL|DEFAULT/i);
    }
    expect(executable).toContain('"products" ADD COLUMN IF NOT EXISTS "production_site" VARCHAR(20)');
    expect(executable).toContain('"products" ADD COLUMN IF NOT EXISTS "production_plant_id" INTEGER');
    expect(executable).toContain(
      '"production_orders" ADD COLUMN IF NOT EXISTS "production_site" VARCHAR(20)',
    );
  });

  it('the plant FK is guarded and sets NULL when a plant is deleted', () => {
    expect(executable).toContain("conname = 'products_production_plant_id_fkey'");
    expect(executable).toMatch(/REFERENCES "manufacturing_plants"\("id"\)\s+ON DELETE SET NULL/);
    for (const statement of executable.match(/CREATE\s+(?:UNIQUE\s+)?INDEX[^;]+;/g) ?? []) {
      expect(statement).toContain('IF NOT EXISTS');
    }
  });
});
