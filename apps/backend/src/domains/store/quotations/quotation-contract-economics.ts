import {
  calculateProfileContractEconomics,
  ProfileContractCostLine,
  ProfileContractEconomicsResult,
  ProfileContractInvoiceLine,
} from '../invoicing/profiles/profile-contract-economics';
import { InvoiceProfileConfig } from '../invoicing/profiles/invoice-profile-config.contract';
import { QuotationProfileConfig } from '../backend-quotations-profiles/quotation-profile-config';

export interface FrozenInvoiceProfile {
  profile_id: number;
  version: number;
  name: string;
  config: InvoiceProfileConfig;
}

export interface FrozenQuotationProfile {
  profile_id: number;
  version: number;
  config: QuotationProfileConfig;
}

/** Durable, replayable economics attached to a contract-destination quote. */
export interface QuotationContractEconomicSnapshot {
  schema_version: 1;
  frozen_at: string;
  invoice_profile: FrozenInvoiceProfile;
  quotation_profile: FrozenQuotationProfile | null;
  contract_object: string;
  due_date: string | null;
  aiu_value: string;
  direct_cost: string;
  contract_value: string;
  invoice_lines: ProfileContractInvoiceLine[];
  calculation: ProfileContractEconomicsResult['calculation'];
}

export interface BuildQuotationContractEconomicsInput {
  frozen_at: string;
  invoice_profile: FrozenInvoiceProfile;
  quotation_profile: FrozenQuotationProfile | null;
  contract_object?: string | null;
  due_date?: string | null;
  aiu_value?: string | number;
  cost_lines: readonly ProfileContractCostLine[];
}

/**
 * The only quotation-domain adapter to the canonical invoice-profile contract
 * calculator. It freezes the selected immutable profile version alongside the
 * calculator output; callers must never rebuild an existing snapshot from a
 * live profile unless an explicit replacement profile was selected.
 */
export function buildQuotationContractEconomicSnapshot(
  input: BuildQuotationContractEconomicsInput,
): QuotationContractEconomicSnapshot {
  const economics = calculateProfileContractEconomics(
    input.invoice_profile.config,
    input.cost_lines,
    input.aiu_value,
  );
  const profileObject = input.invoice_profile.config.aiu?.contract_object ?? '';

  return {
    schema_version: 1,
    frozen_at: input.frozen_at,
    invoice_profile: input.invoice_profile,
    quotation_profile: input.quotation_profile,
    contract_object:
      input.contract_object?.trim() || profileObject.trim(),
    due_date: input.due_date ?? null,
    aiu_value: economics.aiu_value,
    direct_cost: economics.direct_cost,
    contract_value: economics.contract_value,
    invoice_lines: economics.invoice_lines,
    calculation: economics.calculation,
  };
}
