export type InvoiceType =
  | 'sales_invoice'
  | 'purchase_invoice'
  | 'credit_note'
  | 'debit_note'
  | 'export_invoice';

export type InvoiceStatus =
  | 'draft'
  | 'validated'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'voided';

export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  tax_amount: number;
  total: number;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  invoice_type: InvoiceType;
  customer_name?: string;
  customer_id?: string;
  total_amount: number;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  issue_date: string;
  status: InvoiceStatus;
  items?: InvoiceItem[];
  created_at: string;
}

export interface InvoiceStats {
  total: number;
  totalAmount: number;
  pending: number;
  pendingAmount: number;
  accepted: number;
  acceptedAmount: number;
  rejected: number;
}

export interface Resolution {
  id: string;
  prefix: string;
  start_number: number;
  end_number: number;
  current_number: number;
  start_date: string;
  end_date: string;
  state: 'active' | 'expired';
}

export interface DianConfig {
  enabled: boolean;
  test_mode: boolean;
  software_id?: string;
  pin?: string;
  certificate?: string;
}

export interface InvoiceQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: InvoiceStatus;
  type?: InvoiceType;
}

export interface CreateInvoiceDto {
  customer_id?: string;
  items: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    tax_amount: number;
  }>;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
}

export interface CreateResolutionDto {
  prefix: string;
  start_number: number;
  end_number: number;
  start_date: string;
  end_date: string;
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Borrador',
  validated: 'Validada',
  sent: 'Enviada',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  cancelled: 'Cancelada',
  voided: 'Anulada',
};

export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  sales_invoice: 'Factura de Venta',
  purchase_invoice: 'Factura de Compra',
  credit_note: 'Nota Crédito',
  debit_note: 'Nota Débito',
  export_invoice: 'Factura de Exportación',
};

export const INVOICE_STATUS_VARIANT: Record<
  InvoiceStatus,
  'default' | 'success' | 'warning' | 'error' | 'info'
> = {
  draft: 'default',
  validated: 'info',
  sent: 'warning',
  accepted: 'success',
  rejected: 'error',
  cancelled: 'default',
  voided: 'default',
};
