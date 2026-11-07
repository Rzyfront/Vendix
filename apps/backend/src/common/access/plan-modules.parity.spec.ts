import { readFileSync } from 'fs';
import { join } from 'path';
import { MODULE_INDUSTRIES } from './module-industries';
import {
  EMPRESARIAL_MODULE_KEYS,
  PLAN_MATRIX,
  PLAN_MODULE_API_ROUTES,
  PLAN_MODULE_FAMILIES,
  PlanModuleRule,
  isPlanExemptKey,
  planBlockedModules,
  planLineForCode,
  planModuleForApiPath,
  requiredPlanCodes,
} from './plan-modules';

// Three byte-identical copies (no executable shared package between runtimes).
const REPO_ROOT = join(__dirname, '../../../../..');
const COPIES = [
  { name: 'shared-types', path: 'libs/shared-types/plan-modules.ts' },
  { name: 'backend', path: 'apps/backend/src/common/access/plan-modules.ts' },
  {
    name: 'frontend',
    path: 'apps/frontend/src/app/shared/constants/plan-modules.ts',
  },
];
const MIGRATION = join(
  REPO_ROOT,
  'apps/backend/prisma/migrations/20261110090000_plan_module_rules/migration.sql',
);
// Applied migrations are immutable: D2 takes flows/documents out in a later one.
const RELEASED_FROM_IA_BUSINESS = ['flows', 'documents'];
const RELEASE_MIGRATION = join(
  REPO_ROOT,
  'apps/backend/prisma/migrations/20261116090000_plan_rules_release_flows_documents/migration.sql',
);

/** Rows the migration would write for one plan code, built from PLAN_MATRIX. */
function matrixRules(codes: string[]): PlanModuleRule[] {
  return codes.flatMap((code) => {
    const line = planLineForCode(code);
    if (!line) return [];
    return [
      ...line.blocked.map((key) => ({
        plan_code: code,
        module_key: key,
        mode: 'blocked' as const,
      })),
      ...line.exclusive.map((key) => ({
        plan_code: code,
        module_key: key,
        mode: 'exclusive' as const,
      })),
    ];
  });
}

const PROD_CODES = [
  'vendix-impulsa',
  'emprendedor-pro-monthly',
  'emprendedor-pro-annual',
  'empresarial-pro-monthly',
  'ia-business',
  'acceso-exclusivo-annual',
];

describe('plan-modules — parity with the copies and the migration', () => {
  it('the three copies are byte-identical', () => {
    const [canonical, ...rest] = COPIES.map((c) =>
      readFileSync(join(REPO_ROOT, c.path)),
    );
    rest.forEach((buf, i) => {
      expect({ copy: COPIES[i + 1].name, equal: buf.equals(canonical) }).toEqual(
        { copy: COPIES[i + 1].name, equal: true },
      );
    });
  });

  it('the seed migration minus the D2 release is exactly PLAN_MATRIX (prefix, mode and keys per line)', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const blocks = sql.split('-- ').filter((b) => /^[a-z-]+%: /.test(b));
    expect(blocks).toHaveLength(PLAN_MATRIX.length);
    for (const line of PLAN_MATRIX) {
      const [prefix] = line.code_prefixes;
      const mode = line.blocked.length ? 'blocked' : 'exclusive';
      const keys = line.blocked.length ? line.blocked : line.exclusive;
      const block = blocks.find((b) => b.startsWith(`${prefix}%: `));
      expect({ line: line.id, found: !!block }).toEqual({ line: line.id, found: true });
      expect(block).toContain(`'${mode}'::"plan_module_rule_mode_enum"`);
      expect(block).toContain(`LIKE '${prefix}%'`);
      const seeded = [...block!.matchAll(/\('([a-z_]+)'\)/g)]
        .map((m) => m[1])
        .filter(
          (key) =>
            prefix !== 'ia-business' || !RELEASED_FROM_IA_BUSINESS.includes(key),
        );
      expect(seeded.sort()).toEqual([...keys].sort());
    }
  });

  it('the D2 release deletes only the exclusive flows/documents rows of ia-business%', () => {
    const sql = readFileSync(RELEASE_MIGRATION, 'utf8');
    expect(sql).toContain('-- DATA IMPACT:');
    const statements = sql
      .split('\n')
      .filter((line) => !line.startsWith('--'))
      .join('\n');
    expect(statements.match(/DELETE FROM/g)).toHaveLength(1);
    expect(statements).not.toMatch(/\b(TRUNCATE|DROP|CASCADE|UPDATE)\b/);
    expect(statements).toContain(`"mode" = 'exclusive'`);
    expect(statements).toContain(`"module_key" IN ('flows', 'documents')`);
    expect(statements).toContain(`"code" LIKE 'ia-business%'`);
  });
});

describe('plan-modules — matrix invariants', () => {
  it('every Empresarial key is a known panel key', () => {
    for (const key of EMPRESARIAL_MODULE_KEYS) {
      expect({ key, known: key in MODULE_INDUSTRIES }).toEqual({ key, known: true });
    }
  });

  it('every API-mapped key and every paywall family key is a gated key', () => {
    const gated = new Set([...EMPRESARIAL_MODULE_KEYS]);
    for (const key of Object.keys(PLAN_MODULE_API_ROUTES)) {
      expect({ key, gated: gated.has(key) }).toEqual({ key, gated: true });
    }
    for (const family of PLAN_MODULE_FAMILIES) {
      for (const key of family.keys) expect(gated.has(key)).toBe(true);
    }
    for (const key of gated) {
      expect({ key, family: PLAN_MODULE_FAMILIES.some((f) => f.keys.includes(key)) }).toEqual({
        key,
        family: true,
      });
    }
  });

  it('no gated key is exempt (dashboard, subscription, account, help stay open)', () => {
    for (const key of [...EMPRESARIAL_MODULE_KEYS]) {
      expect(isPlanExemptKey(key)).toBe(false);
    }
    for (const key of [
      'dashboard',
      'subscription',
      'consultations',
      'help',
      'help_support',
      'help_pqrs',
      'settings_general',
      'settings_security',
    ]) {
      expect(isPlanExemptKey(key)).toBe(true);
    }
  });
});

describe('plan-modules — evaluation over the seeded matrix', () => {
  const rules = matrixRules(PROD_CODES);

  it('Impulsa and Emprendedor lack fiscal/accounting modules and the IA Business ones', () => {
    for (const code of ['vendix-impulsa', 'emprendedor-pro-monthly', 'emprendedor-pro-annual']) {
      const blocked = planBlockedModules(code, rules);
      expect(blocked).toEqual(
        [...EMPRESARIAL_MODULE_KEYS].sort(),
      );
    }
  });

  it('Empresarial Pro includes every gated module', () => {
    expect(planBlockedModules('empresarial-pro-monthly', rules)).toEqual([]);
  });

  it('flows and documents are never gated by plan: the industry grants them (D2)', () => {
    const everyLine = [
      'vendix-impulsa',
      'emprendedor-pro-monthly',
      'empresarial-pro-monthly',
      'ia-business',
    ];
    for (const plan of everyLine) {
      const blocked = planBlockedModules(plan, rules);
      expect(blocked).not.toContain('flows');
      expect(blocked).not.toContain('documents');
    }
    expect(requiredPlanCodes('flows', rules)).toEqual([]);
    expect(requiredPlanCodes('documents', rules)).toEqual([]);
    expect(rules.some((r) => ['flows', 'documents'].includes(r.module_key))).toBe(false);
  });

  it('IA Business includes everything', () => {
    expect(planBlockedModules('ia-business', rules)).toEqual([]);
  });

  it('a plan outside the matrix (promotional, no plan) is never blocked', () => {
    expect(planBlockedModules('acceso-exclusivo-annual', rules)).toEqual([]);
    expect(planBlockedModules(null, rules)).toEqual([]);
    expect(planBlockedModules('', rules)).toEqual([]);
  });

  it('an exempt key is never blocked even if a rule names it', () => {
    const extra: PlanModuleRule[] = [
      ...rules,
      { plan_code: 'vendix-impulsa', module_key: 'dashboard', mode: 'blocked' },
      { plan_code: 'ia-business', module_key: 'subscription', mode: 'exclusive' },
    ];
    const blocked = planBlockedModules('vendix-impulsa', extra);
    expect(blocked).not.toContain('dashboard');
    expect(blocked).not.toContain('subscription');
  });

  it('required plans: invoicing → Empresarial + IA Business', () => {
    expect(requiredPlanCodes('invoicing', rules)).toEqual([
      'empresarial-pro-monthly',
      'ia-business',
    ]);
    expect(requiredPlanCodes('pos', rules)).toEqual([]);
  });

  it('plan line by code prefix, case-insensitive; promotional codes are outside', () => {
    expect(planLineForCode('EMPRESARIAL-PRO-annual')?.id).toBe('empresarial');
    expect(planLineForCode('acceso-exclusivo-annual')).toBeNull();
    expect(planLineForCode(undefined)).toBeNull();
  });
});

describe('plan-modules — API route → module', () => {
  it.each([
    ['/api/store/invoicing', 'invoicing'],
    ['/api/store/invoicing/invoices/12?x=1', 'invoicing'],
    ['/api/store/invoicing/resolutions/3', 'invoicing_resolutions'],
    ['/api/store/accounting/journal-entries', 'accounting_journal_entries'],
    ['/api/store/accounting/reports/balance', 'reports_accounting'],
    ['/api/store/payroll/runs/1', 'payroll'],
    ['/api/store/reports/payroll/summary', 'reports_payroll'],
    ['/api/store/fiscal/obligations', 'fiscal_operations'],
    ['/api/organization/accounting/mappings', 'accounting_account_mappings'],
    ['/api/store/taxes/ica/', 'taxes_ica'],
  ])('%s → %s', (path, key) => {
    expect(planModuleForApiPath(path)).toBe(key);
  });

  it.each([
    '/api/store/invoicing/scan-draft/upload',
    '/api/store/invoicing/pos/status',
    '/api/store/accounting/chart-of-accounts',
    '/api/store/payroll/employees',
    '/api/store/taxes',
    '/api/store/accounts-receivable',
    '/api/store/dashboard',
    '/api/store/subscriptions/current',
    '/api/store/access-gate',
    '/api/store/invoicingx',
    '/api/health',
    '',
  ])('%s is not gated', (path) => {
    expect(planModuleForApiPath(path)).toBeNull();
  });
});
