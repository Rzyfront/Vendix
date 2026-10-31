import { MetadataField } from './metadata-field.interface';

export type TemplateStatus = 'active' | 'inactive' | 'archived';

export interface TemplateItem {
  id: number;
  section_id: number;
  metadata_field_id: number;
  sort_order: number;
  is_required: boolean;
  include_in_summary?: boolean;
  help_text?: string;
  placeholder?: string;
  validation_rules?: Record<string, any>;
  width?: string;
  icon?: string;
  metadata_field: MetadataField;
}

export interface TemplateSection {
  id: number;
  template_id: number;
  tab_id?: number;
  parent_section_id?: number;
  title: string;
  description?: string;
  icon?: string;
  sort_order: number;
  items: TemplateItem[];
  child_sections?: TemplateSection[];
}

export interface TemplateTab {
  id: number;
  template_id: number;
  title: string;
  icon?: string;
  sort_order: number;
  sections: TemplateSection[];
}

export interface DataCollectionTemplate {
  id: number;
  store_id: number;
  name: string;
  description?: string;
  icon?: string;
  status: TemplateStatus;
  entity_type: string;
  /** Tipo de estación para el que se diseñó (plantillas de atención). */
  station_type?: string | null;
  /** Bloques fijos de la recepción que la plantilla muestra (servicio y técnico van siempre). */
  checkin_show_budget?: boolean;
  checkin_show_products?: boolean;
  checkin_show_notes?: boolean;
  is_default: boolean;
  tabs?: TemplateTab[];
  sections: TemplateSection[];
  products?: { product: { id: number; name: string; slug: string } }[];
  created_at: string;
  updated_at: string;
}
