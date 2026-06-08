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
  /**
   * True once the org/store has captured a fiscal identity (e.g. through the
   * onboarding wizard `fiscal_data` step). Pure detection signal: it never
   * activates the fiscal gate by itself — `state` stays untouched.
   */
  has_fiscal_identity?: boolean;
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

export interface FiscalWizardPrefillLegalData {
  organization_id: number;
  legal_name: string | null;
  tax_id: string | null;
  nit: string | null;
  nit_dv: string | null;
  /** Document type (NIT/CC/CE/…), DIAN config if present else `fiscal_data.nit_type`. */
  nit_type: string | null;
  fiscal_address: {
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    postal_code: string | null;
  } | null;
  /** Tax regime, mapped from `store_settings.fiscal_data.tax_regime`. */
  fiscal_regime: string | null;
  /** CIIU economic activity code, from `fiscal_data.ciiu`. */
  ciiu: string | null;
  /** DIAN tax responsibilities (responsabilidades), from `fiscal_data.tax_responsibilities`. */
  tax_responsibilities: string[] | null;
  /** DIAN issuer tax scheme code (TaxLevelCode: O-13/O-15/R-99-PN…), from `fiscal_data.tax_scheme`. */
  tax_scheme: string | null;
  /** Person type NATURAL/JURIDICA, from `fiscal_data.person_type`. */
  person_type: string | null;
}

export interface FiscalWizardPrefillDianConfig {
  id: number;
  name: string;
  nit: string;
  nit_type: string;
  nit_dv: string | null;
  environment: string;
  operation_mode: string;
  enablement_status: string;
  configuration_type: string;
  is_default: boolean;
  has_certificate: boolean;
  certificate_expiry: string | null;
}

export interface FiscalWizardPrefillPuc {
  exists: boolean;
  total_accounts: number;
  postable_accounts: number;
}

export interface FiscalWizardPrefillAccountingPeriod {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
}

export interface FiscalWizardPrefillDefaultTaxes {
  total_categories: number;
  total_rates: number;
  categories: Array<{ id: number; name: string; rates: number }>;
}

export interface FiscalWizardPrefillAccountingMappings {
  total: number;
  mapped_keys: string[];
}

export interface FiscalWizardPrefillInitialInventory {
  /**
   * Legacy flag: true when at least one `inventory_transactions` row with
   * `type='initial'` already exists. Kept for backward compatibility with
   * older tenants that already moved past the initial-balance capture.
   * New satisfaction check should rely on `costing_configured` instead —
   * the wizard's initial-inventory step only persists the costing method
   * and never creates initial transactions on its own.
   */
  configured: boolean;
  initial_transactions: number;
  /**
   * Configured inventory costing method, read scope-aware from
   * `settings.inventory.costing_method` (organization_settings when
   * fiscal_scope is ORGANIZATION, store_settings by store_id when STORE).
   * Raw settings value (`weighted_average`/`cpp`/`fifo`); `null` when unset.
   */
  costing_method: string | null;
  /**
   * True when the wizard's initial-inventory step can be considered
   * complete from the wizard's own output: the tenant has picked a
   * costing method in settings. This is the criterion the activation
   * guard uses (see `deriveSatisfiedSteps`) so the wizard and the
   * backend agree on what "configured" means.
   */
  costing_configured: boolean;
}

export interface FiscalWizardPrefillPayrollConfig {
  /**
   * Legacy flag: true when `settings.payroll.enabled === true`. Kept for
   * backward compatibility with any legacy row that already wrote this
   * flag. The activation guard no longer trusts it: the payroll wizard
   * step persists `settings.payroll.minimal` (frequency + parafiscales),
   * not `enabled`. Use `has_minimal` for the activation check.
   */
  enabled: boolean;
  config: Record<string, unknown> | null;
  defaults_year: number | null;
  /**
   * True when the wizard's payroll step has persisted a `payroll.minimal`
   * block with a real `payment_frequency` value. This is the criterion
   * the activation guard uses so a tenant that walked through the wizard
   * and picked "Mensual + todas las parafiscales" is correctly recognized
   * as payroll-ready — regardless of the (unset) `enabled` flag.
   */
  has_minimal: boolean;
}

export interface FiscalWizardPrefill {
  organization_id: number;
  store_id: number | null;
  fiscal_scope: 'STORE' | 'ORGANIZATION';
  legal_data: FiscalWizardPrefillLegalData | null;
  dian_config: FiscalWizardPrefillDianConfig | null;
  puc: FiscalWizardPrefillPuc | null;
  accounting_period: FiscalWizardPrefillAccountingPeriod | null;
  default_taxes: FiscalWizardPrefillDefaultTaxes | null;
  accounting_mappings: FiscalWizardPrefillAccountingMappings | null;
  initial_inventory: FiscalWizardPrefillInitialInventory | null;
  payroll_config: FiscalWizardPrefillPayrollConfig | null;
  satisfied_steps: FiscalWizardStepId[];
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
