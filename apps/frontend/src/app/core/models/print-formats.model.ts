export type PrintFormatType =
  | 'pos_sale_ticket'
  | 'sales_order_invoice'
  | 'dispatch_note'
  | 'dispatch_ticket'
  | 'quotation'
  | 'credit_note'
  | 'purchase_order'
  | 'transfer_note'
  | 'fiscal_electronic_invoice'
  | 'fiscal_credit_note'
  | 'kitchen_ticket';

export type PrintPaperFormat =
  | 'thermal_80'
  | 'thermal_58'
  | 'a4'
  | 'letter'
  | 'half_letter';

export interface PrintPaperConfig {
  format: PrintPaperFormat;
  width_mm: number;
  is_roll: boolean;
  margin_mm: number;
  copies: number;
  orientation?: 'portrait' | 'landscape';
}

export interface PrintFieldDefinition {
  id: string;
  key: string;
  label: string;
  enabled: boolean;
  position?: 'left' | 'center' | 'right' | 'full';
  custom_label?: string;
  format?: 'text' | 'number' | 'currency' | 'date' | 'percent';
}

export interface PrintSectionDefinition {
  id: string;
  type: string;
  title: string;
  enabled: boolean;
  order: number;
  fields?: PrintFieldDefinition[];
  custom_content?: string;
}

export interface PrintColumnDefinition {
  id: string;
  key: string;
  label: string;
  enabled: boolean;
  width_percent: number;
  align: 'left' | 'center' | 'right';
  format?: 'text' | 'number' | 'currency' | 'percent';
}

export interface PrintStylesDefinition {
  font_family?: string;
  font_size_base_pt?: number;
  primary_color?: string;
  header_alignment?: 'left' | 'center' | 'right';
  show_borders?: boolean;
  compact_mode?: boolean;
  theme_tokens?: Record<string, string>;
}

export interface PrintTokenDefinition {
  token: string;
  path: string;
  description: string;
  example: string;
}

export interface PrintFormatDefinition {
  paper: PrintPaperConfig;
  sections: PrintSectionDefinition[];
  columns?: PrintColumnDefinition[];
  styles?: PrintStylesDefinition;
  tokens?: PrintTokenDefinition[];
  custom_template?: string;
}

export interface StorePrintFormatSummary {
  format_type: PrintFormatType;
  name: string;
  category: string;
  icon: string;
  engine: 'html' | 'pdf';
  is_configured: boolean;
  is_active: boolean;
  gateway_enabled: boolean;
  template_name: string;
  updated_at: string | null;
}

export interface StorePrintFormatDetail {
  format_type: PrintFormatType;
  name: string;
  category: string;
  is_active: boolean;
  gateway_enabled: boolean;
  is_customized: boolean;
  template_id: number | null;
  template_name: string | null;
  definition: PrintFormatDefinition;
  overrides: Record<string, any> | null;
  available_tokens: PrintTokenDefinition[];
}

export interface PrintTemplate {
  id: number;
  organization_id?: number | null;
  created_by?: number | null;
  format_type: PrintFormatType;
  name: string;
  description?: string | null;
  definition: PrintFormatDefinition;
  is_system: boolean;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
  author?: {
    id: number;
    first_name?: string;
    last_name?: string;
    email: string;
  };
}

export interface PrintPreviewResponse {
  html: string;
  width_mm: number;
  is_roll: boolean;
  definition: PrintFormatDefinition;
}

export interface RenderPrintDocumentResponse {
  format_type: PrintFormatType;
  html?: string;
  copies: number;
  is_roll: boolean;
  width_mm: number;
}
