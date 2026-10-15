import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('holder change additive persistence contract', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../../../../prisma/migrations/20261015060000_cf_invoice_holder_change/migration.sql',
    ),
    'utf8',
  );
  it('has data impact and zero historical data rewrite or destructive SQL', () => {
    expect(sql).toContain('-- DATA IMPACT:');
    const statements = sql.replace(/--[^\n]*/g, '');
    expect(statements).not.toMatch(
      /\b(DELETE\s+FROM|TRUNCATE|DROP\s+(TABLE|COLUMN)|UPDATE\s+"?(orders|invoice_data_requests)"?\s+SET)\b/i,
    );
  });
  it('contains nullable compatibility columns and purpose-specific unique reservations', () => {
    expect(sql).toContain('"public_access_token" VARCHAR(64)');
    expect(sql).toContain('"active_invoice_key" VARCHAR(100)');
    for (const field of [
      'original_invoice_id',
      'active_order_key',
      'credit_note_id',
      'new_invoice_id',
    ])
      expect(sql).toContain(`"invoice_holder_changes_${field}_key"`);
    expect(sql).toContain('"operation_id","role"');
    expect(sql).toContain('"source_credit_note_id"');
  });
  it('guards all foreign keys and never introduces cascading business deletion', () => {
    expect(sql.replace(/--[^\n]*/g, '')).not.toMatch(/ON DELETE CASCADE/i);
    expect(sql).toContain('pg_constraint');
    const names = [...sql.matchAll(/CONSTRAINT "([^"]+)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(15);
    for (const name of names) {
      expect(name.length).toBeLessThanOrEqual(63);
      expect(sql).toContain(`conname = '${name}'`);
    }
  });
});
