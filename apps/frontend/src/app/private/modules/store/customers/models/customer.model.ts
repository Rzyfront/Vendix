export interface Customer {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    phone?: string;
    document_type?: string;
    document_number?: string;
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
    phone?: string;
    document_type?: string;
    document_number?: string;
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
