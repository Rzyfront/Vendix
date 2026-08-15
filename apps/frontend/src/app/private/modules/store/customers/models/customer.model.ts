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

export interface Customer {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    legal_name?: string | null;
    phone?: string | null;
    document_type?: string | null;
    document_number?: string | null;
    verification_digit?: string | null;
    ciiu_code?: string | null;
    fiscal_responsibilities?: string[];
    tax_regime?: TaxRegime | null;
    person_type?: PersonType | null;
    is_withholding_agent?: boolean;
    created_at?: string;
    updated_at?: string;
    total_orders?: number;
    total_spend?: number;
    last_order_date?: string;
    state?: 'active' | 'inactive';
    /** Dirección de envío primaria (backend la incluye solo en `findOne`). */
    addresses?: CustomerAddress[];
}

/** Subset de `addresses` que devuelve `GET /store/customers/:id`. */
export interface CustomerAddress {
    id: number;
    address_line1?: string | null;
    address_line2?: string | null;
    city?: string | null;
    state_province?: string | null;
    country_code?: string | null;
    postal_code?: string | null;
    phone_number?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    /**
     * Código DANE (Divipola) del municipio → `addresses.municipality_code`.
     * Opcional: toda dirección anterior a su captura lo tiene en NULL. Es el
     * dato que la facturación electrónica exige del adquiriente.
     */
    municipality_code?: string | null;
    type?: string;
    is_primary?: boolean;
}

export interface CreateCustomerRequest {
    email: string;
    first_name: string;
    last_name: string;
    legal_name?: string | null;
    phone?: string | null;
    document_type?: string | null;
    document_number?: string | null;
    verification_digit?: string | null;
    ciiu_code?: string | null;
    fiscal_responsibilities?: string[];
    tax_regime?: TaxRegime | null;
    person_type?: PersonType | null;
    is_withholding_agent?: boolean;
}

export interface UpdateCustomerRequest extends Partial<CreateCustomerRequest> { }

export interface CustomerStats {
    total_customers: number;
    active_customers: number;
    new_customers_this_month: number;
    total_revenue: number;
}

export interface CustomerFilters {
    search?: string;
    state?: 'active' | 'inactive';
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
}
