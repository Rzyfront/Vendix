import { print_format_type_enum } from '@prisma/client';

export type PrintFormatType = print_format_type_enum;

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
