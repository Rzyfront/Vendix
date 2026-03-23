export interface WithholdingConcept {
  id: number;
  code: string;
  name: string;
  rate: number;
  min_uvt_threshold: number;
  applies_to: string;
  supplier_type_filter: string;
  is_active: boolean;
  created_at: string;
}

export interface UvtValue {
  id: number;
  year: number;
  value_cop: number;
}

export interface WithholdingStats {
  active_concepts: number;
  current_uvt: number;
  month_withholdings: number;
  year_withholdings: number;
}

export interface CreateConceptDto {
  code: string;
  name: string;
  rate: number;
  min_uvt_threshold: number;
  applies_to: string;
  supplier_type_filter?: string;
}
