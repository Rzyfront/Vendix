import { readFileSync } from 'fs';
import { join } from 'path';

import { DEFAULT_ACCOUNT_MAPPINGS } from '../../../domains/store/accounting/account-mappings/account-mapping.service';
import { getColombiaPucAccounts, PucAccountInput } from './colombia-puc.data';

/**
 * QUI-565: payroll mappings for the operational/sales cost centers rendered an
 * empty account selector because their default PUC codes did not exist in
 * charts seeded with the original template. These specs pin both halves of
 * the fix: new charts contain every default code, and the backfill migration
 * creates exactly the PUC accounts the payroll cost-center defaults need.
 */
const MIGRATION_PATH = join(
  __dirname,
  '../../../../prisma/migrations/20261201090000_seed_puc_payroll_cost_center_accounts/migration.sql',
);

interface MigrationAccount {
  code: string;
  name: string;
  parent_code: string | null;
  level: number;
  accepts_entries: boolean;
}

function parseMigrationAccounts(sql: string): MigrationAccount[] {
  const accounts: MigrationAccount[] = [];
  const root = sql.match(
    /SELECT anchor\.organization_id, anchor\.accounting_entity_id, '(\d+)',\s*'([^']+)'[\s\S]*?NULL, (\d), TRUE, (TRUE|FALSE)/,
  );
  if (root) {
    accounts.push({
      code: root[1],
      name: root[2],
      parent_code: null,
      level: Number(root[3]),
      accepts_entries: root[4] === 'TRUE',
    });
  }
  const tuple = /\('(\d+)', '([^']+)', '(\d+)', (\d), (TRUE|FALSE)\)/g;
  for (const m of sql.matchAll(tuple)) {
    accounts.push({
      code: m[1],
      name: m[2],
      parent_code: m[3],
      level: Number(m[4]),
      accepts_entries: m[5] === 'TRUE',
    });
  }
  return accounts;
}

describe('Colombian PUC data vs default account mappings', () => {
  const puc = new Map<string, PucAccountInput>(
    getColombiaPucAccounts().map((a) => [a.code, a]),
  );

  it('contains every PUC code referenced by a default account mapping', () => {
    const missing = Object.entries(DEFAULT_ACCOUNT_MAPPINGS)
      .filter(([, def]) => !puc.has(def.code))
      .map(([key, def]) => `${key} -> ${def.code}`);

    expect(missing).toEqual([]);
  });
});

describe('QUI-565 payroll cost-center PUC backfill migration', () => {
  const puc = new Map<string, PucAccountInput>(
    getColombiaPucAccounts().map((a) => [a.code, a]),
  );
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  const migrated = parseMigrationAccounts(sql);
  const migratedCodes = new Set(migrated.map((a) => a.code));

  it('creates every account a payroll operational/sales default mapping points to', () => {
    const costCenterCodes = Object.entries(DEFAULT_ACCOUNT_MAPPINGS)
      .filter(
        ([key]) =>
          key.startsWith('payroll.approved.') &&
          (key.endsWith('.operational') || key.endsWith('.sales')),
      )
      .map(([, def]) => def.code);

    expect(costCenterCodes.length).toBeGreaterThan(0);
    const notCovered = [...new Set(costCenterCodes)].filter(
      (code) => !migratedCodes.has(code),
    );
    expect(notCovered).toEqual([]);
  });

  it('mirrors colombia-puc.data.ts for every account it creates', () => {
    expect(migrated.length).toBe(19);
    for (const account of migrated) {
      const source = puc.get(account.code);
      expect(source).toBeDefined();
      expect({
        code: account.code,
        name: account.name,
        parent_code: account.parent_code,
        level: account.level,
        accepts_entries: account.accepts_entries,
      }).toEqual({
        code: source!.code,
        name: source!.name,
        parent_code: source!.parent_code,
        level: source!.level,
        accepts_entries: source!.accepts_entries,
      });
      expect(source!.account_type).toBe('expense');
      expect(source!.nature).toBe('debit');
    }
  });

  it('creates parents before children so every parent exists or is created earlier', () => {
    const seen = new Set<string>();
    for (const account of migrated) {
      if (account.parent_code && !migratedCodes.has(account.parent_code)) {
        // Parent must be an account the original 198-account template already had.
        expect(['52']).toContain(account.parent_code);
      } else if (account.parent_code) {
        expect(seen.has(account.parent_code)).toBe(true);
      }
      seen.add(account.code);
    }
  });

  it('is additive only (no UPDATE / DELETE / TRUNCATE / DROP)', () => {
    const statements = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(statements).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|DROP)\b/i);
  });
});
