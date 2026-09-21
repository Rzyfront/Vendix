/**
 * Row representation for the "Cuentas por Pagar a Proveedores por Edades (Aging)" report (QUI-542).
 * All numbers and dates are RAW (unformatted numbers, Date objects, no hardcoded currency symbols).
 */
export interface PayableAgingRow {
  supplier_id: number;
  supplier_name: string;
  supplier_document: string;
  total_paid: number;
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_over_90: number;
  total_outstanding: number;
  last_payment_date: Date | null;
}

export interface PayableAgingTotals {
  total_paid: number;
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_over_90: number;
  total_outstanding: number;
}
