export enum LegalDocumentTypeEnum {
  TERMS_OF_SERVICE = 'TERMS_OF_SERVICE',
  PRIVACY_POLICY = 'PRIVACY_POLICY',
  REFUND_POLICY = 'REFUND_POLICY',
  SHIPPING_POLICY = 'SHIPPING_POLICY',
  RETURN_POLICY = 'RETURN_POLICY',
  COOKIES_POLICY = 'COOKIES_POLICY',
  MERCHANT_AGREEMENT = 'MERCHANT_AGREEMENT',
}

export interface LegalDocument {
  id: number;
  document_type: LegalDocumentTypeEnum;
  title: string;
  version: string;
  content: string;
  description?: string;
  effective_date: string; // ISO Date
  expiry_date?: string; // ISO Date
  document_url?: string;
  is_active: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateSystemDocumentDto {
  document_type: LegalDocumentTypeEnum;
  title: string;
  version: string;
  content: string;
  description?: string;
  effective_date: string;
  expiry_date?: string;
  document_url?: string;
}

export interface UpdateSystemDocumentDto {
  title?: string;
  content?: string;
  description?: string;
  effective_date?: string;
  expiry_date?: string;
  document_url?: string;
}

export interface DocumentStats {
  total_users: number;
  total_acceptances: number;
  acceptance_rate: number;
  by_version: {
    acceptance_version: string;
    _count: { acceptance_version: number };
  }[];
}
