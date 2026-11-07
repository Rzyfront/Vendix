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
 * IA Business has no exclusive module of its own: access to `flows` and
 * `documents` comes from the `administration` industry, and plans differ only
 * by AI and its token quota (odd/tasks/flujos-administracion-plan.md, D2).
 */
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
    exclusive: EMPRESARIAL_MODULE_KEYS,
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

// ── Sale flow: the plan layer never blocks a sale ─────────────────────────

/**
 * API prefixes a sale calls between opening the cart and closing the payment
 * (POS, «Cobrar» on an order, storefront checkout) that sit under a gated
 * prefix of `PLAN_MODULE_API_ROUTES`. Sale endpoints outside gated prefixes
 * (orders, payments, customers, cash registers, stock…) are never evaluated by
 * the plan layer and are not listed here. Full sale path inventory:
 * docs/access/venta-endpoints.md.
 *
 * A sale is NEVER blocked by the module paywall: these prefixes are exempt
 * (see `PLAN_GATE_EXEMPT_API_PREFIXES`) and `isSaleFlow` is the single place
 * that decides "this is a sale" for the backend guard, the frontend
 * interceptor and the tests. Add the prefix here the day a sale starts calling
 * a new endpoint under a gated prefix; `plan-modules.sale-flow.spec.ts` fails
 * if the POS or the checkout calls one that is missing.
 */
export const SALE_FLOW_API_PREFIXES: readonly string[] = [
  // Cart: withholding the customer suffers, previewed on every cart change.
  '/api/store/withholding-tax/preview',
  // POS fiscal status (polling after payment) and its retry emission.
  '/api/store/invoicing/pos',
  // POS holder warning: emission status on mount, holder check per customer.
  '/api/store/invoicing/dian-config/emission-status',
  '/api/store/invoicing/holder-check',
  // POS confirmation modal lists the DIAN configs: GET of the list only, so
  // creating a config (POST on the same path) stays gated.
  'GET /api/store/invoicing/dian-config$',
  // Order detail «Cobrar»: UVT threshold on mount, invoice notes after paying,
  // «Facturar» and the invoice PDF.
  '/api/store/invoicing/uvt-threshold',
  '/api/store/invoicing/orders/:id/emit',
  '/api/store/invoicing/:id/notes',
  '/api/store/invoicing/:id/pdf$',
  // POS split bill: invoice per financial account.
  '/api/store/invoicing/financial-accounts/:id/emit',
];

/**
 * Panel and storefront routes where a sale is in progress (cart open, payment
 * running). While the user is on one of them the frontend never opens the
 * module paywall, whatever endpoint answered `PLAN_MODULE_NOT_INCLUDED`.
 */
export const SALE_FLOW_UI_ROUTES: readonly string[] = [
  '/admin/pos',
  '/admin/orders/:id',
  '/cart',
  '/checkout',
];

function normalizePath(raw: string | null | undefined): string {
  if (!raw) return '';
  // Query and hash go first: nothing in them may change the path decision.
  let path = String(raw).split('?')[0].split('#')[0];
  // Absolute URL (frontend `environment.apiUrl`): keep only the pathname. The
  // scheme counts only at the very start.
  const absolute = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(path);
  if (absolute) path = path.slice(absolute[0].length) || '/';
  return path.replace(/\/+$/, '').toLowerCase();
}

/**
 * Whole-segment prefix match. In a pattern, `:id` matches one numeric segment
 * and a trailing `$` makes the match exact (no sub-paths). An entry may start
 * with an HTTP method (`GET /api/...`): it then matches only that method, and
 * never when the caller does not say which method it is.
 */
function matchesEntry(
  path: string,
  entry: string,
  method?: string | null,
): boolean {
  const space = entry.indexOf(' ');
  if (space < 0) return matchesPrefix(path, entry);
  if (!method || method.toUpperCase() !== entry.slice(0, space)) return false;
  return matchesPrefix(path, entry.slice(space + 1));
}

function matchesPrefix(path: string, prefix: string): boolean {
  if (!prefix.includes(':') && !prefix.endsWith('$')) {
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  const exact = prefix.endsWith('$');
  const wanted = (exact ? prefix.slice(0, -1) : prefix).split('/');
  const actual = path.split('/');
  if (exact ? actual.length !== wanted.length : actual.length < wanted.length) {
    return false;
  }
  return wanted.every((segment, i) =>
    segment === ':id' ? /^\d+$/.test(actual[i]) : segment === actual[i],
  );
}

/**
 * THE decision "this request belongs to a sale". True when the API path is a
 * sale endpoint, or when the UI route is a screen where a sale is in progress.
 * Accepts absolute URLs (`https://host/api/...`) and strips query and hash.
 * Pass `method` for API calls: some sale entries are bound to one method.
 */
export function isSaleFlow(context: {
  apiPath?: string | null;
  method?: string | null;
  uiRoute?: string | null;
}): boolean {
  const apiPath = normalizePath(context.apiPath);
  if (
    apiPath &&
    SALE_FLOW_API_PREFIXES.some((entry) => matchesEntry(apiPath, entry, context.method))
  ) {
    return true;
  }
  const uiRoute = normalizePath(context.uiRoute);
  return (
    !!uiRoute && SALE_FLOW_UI_ROUTES.some((prefix) => matchesPrefix(uiRoute, prefix))
  );
}

/**
 * Prefixes the API layer never gates even when they sit under a gated prefix.
 * The screens of these modules stay locked in the panel; only the shared
 * endpoints stay reachable:
 *   - every sale endpoint (`SALE_FLOW_API_PREFIXES`).
 *   - `invoicing/scan-draft`: purchase-invoice OCR (purchase orders).
 *   - `accounting/chart-of-accounts`: shared account lookups (forms, wizard).
 *   - `payroll/employees`: service providers (reservations).
 * `taxes` (product tax categories) and `accounts-receivable/payable` (payment
 * collector) are not in the map at all for the same reason.
 */
export const PLAN_GATE_EXEMPT_API_PREFIXES: readonly string[] = [
  ...SALE_FLOW_API_PREFIXES,
  '/api/store/invoicing/scan-draft',
  '/api/store/accounting/chart-of-accounts',
  '/api/organization/accounting/chart-of-accounts',
  '/api/store/payroll/employees',
  '/api/store/subscriptions',
  '/api/store/access-gate',
  '/api/organization/access-gate',
];

/**
 * Module key whose prefix covers an API path, ignoring the exemptions. Used by
 * the guard to audit a sale endpoint that sits under a module the plan lacks.
 */
export function mappedPlanModuleForApiPath(rawPath: string | null | undefined): string | null {
  const path = normalizePath(rawPath);
  if (!path) return null;
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

/**
 * Module key governing an API path, or `null` when the plan layer skips it.
 * Without `method`, method-bound exemptions (`GET /api/...`) do not apply.
 */
export function planModuleForApiPath(
  rawPath: string | null | undefined,
  method?: string | null,
): string | null {
  const path = normalizePath(rawPath);
  if (!path) return null;
  if (PLAN_GATE_EXEMPT_API_PREFIXES.some((entry) => matchesEntry(path, entry, method))) {
    return null;
  }
  return mappedPlanModuleForApiPath(path);
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
];

/** Family of a gated key; `null` for keys outside the paywall copy. */
export function planModuleFamily(key: string): PlanModuleFamily | null {
  return PLAN_MODULE_FAMILIES.find((family) => family.keys.includes(key)) ?? null;
}
