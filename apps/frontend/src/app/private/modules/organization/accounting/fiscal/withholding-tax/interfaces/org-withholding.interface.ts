import {
  WithholdingConcept,
  CreateConceptDto,
} from '../../../../../store/withholding-tax/interfaces/withholding.interface';

export type {
  WithholdingType,
  WithholdingStats,
} from '../../../../../store/withholding-tax/interfaces/withholding.interface';

/**
 * Supplier-type filter that scopes a withholding concept to a specific kind of
 * counterparty ("el QUIEN"). `any` applies to every supplier/customer.
 */
export type SupplierTypeFilter =
  | 'any'
  | 'gran_contribuyente'
  | 'regimen_simple'
  | 'persona_natural';

/**
 * Organization-scoped withholding concept.
 *
 * The store base shape already carries the fiscal-typing fields
 * (`withholding_type`, `supplier_type_filter`, `account_code`); the org module
 * reuses it directly so both sides stay in sync (no duplicate model).
 */
export type OrgWithholdingConcept = WithholdingConcept;

/**
 * Create/update payload for an org withholding concept. Mirrors the backend
 * DTO (Bloque B): code, name, rate (fraction), min_uvt_threshold, applies_to,
 * supplier_type_filter, withholding_type, account_code (optional PUC), and the
 * org-scoped `is_active` flag for create/update.
 */
export interface OrgCreateConceptDto extends CreateConceptDto {
  is_active?: boolean;
}
