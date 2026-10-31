export type FieldType = 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'textarea' | 'file' | 'email' | 'phone' | 'url';
export type EntityType = 'customer' | 'booking' | 'order' | 'service_session';

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  customer: 'Cliente',
  booking: 'Reserva',
  order: 'Orden',
  service_session: 'Atención de servicio',
};
export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Texto corto',
  number: 'Número',
  date: 'Fecha',
  select: 'Lista de opciones',
  checkbox: 'Casilla (sí / no)',
  textarea: 'Texto largo',
  file: 'Archivo',
  email: 'Correo electrónico',
  phone: 'Teléfono',
  url: 'Enlace (URL)',
};
export const DISPLAY_MODE_LABELS: Record<string, string> = { detail: 'Detalle', summary: 'Resumen' };
export type DisplayMode = 'summary' | 'detail';

export interface MetadataField {
  id: number;
  store_id: number;
  entity_type: EntityType;
  field_key: string;
  field_type: FieldType;
  label: string;
  description?: string;
  is_required: boolean;
  display_mode: DisplayMode;
  sort_order: number;
  options?: Record<string, any>;
  default_value?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MetadataValue {
  id: number;
  store_id: number;
  field_id: number;
  entity_type: EntityType;
  entity_id: number;
  value_text?: string;
  value_number?: number;
  value_date?: string;
  value_bool?: boolean;
  value_json?: any;
  field?: MetadataField;
  created_at: string;
  updated_at: string;
}

export interface MetadataFieldWithValue extends MetadataField {
  value?: MetadataValue;
  display_value?: string;
}
