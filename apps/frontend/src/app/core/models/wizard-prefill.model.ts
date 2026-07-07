import { FiscalWizardStepId } from './fiscal-status.model';

/**
 * Shape of `GET /:scope/settings/fiscal-status/wizard-prefill`.
 *
 * Each section mirrors a wizard step's prefill source-of-truth. The backend
 * builds the payload in a single read-only pass and tolerates half-configured
 * tenants by returning `null` for missing sections (and omitting the
 * corresponding step from `satisfied_steps`).
 *
 * Frontend step components should treat these as authoritative for initial
 * form values, instead of issuing their own N+1 GETs.
 */
export interface WizardPrefillLegalData {
  organization_id: number;
  legal_name: string | null;
  tax_id: string | null;
  nit: string | null;
  nit_dv: string | null;
  /** Document type ('NIT'/'CC'/'CE'/...) from DIAN config or `fiscal_data.nit_type`. */
  nit_type: string | null;
  fiscal_address: {
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    postal_code: string | null;
  } | null;
  fiscal_regime: string | null;
  ciiu: string | null;
  tax_responsibilities: string[] | null;
  tax_scheme: string | null;
  /** Person type ('NATURAL'/'JURIDICA') from `fiscal_data.person_type`. */
  person_type: string | null;
}

export interface WizardPrefillDianConfig {
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

export interface WizardPrefillPuc {
  exists: boolean;
  total_accounts: number;
  postable_accounts: number;
}

export interface WizardPrefillAccountingPeriod {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
}

export interface WizardPrefillDefaultTaxes {
  total_categories: number;
  total_rates: number;
  categories: Array<{
    id: number;
    name: string;
    rates: number;
    /**
     * Real percentage of the tax rate (frozen contract). `null` when the
     * backend could not resolve a percentage for the category.
     */
    rate: number | null;
    /**
     * Fiscal tax classification ('iva' | 'inc' | 'ica' | 'withholding').
     * `null` when the category has not been classified yet.
     */
    tax_type: string | null;
  }>;
}

export interface WizardPrefillAccountingMappings {
  total: number;
  mapped_keys: string[];
}

export interface WizardPrefillInitialInventory {
  /**
   * Legacy flag: true when at least one `inventory_transactions` row with
   * `type='initial'` already exists. Kept for backward compatibility with
   * tenants that captured an initial balance through the inventory flow
   * itself (not the fiscal wizard). The fiscal wizard considers the step
   * complete when `costing_configured` is true.
   */
  configured: boolean;
  initial_transactions: number;
  /**
   * Raw configured costing method from `settings.inventory.costing_method`
   * (`weighted_average`/`cpp`/`fifo`); `null` when unset. Scope-aware on the
   * backend. The step maps it to the form's CostingMethod enum.
   */
  costing_method: string | null;
  /**
   * True when `costing_method` is set in the scope-aware settings row.
   * This is the criterion the backend's activation guard uses — the
   * wizard's initial-inventory step only persists the costing method,
   * so this flag is the authoritative "is this step done from the
   * wizard's perspective?" signal. Optional for backward compatibility
   * with older prefill snapshots that didn't expose it (the backend
   * falls back to the legacy `configured` flag in that case).
   */
  costing_configured?: boolean;
}

export interface WizardPrefillPayrollConfig {
  /**
   * Legacy flag: true when `settings.payroll.enabled === true`. Kept for
   * backward compatibility with legacy tenants that explicitly wrote this
   * flag. The fiscal wizard's payroll step persists `payroll.minimal`
   * (frequency + parafiscales) instead, NOT `enabled`. The activation
   * guard now trusts `has_minimal`; this field is informational.
   */
  enabled: boolean;
  config: Record<string, unknown> | null;
  defaults_year: number | null;
  /**
   * True when the wizard's payroll step has persisted a `payroll.minimal`
   * block with a real `payment_frequency` value. This is the criterion
   * the backend's activation guard uses so a tenant that walked through
   * the wizard and picked "Mensual + todas las parafiscales" is correctly
   * recognized as payroll-ready. Optional for backward compatibility.
   */
  has_minimal?: boolean;
}

export interface WizardPrefill {
  organization_id: number;
  store_id: number | null;
  fiscal_scope: 'STORE' | 'ORGANIZATION';
  legal_data: WizardPrefillLegalData | null;
  dian_config: WizardPrefillDianConfig | null;
  puc: WizardPrefillPuc | null;
  accounting_period: WizardPrefillAccountingPeriod | null;
  default_taxes: WizardPrefillDefaultTaxes | null;
  accounting_mappings: WizardPrefillAccountingMappings | null;
  initial_inventory: WizardPrefillInitialInventory | null;
  payroll_config: WizardPrefillPayrollConfig | null;
  satisfied_steps: FiscalWizardStepId[];
}
