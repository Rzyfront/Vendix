export type FiscalArea = 'invoicing' | 'accounting' | 'payroll';
export type FiscalStatusState = 'INACTIVE' | 'WIP' | 'ACTIVE' | 'LOCKED';
export type FiscalStatusSource =
  | 'manual'
  | 'wizard'
  | 'migration_v1'
  | 'detector'
  | 'event';

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

const AREAS: FiscalArea[] = ['invoicing', 'accounting', 'payroll'];

export function createDefaultFiscalStatusBlock(): FiscalStatusBlock {
  return AREAS.reduce((acc, area) => {
    acc[area] = {
      state: 'INACTIVE',
      wizard: {
        selected_areas: [],
        step_sequence: [],
        current_step: null,
        completed_steps: [],
        step_refs: {},
        step_data: {},
        started_at: null,
        updated_at: null,
      },
      detector_signals: {},
      locked_reasons: [],
      activated_at: null,
      locked_at: null,
      updated_at: null,
    };
    return acc;
  }, {} as FiscalStatusBlock);
}

export function normalizeFiscalStatusBlock(value: unknown): FiscalStatusBlock {
  const defaults = createDefaultFiscalStatusBlock();
  const source = value && typeof value === 'object' ? (value as any) : {};

  for (const area of AREAS) {
    const current =
      source[area] && typeof source[area] === 'object' ? source[area] : {};
    defaults[area] = {
      ...defaults[area],
      ...current,
      state: isFiscalStatusState(current.state)
        ? current.state
        : defaults[area].state,
      wizard: {
        ...defaults[area].wizard,
        ...(current.wizard || {}),
        selected_areas: Array.isArray(current.wizard?.selected_areas)
          ? current.wizard.selected_areas.filter(isFiscalArea)
          : defaults[area].wizard.selected_areas,
        step_sequence: Array.isArray(current.wizard?.step_sequence)
          ? current.wizard.step_sequence.filter(isFiscalWizardStep)
          : defaults[area].wizard.step_sequence,
        completed_steps: Array.isArray(current.wizard?.completed_steps)
          ? current.wizard.completed_steps.filter(isFiscalWizardStep)
          : defaults[area].wizard.completed_steps,
        step_refs:
          current.wizard?.step_refs &&
          typeof current.wizard.step_refs === 'object'
            ? current.wizard.step_refs
            : defaults[area].wizard.step_refs,
      },
      detector_signals:
        current.detector_signals && typeof current.detector_signals === 'object'
          ? current.detector_signals
          : {},
      locked_reasons: Array.isArray(current.locked_reasons)
        ? current.locked_reasons.filter(
            (reason: unknown) => typeof reason === 'string',
          )
        : [],
    };
  }

  return defaults;
}

export function isFiscalArea(value: unknown): value is FiscalArea {
  return value === 'invoicing' || value === 'accounting' || value === 'payroll';
}

export function isFiscalStatusState(
  value: unknown,
): value is FiscalStatusState {
  return (
    value === 'INACTIVE' ||
    value === 'WIP' ||
    value === 'ACTIVE' ||
    value === 'LOCKED'
  );
}

export function isFiscalWizardStep(
  value: unknown,
): value is FiscalWizardStepId {
  return (
    value === 'area_selection' ||
    value === 'legal_data' ||
    value === 'dian_config' ||
    value === 'puc' ||
    value === 'accounting_period' ||
    value === 'default_taxes' ||
    value === 'accounting_mappings' ||
    value === 'initial_inventory' ||
    value === 'payroll_config' ||
    value === 'validation'
  );
}
