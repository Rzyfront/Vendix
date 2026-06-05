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
  fiscal_address: {
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    postal_code: string | null;
  } | null;
  fiscal_regime: string | null;
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
  categories: Array<{ id: number; name: string; rates: number }>;
}

export interface WizardPrefillAccountingMappings {
  total: number;
  mapped_keys: string[];
}

export interface WizardPrefillInitialInventory {
  configured: boolean;
  initial_transactions: number;
}

export interface WizardPrefillPayrollConfig {
  enabled: boolean;
  config: Record<string, unknown> | null;
  defaults_year: number | null;
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
