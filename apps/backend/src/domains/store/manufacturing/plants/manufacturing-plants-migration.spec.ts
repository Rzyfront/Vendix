import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * QUI-1013 — static contract of the plants migration. Its runtime behavior
 * (first run inserts one plant per configured store and moves its
 * manufacturing orders, second run touches 0 rows) was checked on a copy of
 * the database inside BEGIN/ROLLBACK; this spec keeps the SQL from drifting
 * into something that cannot be re-run or that destroys data.
 */
const sql = readFileSync(
  resolve(
    __dirname,
    '../../../../../prisma/migrations/20261208090000_manufacturing_plants/migration.sql',
  ),
  'utf8',
);
const executable = sql.replace(/--[^\n]*/g, '');

describe('migration 20261208090000_manufacturing_plants', () => {
  it('declares its data impact and never drops, truncates, deletes or cascades', () => {
    expect(sql).toContain('-- DATA IMPACT:');
    expect(executable).not.toMatch(/^\s*(?:DROP|TRUNCATE|DELETE)\b/im);
    expect(executable).not.toMatch(/CASCADE/i);
  });

  it('is re-runnable: guarded table, column, indexes and named constraints', () => {
    expect(executable).toContain('CREATE TABLE IF NOT EXISTS "manufacturing_plants"');
    expect(executable).toContain('ADD COLUMN IF NOT EXISTS "plant_id" INTEGER;');
    for (const statement of executable.match(/CREATE\s+(?:UNIQUE\s+)?INDEX[^;]+;/g) ?? []) {
      expect(statement).toContain('IF NOT EXISTS');
    }
    const constraints = [...executable.matchAll(/ADD CONSTRAINT "([^"]+)"/g)].map((m) => m[1]);
    expect(constraints).toHaveLength(5);
    for (const name of constraints) {
      expect(executable).toContain(`conname = '${name}'`);
    }
  });

  it('keeps plant_id nullable (restaurant orders and stores without plants)', () => {
    expect(executable).not.toMatch(/plant_id"?\s+INTEGER\s+NOT NULL/i);
  });

  it('the backfill only inserts plants for stores without one, and only fills empty plant_id of manufacturing orders', () => {
    const insert = executable.match(/INSERT INTO "manufacturing_plants"[^;]+;/)?.[0] ?? '';
    expect(insert).toContain('FROM "manufacturing_settings" ms');
    expect(insert).toMatch(/WHERE NOT EXISTS \(\s*SELECT 1 FROM "manufacturing_plants" p WHERE p\."store_id" = ms\."store_id"/);

    const updates = executable.match(/UPDATE "production_orders"[^;]+;/g) ?? [];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain('po."plant_id" IS NULL');
    expect(updates[0]).toContain('po."order_number" IS NOT NULL');
    expect(updates[0]).toContain('po."store_id" = first_plant."store_id"');
  });

  it('plants are never deleted from under their orders and a deleted user only clears the manager', () => {
    expect(executable).toMatch(/production_orders_plant_id_fkey"\s+FOREIGN KEY \("plant_id"\) REFERENCES "manufacturing_plants"\("id"\) ON DELETE RESTRICT/);
    expect(executable).toMatch(/manufacturing_plants_manager_user_id_fkey"\s+FOREIGN KEY \("manager_user_id"\) REFERENCES "users"\("id"\) ON DELETE SET NULL/);
  });
});
