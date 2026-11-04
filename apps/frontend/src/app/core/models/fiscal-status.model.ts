export type FiscalArea = 'invoicing' | 'accounting' | 'payroll';
export type FiscalStatusState = 'INACTIVE' | 'WIP' | 'ACTIVE' | 'LOCKED';

export type FiscalWizardStepId =
  | 'area_selection'
  | 'legal_data'
  | 'dian_config'
  | 'puc'
  | 'accounting_period'
  | 'default_taxes'
  | 'accounting_mappings'
  | 'initial_inventory'
  | 'payroll_config'
  | 'validation';

export interface FiscalStatusWizardState {
  selected_areas: FiscalArea[];
  step_sequence: FiscalWizardStepId[];
  current_step: FiscalWizardStepId | null;
  completed_steps: FiscalWizardStepId[];
  step_refs: Record<string, unknown>;
  step_data: Record<string, unknown>;
  started_at: string | null;
  updated_at: string | null;
}

export interface FiscalDetectorSignals {
  revenue_over_uvt?: boolean;
  transaction_volume?: boolean;
  b2b_invoices?: boolean;
  legal_person?: boolean;
  active_employees?: boolean;
  score?: number;
  evaluated_at?: string;
}

export interface FiscalAreaStatus {
  state: FiscalStatusState;
  wizard: FiscalStatusWizardState;
  detector_signals: FiscalDetectorSignals;
  locked_reasons: string[];
  activated_at: string | null;
  locked_at: string | null;
  updated_at: string | null;
}

export type FiscalStatusBlock = Record<FiscalArea, FiscalAreaStatus>;

export interface FiscalStatusReadResult {
  organization_id: number;
  store_id: number | null;
  fiscal_scope: 'STORE' | 'ORGANIZATION';
  fiscal_status: FiscalStatusBlock;
  store_statuses?: Array<{
    store_id: number;
    store_name: string;
    fiscal_status: FiscalStatusBlock;
  }>;
}

export const FISCAL_AREAS: FiscalArea[] = [
  'invoicing',
  'accounting',
  'payroll',
];

export const FISCAL_AREA_LABELS: Record<FiscalArea, string> = {
  invoicing: 'Facturación',
  accounting: 'Contabilidad',
  payroll: 'Nómina',
};

export const FISCAL_STEP_LABELS: Record<FiscalWizardStepId, string> = {
  area_selection: 'Áreas',
  legal_data: 'Datos legales',
  dian_config: 'DIAN',
  puc: 'PUC',
  accounting_period: 'Periodo fiscal',
  default_taxes: 'Impuestos',
  accounting_mappings: 'Mapeos',
  initial_inventory: 'Inventario',
  payroll_config: 'Nómina',
  validation: 'Validación',
};

export const REQUIRED_STEPS_BY_AREA: Record<FiscalArea, FiscalWizardStepId[]> =
  {
    invoicing: ['legal_data', 'dian_config', 'default_taxes', 'validation'],
    accounting: [
      'legal_data',
      'puc',
      'accounting_period',
      'default_taxes',
      'accounting_mappings',
      'initial_inventory',
      'validation',
    ],
    payroll: ['legal_data', 'payroll_config', 'validation'],
  };

export const FISCAL_STEP_ORDER: FiscalWizardStepId[] = [
  'area_selection',
  'legal_data',
  'default_taxes',
  'puc',
  'accounting_period',
  'dian_config',
  'accounting_mappings',
  'initial_inventory',
  'payroll_config',
  'validation',
];

export function buildFiscalWizardSequence(
  areas: readonly FiscalArea[],
): FiscalWizardStepId[] {
  const required = new Set<FiscalWizardStepId>(['area_selection']);
  areas.forEach((area) =>
    REQUIRED_STEPS_BY_AREA[area].forEach((step) => required.add(step)),
  );
  return FISCAL_STEP_ORDER.filter((step) => required.has(step));
}

export function fiscalAreaHasPendingSignal(
  area: FiscalArea,
  status: FiscalAreaStatus | undefined,
): boolean {
  if (!status || status.state === 'ACTIVE' || status.state === 'LOCKED') {
    return false;
  }
  const signals = status.detector_signals || {};
  if (area === 'payroll') return signals.active_employees === true;
  return [
    signals.revenue_over_uvt,
    signals.transaction_volume,
    signals.b2b_invoices,
    signals.legal_person,
  ].some(Boolean);
}

/**
 * Wizard stages already done for the active fiscal status: the union of every
 * area's `wizard.completed_steps` plus every required step of an area that is
 * already ACTIVE/LOCKED. An area can be activated outside the wizard (backfill,
 * the invoicing activation flow), so its activation implies its stages even
 * when `completed_steps` was never written.
 */
export function completedFiscalSteps(
  status: FiscalStatusBlock | null | undefined,
  activeAreas: readonly FiscalArea[],
): ReadonlySet<FiscalWizardStepId> {
  const done = new Set<FiscalWizardStepId>();
  FISCAL_AREAS.forEach((area) =>
    status?.[area]?.wizard?.completed_steps?.forEach((step) => done.add(step)),
  );
  activeAreas.forEach((area) =>
    REQUIRED_STEPS_BY_AREA[area].forEach((step) => done.add(step)),
  );
  return done;
}

/**
 * What a fiscal entry of the Finanzas group needs before it is shown and its
 * URL opens: a fiscal area ACTIVE/LOCKED (`'any'` = at least one), or one
 * wizard stage completed.
 */
export type FiscalStageRequirement =
  | { area: FiscalArea | 'any' }
  | { step: FiscalWizardStepId };

export interface FiscalStageRouteGate {
  /** Route of the sidebar leaf; it also gates every URL below it. */
  route: string;
  requires: FiscalStageRequirement;
  /**
   * URLs below `route` that configure the stage itself, so they must stay
   * reachable before it is complete (the wizard, the invoicing activation and
   * the screens the wizard sends the owner to).
   */
  setupRoutes?: string[];
  /** Read-only surface a permissioned reader keeps while the stage is missing. */
  readFallback?: { permission: string; route: string };
}

/**
 * Single source of the "stage of the fiscal wizard → Finanzas entry" rule.
 * `MenuFilterService` applies it to the sidebar leaf with the same route and
 * `panelUiGuard` applies it to the URL, so an entry hidden from the menu does
 * not open by typing its route either. Gastos is deliberately absent: it is
 * always available.
 */
export const FISCAL_STAGE_ROUTE_GATES: readonly FiscalStageRouteGate[] = [
  {
    route: '/admin/fiscal',
    requires: { area: 'any' },
    setupRoutes: ['/admin/fiscal/wizard', '/admin/fiscal/activation'],
  },
  { route: '/admin/taxes', requires: { step: 'default_taxes' } },
  {
    route: '/admin/invoicing',
    requires: { area: 'invoicing' },
    setupRoutes: [
      '/admin/invoicing/activation',
      '/admin/invoicing/dian-config',
      '/admin/invoicing/resolutions',
    ],
    readFallback: {
      permission: 'invoicing:received:read',
      route: '/admin/invoicing/received-documents',
    },
  },
  { route: '/admin/accounting', requires: { area: 'accounting' } },
  { route: '/admin/payroll', requires: { area: 'payroll' } },
];

function isUnder(path: string, route: string): boolean {
  return path === route || path.startsWith(`${route}/`);
}

/** Gate whose route is the exact route of a sidebar leaf. */
export function fiscalStageGateForRoute(
  route: string | undefined,
): FiscalStageRouteGate | null {
  if (!route) return null;
  return FISCAL_STAGE_ROUTE_GATES.find((gate) => gate.route === route) ?? null;
}

/** Gate covering a URL (query and fragment ignored), or null. */
export function fiscalStageGateForUrl(url: string): FiscalStageRouteGate | null {
  const path = url.split(/[?#]/)[0];
  return FISCAL_STAGE_ROUTE_GATES.find((gate) => isUnder(path, gate.route)) ?? null;
}

/** True when the URL is one of the gate's setup screens. */
export function isFiscalStageSetupUrl(
  gate: FiscalStageRouteGate,
  url: string,
): boolean {
  const path = url.split(/[?#]/)[0];
  return (gate.setupRoutes ?? []).some((route) => isUnder(path, route));
}

/** True when the URL is inside the gate's read-only fallback surface. */
export function isFiscalStageReadFallbackUrl(
  gate: FiscalStageRouteGate,
  url: string,
): boolean {
  if (!gate.readFallback) return false;
  return isUnder(url.split(/[?#]/)[0], gate.readFallback.route);
}

export function isFiscalStageReady(
  requires: FiscalStageRequirement,
  activeAreas: readonly FiscalArea[],
  status: FiscalStatusBlock | null | undefined,
): boolean {
  if ('area' in requires) {
    return requires.area === 'any'
      ? activeAreas.length > 0
      : activeAreas.includes(requires.area);
  }
  return completedFiscalSteps(status, activeAreas).has(requires.step);
}
