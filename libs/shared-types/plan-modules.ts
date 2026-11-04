/**
 * PLAN_MODULES — which `panel_ui` modules each commercial plan includes, the
 * API route → module map the backend guard reads, and the paywall copy.
 *
 * Canonical source (odd/tasks/planes-matriz-accesos.md §2, §4). Same pattern as
 * `module-industries.ts`: it lives in `libs/shared-types` and is copied BYTE FOR
 * BYTE to the two runtimes, because no executable package is shared between
 * Nest and Angular:
 *
 *   - apps/backend/src/common/access/plan-modules.ts
 *   - apps/frontend/src/app/shared/constants/plan-modules.ts
 *
 * `apps/backend/src/common/access/plan-modules.parity.spec.ts` fails if any copy
 * drifts or if the migration that seeds `plan_module_rules` stops matching
 * `PLAN_MATRIX`. Edit this file, then copy it over both mirrors.
 *
 * Rule semantics (`plan_module_rules.mode`):
 *   - `blocked`: the plan does not include the module.
 *   - `exclusive`: the plan includes the module, and only the plans that carry
 *     an `exclusive` row for it do.
 * A plan with no rows at all (promotional, archived, legacy, trial) is outside
 * the matrix: the plan layer never blocks it. Exempt keys are never blocked.
 *
 * Pure data + pure functions: no imports, no runtime dependencies.
 */

export const PLAN_MODULE_RULE_MODES = ['exclusive', 'blocked'] as const;

export type PlanModuleRuleMode = (typeof PLAN_MODULE_RULE_MODES)[number];

/** One `plan_module_rules` row, flattened with the plan code. */
export interface PlanModuleRule {
  plan_code: string;
  module_key: string;
  mode: PlanModuleRuleMode;
}

// ── Module families sold from Empresarial Pro ─────────────────────────────

export const INVOICING_KEYS: readonly string[] = [
  'invoicing',
  'invoicing_invoices',
  'invoicing_resolutions',
  'invoicing_dian_config',
];

export const ACCOUNTING_KEYS: readonly string[] = [
  'accounting',
  'accounting_journal_entries',
  'accounting_chart_of_accounts',
  'accounting_fiscal_periods',
  'accounting_account_mappings',
  'accounting_flows_dashboard',
  'accounting_withholding_tax',
  'accounting_exogenous',
  'reports_accounting',
];

export const TAXES_KEYS: readonly string[] = ['taxes', 'taxes_ica'];

export const CARTERA_KEYS: readonly string[] = [
  'cartera_dashboard',
  'cartera_receivables',
  'cartera_payables',
  'cartera_aging',
];

export const PAYROLL_KEYS: readonly string[] = [
  'payroll',
  'payroll_employees',
  'payroll_runs',
  'payroll_settlements',
  'payroll_novelties',
  'payroll_advances',
  'payroll_pila',
  'payroll_settings',
  'reports_payroll',
];

export const FISCAL_KEYS: readonly string[] = [
  'fiscal_operations',
  'fiscal_dashboard',
  'fiscal_obligations',
  'fiscal_declarations',
  'fiscal_close',
  'fiscal_audit',
  'fiscal_rules',
];

/** Everything Empresarial Pro adds over Emprendedor. */
export const EMPRESARIAL_MODULE_KEYS: readonly string[] = [
  ...INVOICING_KEYS,
  ...ACCOUNTING_KEYS,
  ...TAXES_KEYS,
  ...CARTERA_KEYS,
  ...PAYROLL_KEYS,
  ...FISCAL_KEYS,
];

/**
 * IA Business only. Neither module exists yet (own plan:
 * odd/tasks/flujos-ai-business.md); the rules are seeded so they lock the day
 * the modules land.
 */
export const IA_BUSINESS_MODULE_KEYS: readonly string[] = ['flows', 'documents'];

// ── Commercial lines and the matrix ───────────────────────────────────────

export type PlanLineId = 'impulsa' | 'emprendedor' | 'empresarial' | 'ia_business';

export interface PlanLine {
  id: PlanLineId;
  name: string;
  /**
   * `subscription_plans.code` prefixes of the line. Monthly, quarterly and
   * annual variants share the prefix and get the same rules.
   */
  code_prefixes: readonly string[];
  blocked: readonly string[];
  exclusive: readonly string[];
}

export const PLAN_MATRIX: readonly PlanLine[] = [
  {
    id: 'impulsa',
    name: 'Vendix Impulsa',
    code_prefixes: ['vendix-impulsa'],
    blocked: EMPRESARIAL_MODULE_KEYS,
    exclusive: [],
  },
  {
    id: 'emprendedor',
    name: 'Emprendedor',
    code_prefixes: ['emprendedor-pro'],
    blocked: EMPRESARIAL_MODULE_KEYS,
    exclusive: [],
  },
  {
    id: 'empresarial',
    name: 'Empresarial Pro',
    code_prefixes: ['empresarial-pro'],
    blocked: [],
    exclusive: EMPRESARIAL_MODULE_KEYS,
  },
  {
    id: 'ia_business',
    name: 'IA Business',
    code_prefixes: ['ia-business'],
    blocked: [],
    exclusive: [...EMPRESARIAL_MODULE_KEYS, ...IA_BUSINESS_MODULE_KEYS],
  },
];

/** Line of a plan code, or `null` when the plan is outside the matrix. */
export function planLineForCode(code: string | null | undefined): PlanLine | null {
  if (!code) return null;
  const normalized = code.toLowerCase();
  return (
    PLAN_MATRIX.find((line) =>
      line.code_prefixes.some((prefix) => normalized.startsWith(prefix)),
    ) ?? null
  );
}

// ── Keys the plan layer never blocks ──────────────────────────────────────

/**
 * Dashboard, subscription (where the customer pays), account settings, help
 * and support stay open on every plan, even if a rule names them.
 */
export function isPlanExemptKey(key: string): boolean {
  return (
    key === 'dashboard' ||
    key === 'subscription' ||
    key === 'consultations' ||
    key.startsWith('help') ||
    key.startsWith('settings')
  );
}

// ── Evaluation ────────────────────────────────────────────────────────────

/**
 * Module keys the plan does NOT include. Empty for a plan outside the matrix.
 * `rules` are all rows (every plan), because `exclusive` is a cross-plan rule.
 */
export function planBlockedModules(
  planCode: string | null | undefined,
  rules: readonly PlanModuleRule[],
): string[] {
  if (!planCode) return [];
  const own = rules.filter((rule) => rule.plan_code === planCode);
  if (!own.length) return [];

  const ownExclusive = new Set(
    own.filter((rule) => rule.mode === 'exclusive').map((rule) => rule.module_key),
  );
  const blocked = new Set<string>();
  for (const rule of own) {
    if (rule.mode === 'blocked') blocked.add(rule.module_key);
  }
  for (const rule of rules) {
    if (rule.mode === 'exclusive' && !ownExclusive.has(rule.module_key)) {
      blocked.add(rule.module_key);
    }
  }
  return [...blocked].filter((key) => !isPlanExemptKey(key)).sort();
}

/** Plan codes that include `key` (their `exclusive` rows). */
export function requiredPlanCodes(
  key: string,
  rules: readonly PlanModuleRule[],
): string[] {
  return [
    ...new Set(
      rules
        .filter((rule) => rule.mode === 'exclusive' && rule.module_key === key)
        .map((rule) => rule.plan_code),
    ),
  ].sort();
}

// ── API route → module (backend guard) ────────────────────────────────────

/**
 * API path prefixes per module key. Longest prefix wins, matched on whole path
 * segments. Store and organization panels share the key.
 */
export const PLAN_MODULE_API_ROUTES: Readonly<Record<string, readonly string[]>> = {
  invoicing: ['/api/store/invoicing', '/api/organization/invoicing'],
  invoicing_resolutions: [
    '/api/store/invoicing/resolutions',
    '/api/organization/invoicing/resolutions',
  ],
  invoicing_dian_config: [
    '/api/store/invoicing/dian-config',
    '/api/organization/invoicing/dian-config',
  ],
  accounting: ['/api/store/accounting', '/api/organization/accounting'],
  accounting_journal_entries: [
    '/api/store/accounting/journal-entries',
    '/api/organization/accounting/journal-entries',
  ],
  accounting_fiscal_periods: [
    '/api/store/accounting/fiscal-periods',
    '/api/organization/accounting/fiscal-periods',
  ],
  accounting_account_mappings: [
    '/api/store/accounting/account-mappings',
    '/api/organization/accounting/mappings',
  ],
  accounting_withholding_tax: [
    '/api/store/withholding-tax',
    '/api/organization/withholding-tax',
  ],
  accounting_exogenous: ['/api/store/exogenous', '/api/organization/exogenous'],
  reports_accounting: ['/api/store/accounting/reports'],
  taxes_ica: ['/api/store/taxes/ica', '/api/organization/taxes/ica'],
  payroll: ['/api/store/payroll', '/api/organization/payroll'],
  reports_payroll: ['/api/store/reports/payroll', '/api/organization/reports/payroll'],
  fiscal_operations: ['/api/store/fiscal', '/api/organization/fiscal'],
};

/**
 * Prefixes other modules consume, so the API layer never gates them even when
 * they sit under a gated prefix. The screens of these modules stay locked in
 * the panel; only the shared endpoints stay reachable:
 *   - `invoicing/scan-draft`: purchase-invoice OCR (purchase orders).
 *   - `invoicing/pos`: the POS reads the fiscal status before a sale.
 *   - `accounting/chart-of-accounts`: shared account lookups (forms, wizard).
 *   - `payroll/employees`: service providers (reservations).
 * `taxes` (product tax categories) and `accounts-receivable/payable` (payment
 * collector) are not in the map at all for the same reason.
 */
export const PLAN_GATE_EXEMPT_API_PREFIXES: readonly string[] = [
  '/api/store/invoicing/scan-draft',
  '/api/store/invoicing/pos',
  '/api/store/accounting/chart-of-accounts',
  '/api/organization/accounting/chart-of-accounts',
  '/api/store/payroll/employees',
  '/api/store/subscriptions',
  '/api/store/access-gate',
  '/api/organization/access-gate',
];

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Module key governing an API path, or `null` when the plan layer skips it. */
export function planModuleForApiPath(rawPath: string | null | undefined): string | null {
  if (!rawPath) return null;
  const path = rawPath.split('?')[0].split('#')[0].replace(/\/+$/, '').toLowerCase();
  if (PLAN_GATE_EXEMPT_API_PREFIXES.some((prefix) => matchesPrefix(path, prefix))) {
    return null;
  }
  let best: string | null = null;
  let bestLength = -1;
  for (const [key, prefixes] of Object.entries(PLAN_MODULE_API_ROUTES)) {
    for (const prefix of prefixes) {
      if (matchesPrefix(path, prefix) && prefix.length > bestLength) {
        best = key;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}

// ── Paywall copy ──────────────────────────────────────────────────────────

export interface PlanModuleFamily {
  id: string;
  name: string;
  /** One line of value, shown under the name in the paywall. */
  value: string;
  keys: readonly string[];
}

export const PLAN_MODULE_FAMILIES: readonly PlanModuleFamily[] = [
  {
    id: 'invoicing',
    name: 'Facturación electrónica',
    value: 'Emite facturas electrónicas válidas ante la DIAN sin límite.',
    keys: INVOICING_KEYS,
  },
  {
    id: 'accounting',
    name: 'Contabilidad automatizada',
    value: 'Cada venta, compra y pago se contabiliza solo, con tus reportes al día.',
    keys: [...ACCOUNTING_KEYS, ...TAXES_KEYS],
  },
  {
    id: 'cartera',
    name: 'Cartera',
    value: 'Controla cuentas por cobrar y por pagar con su vencimiento.',
    keys: CARTERA_KEYS,
  },
  {
    id: 'payroll',
    name: 'Nómina',
    value: 'Liquida nómina, prestaciones y PILA de tu equipo.',
    keys: PAYROLL_KEYS,
  },
  {
    id: 'fiscal',
    name: 'Operación fiscal',
    value: 'Calendario de obligaciones, declaraciones y cierre fiscal en un solo lugar.',
    keys: FISCAL_KEYS,
  },
  {
    id: 'flows',
    name: 'Flujos Automatizados impulsados con IA',
    value: 'Automatiza procesos de tu negocio con agentes que trabajan por ti.',
    keys: ['flows'],
  },
  {
    id: 'documents',
    name: 'Documentación Avanzada con IA integrada',
    value: 'Recibe, organiza y consulta tus documentos con IA.',
    keys: ['documents'],
  },
];

/** Family of a gated key; `null` for keys outside the paywall copy. */
export function planModuleFamily(key: string): PlanModuleFamily | null {
  return PLAN_MODULE_FAMILIES.find((family) => family.keys.includes(key)) ?? null;
}
