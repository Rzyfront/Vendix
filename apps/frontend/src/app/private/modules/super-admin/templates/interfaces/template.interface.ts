export interface Template {
  id: number;
  template_name: string;
  configuration_type: TemplateConfigType;
  template_data: Record<string, any>;
  description?: string;
  is_active: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export type TemplateConfigType =
  | 'domain'
  | 'store_settings'
  | 'ecommerce'
  | 'payment_methods'
  | 'shipping'
  | 'tax'
  | 'email'
  | 'notifications'
  | 'user_panel_ui';

export interface TemplateListItem {
  id: number;
  template_name: string;
  configuration_type: TemplateConfigType;
  template_data: Record<string, any>;
  description?: string;
  is_active: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateDto {
  template_name: string;
  configuration_type: TemplateConfigType;
  template_data: Record<string, any>;
  description?: string;
  is_active?: boolean;
  is_system?: boolean;
}

export interface UpdateTemplateDto {
  template_name?: string;
  configuration_type?: TemplateConfigType;
  template_data?: Record<string, any>;
  description?: string;
  is_active?: boolean;
}

export interface TemplateQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  configuration_type?: TemplateConfigType;
  is_active?: boolean;
  is_system?: boolean;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface TemplateStats {
  totalTemplates: number;
  activeTemplates: number;
  systemTemplates: number;
  customTemplates: number;
  templatesByType: Record<string, number>;
  recentTemplates: Array<{
    id: number;
    template_name: string;
    configuration_type: TemplateConfigType;
    created_at: string;
  }>;
}
