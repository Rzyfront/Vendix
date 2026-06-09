/** Régimen tributario del cliente (clasificación fiscal "el QUIEN"). */
export type TaxRegime = 'COMUN' | 'SIMPLIFICADO' | 'GRAN_CONTRIBUYENTE';

/** Tipo de persona del cliente. */
export type PersonType = 'NATURAL' | 'JURIDICA';

export interface Customer {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    phone?: string | null;
    document_type?: string | null;
    document_number?: string | null;
    tax_regime?: TaxRegime | null;
    person_type?: PersonType | null;
    is_withholding_agent?: boolean;
    created_at?: string;
    updated_at?: string;
    total_orders?: number;
    total_spend?: number;
    last_order_date?: string;
    state?: 'active' | 'inactive';
}

export interface CreateCustomerRequest {
    email: string;
    first_name: string;
    last_name: string;
    phone?: string | null;
    document_type?: string | null;
    document_number?: string | null;
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
