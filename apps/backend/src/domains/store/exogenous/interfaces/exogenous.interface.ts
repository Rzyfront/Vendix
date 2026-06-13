export interface ExogenousValidationError {
  type: 'missing_nit' | 'missing_name' | 'incomplete_data';
  resource: string;
  resource_id: number;
  detail: string;
}

export interface ExogenousStats {
  total_reports: number;
  by_status: Record<string, number>;
  formats_generated: string[];
}

export interface ExogenousLineData {
  third_party_nit: string;
  third_party_name: string;
  third_party_dv?: string;
  concept_code: string;
  payment_amount: number;
  tax_amount: number;
  withholding_amount: number;
  /**
   * Rol de la retención que originó la línea (trazabilidad):
   * - 'practiced': retención que la empresa practicó a un proveedor (Formato 1001).
   * - 'suffered': retención que un cliente agente retenedor practicó a la empresa (Formato 1003).
   */
  role?: 'practiced' | 'suffered';
  line_data?: Record<string, any>;
}
