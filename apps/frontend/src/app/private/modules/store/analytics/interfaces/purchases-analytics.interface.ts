/**
 * Interfaces para la analítica de compras y cuentas por pagar a proveedores.
 */

export interface PayableAgingRow {
  supplier_id: number;
  supplier_name: string;
  supplier_document: string;
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_over_90: number;
  total_outstanding: number;
  last_payment_date: string | null;
}

export interface PayableAgingTotals {
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_over_90: number;
  total_outstanding: number;
}

export interface PayableAgingQuery {
  page?: number;
  limit?: number;
  search?: string;
  as_of?: string;
  date_to?: string;
  supplier_id?: number;
}
