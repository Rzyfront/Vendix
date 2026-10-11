import type { ContractSnapshot } from './contract-snapshot.interface';

/**
 * C.2 (FB-07, ERR-06): ficha de contrato de obra y sus estados.
 *
 * El backend de contratos llega con C.1 (POST /store/contracts/from-quotation/:id);
 * esta interfaz es el espejo frontend del contrato que ese step crea:
 * numero propio por store, snapshot AIU congelado, trazabilidad a cotizacion
 * y factura. Todos los campos salvo identidad/estado son opcionales a proposito:
 * la ficha debe pintar sin pantalla en blanco aunque el backend evolucione.
 */

/** `invoiced` is a read-only fiscal-derived status, never an administrative target. */
export type ContractStatus = 'draft' | 'active' | 'invoiced' | 'cancelled';

/** Codigo de error de transicion invalida (ERR-06, HTTP 422). */
export const CONTRACT_STATUS_ERROR_CODE = 'CONTRACT_STATUS_001';

/** Codigo de factura duplicada (D.2, HTTP 409): el contrato ya tiene factura AIU. */
export const CONTRACT_INVOICE_ERROR_CODE = 'CONTRACT_INVOICE_001';

/** Only administrative targets are writable; invoiced derives from DIAN acceptance. */
export type ContractTransitionTarget = 'active' | 'cancelled';

export const CONTRACT_TRANSITIONS: Record<ContractStatus, ContractTransitionTarget[]> = {
  draft: ['active', 'cancelled'],
  active: ['cancelled'],
  invoiced: [],
  cancelled: [],
};

/** Etiquetas en espanol para la ficha y los botones de transicion. */
export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: 'Borrador',
  active: 'Vigente',
  invoiced: 'Facturado',
  cancelled: 'Cancelado',
};

export function isValidContractTransition(from: ContractStatus, to: ContractTransitionTarget): boolean {
  return CONTRACT_TRANSITIONS[from]?.includes(to) ?? false;
}
/**
 * D.2 (FB-08/FB-09): el boton "Generar factura AIU" solo existe en contrato
 * vigente sin factura ligada. Cualquier otro estado muestra enlace o texto
 * informativo, nunca el boton.
 */
export function canGenerateContractInvoice(
  status: ContractStatus,
  invoice: ContractInvoiceRef | null | undefined,
  hasEconomicSnapshot: boolean,
): boolean {
  return status === 'active' && hasEconomicSnapshot && (invoice === null || invoice === undefined);
}

export interface ContractQuotationRef {
  id: number;
  quotation_number: string;
  status?: string;
  grand_total?: number;
}

export interface ContractInvoiceRef {
  id: number;
  invoice_number?: string;
  status?: string;
  total?: number;
  total_amount?: number | null;
  dian_status?: string | null;
}

export interface ContractLineView {
  product_name: string;
  quantity: number | null;
  unit_price: number | null;
  discount_amount: number | null;
  tax_rate: number | null;
  tax_amount_item: number | null;
  total_price: number | null;
  notes: string | null;
}

export interface ContractEconomicTaxView {
  tax_name: string;
  tax_type: string | null;
  tax_rate: number | null;
  rate_basis: string | null;
  tax_amount: number | null;
}

export interface ContractEconomicLineView {
  description: string;
  bucket: string | null;
  quantity: number | null;
  unit_price: number | null;
  discount_amount: number | null;
  base_amount: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  taxes: ContractEconomicTaxView[];
}

export interface ContractEconomicTotalsView {
  gross_subtotal: number | null;
  discount_amount: number | null;
  total_before_tax: number | null;
  tax_amount: number | null;
  tax_iva: number | null;
  tax_inc: number | null;
  tax_ica: number | null;
  tax_other: number | null;
  total_amount: number | null;
}

export interface ContractEconomicComponentView {
  component: string;
  amount: number | null;
}

export interface ContractProfileView {
  profile_id: number | null;
  version: number | null;
  name: string | null;
  config: Record<string, unknown> | null;
  taxable_basis: string | null;
  components_basis: string | null;
  accounting_model: string | null;
  components: Record<string, number | null> | null;
}

export interface ContractQuotationProfileView {
  profile_id: number | null;
  version: number | null;
  config: Record<string, unknown> | null;
}

export interface ContractEconomicView {
  schema_version: number;
  contract_object: string | null;
  direct_cost: number | null;
  contract_value: number | null;
  aiu_value: number | null;
  invoice_profile: ContractProfileView | null;
  quotation_profile: ContractQuotationProfileView | null;
  invoice_lines: ContractEconomicLineView[];
  totals: ContractEconomicTotalsView | null;
  aiu: {
    contract_value: number | null;
    aiu_value: number | null;
    taxable_base: number | null;
    minimum_base: number | null;
    components: ContractEconomicComponentView[];
  } | null;
}

export interface Contract {
  id: number;
  store_id: number;
  contract_number: string;
  status: ContractStatus;
  quotation_id: number;
  /** Objeto/alcance del contrato (snapshot congelado en C.1). */
  contract_object?: string | null;
  /** A/I/U values from the frozen invoice profile, never the quotation terms profile. */
  administration_percentage?: number | null;
  contingency_percentage?: number | null;
  profit_percentage?: number | null;
  subtotal_amount?: number | null;
  tax_amount?: number | null;
  grand_total?: number | null;
  notes?: string | null;
  discount_amount?: number | null;
  terms_and_conditions?: string | null;
  valid_until?: string | null;
  snapshot?: ContractSnapshot | null;
  economic?: ContractEconomicView | null;
  items?: ContractLineView[];
  /** These legacy ids identify the quotation terms profile. */
  profile_id?: number | null;
  profile_version?: number | null;
  quotation_profile?: ContractQuotationProfileView | null;
  /** Frozen invoice profile used by the economic snapshot. */
  profile?: ContractProfileView | null;
  administrative_status?: ContractStatus | null;
  created_at: string | null;
  updated_at: string | null;
  /** Trazabilidad al documento origen (cotizacion aceptada-contrato). */
  quotation?: ContractQuotationRef | null;
  /** Trazabilidad a la factura AIU (la crea D.1/D.2 desde el vigente). */
  invoice?: ContractInvoiceRef | null;
}

export interface ContractStatusTransitionDto {
  status: ContractTransitionTarget;
}

export interface PaginatedContractsResponse {
  data: Contract[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
