export interface PosCustomerAddress {
  id: number;
  address_line1: string;
  address_line2?: string;
  city: string;
  state_province?: string;
  postal_code?: string;
  country_code: string;
  phone_number?: string;
  type: string;
  is_primary: boolean;
}

/** Régimen tributario del cliente (clasificación fiscal "el QUIEN"). Anexo 19. */
export type TaxRegime =
  | 'COMUN'
  | 'SIMPLIFICADO'
  | 'GRAN_CONTRIBUYENTE'
  | 'AUTORRETENEDOR'
  | 'ESPECIAL'
  | 'NO_APLICA';

/** Tipo de persona del cliente. */
export type PersonType = 'NATURAL' | 'JURIDICA';

export interface PosCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name?: string;
  /** Razón social (JURIDICA). El backend la devuelve; se usa en tarjetas. */
  legal_name?: string | null;
  name?: string; // For backward compatibility
  phone?: string;
  document_type?: string;
  document_number?: string;
  tax_regime?: TaxRegime | null;
  person_type?: PersonType | null;
  is_withholding_agent?: boolean;
  address?: string;
  addresses?: PosCustomerAddress[];
  created_at: Date;
  updated_at: Date;
  queueEntryId?: number;
  fromQueue?: boolean;
}

export interface CreatePosCustomerRequest {
  email: string;
  first_name: string;
  last_name?: string;
  phone?: string;
  document_type?: string;
  document_number?: string;
  tax_regime?: TaxRegime | null;
  person_type?: PersonType | null;
  is_withholding_agent?: boolean;
  /** Campos fiscales extra para el salto a creación completa (mismo endpoint). */
  legal_name?: string | null;
  verification_digit?: string | null;
  ciiu_code?: string | null;
  fiscal_responsibilities?: string[];

  password?: string;
  /**
   * QUI-734 (B.4) — resolve quick-sale por nombre. Cuando true (y sin
   * email/documento), el backend busca por nombre; >1 → ERR-03 (409);
   * 0 → crea cliente con solo first+last_name.
   */
  name_only?: boolean;
}

export interface SearchCustomersRequest {
  query?: string;
  limit?: number;
  page?: number;
}

export interface PaginatedCustomersResponse {
  data: PosCustomer[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CustomerValidationError {
  field: string;
  message: string;
}
