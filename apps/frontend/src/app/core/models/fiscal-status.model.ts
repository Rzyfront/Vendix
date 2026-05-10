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

export const REQUIRED_STEPS_BY_AREA: Record<FiscalArea, FiscalWizardStepId[]> = {
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
  payroll: ['legal_data', 'payroll_config', 'accounting_mappings', 'validation'],
};

export const FISCAL_STEP_ORDER: FiscalWizardStepId[] = [
  'area_selection',
  'legal_data',
  'dian_config',
  'puc',
  'accounting_period',
  'default_taxes',
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
