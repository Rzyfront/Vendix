export interface StoreLegalDocument {
    id: number;
    document_type: string;
    title: string;
    version: string;
    content?: string;
    description?: string;
    effective_date: Date;
    expiry_date?: Date;
    is_active: boolean;
    is_system: boolean;
    document_url?: string;
    store_id?: number;
    created_at?: Date;
    updated_at?: Date;
}

export interface CreateStoreDocumentDto {
    document_type: string;
    title: string;
    version: string;
    content: string;
    description?: string;
    effective_date: string;
    expiry_date?: string;
}

export interface UpdateStoreDocumentDto {
    title?: string;
    description?: string;
    effective_date?: string;
    expiry_date?: string;
}
