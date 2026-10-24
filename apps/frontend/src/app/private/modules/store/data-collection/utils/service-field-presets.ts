import { EntityType, FieldType } from '../interfaces/metadata-field.interface';

/**
 * Campos típicos para recibir un servicio en una estación. Los de cliente
 * (`customer: true`) se guardan en el perfil del cliente y se prellenan la
 * próxima vez; el resto queda en la atención. Placa y marca van primero: con
 * ellas se arma el nombre de lo atendido ("ABC123 · Yamaha NMAX").
 */
export interface ServiceFieldPreset {
  field_key: string;
  label: string;
  field_type: FieldType;
  hint: string;
  options?: string[];
  customer?: boolean;
  is_required?: boolean;
}

export const SERVICE_FIELD_PRESETS: Record<string, ServiceFieldPreset> = {
  placa: { field_key: 'placa', label: 'Placa', field_type: 'text', hint: 'Texto · ej. ABC123' },
  marca_modelo: { field_key: 'marca_modelo', label: 'Marca y modelo', field_type: 'text', hint: 'Texto · ej. Yamaha NMAX' },
  anio: { field_key: 'anio', label: 'Año', field_type: 'number', hint: 'Número' },
  color: { field_key: 'color', label: 'Color', field_type: 'text', hint: 'Texto' },
  kilometraje: { field_key: 'kilometraje', label: 'Kilometraje', field_type: 'number', hint: 'Número' },
  serial_imei: { field_key: 'serial_imei', label: 'Serial / IMEI', field_type: 'text', hint: 'Texto · para celulares y equipos' },
  nivel_combustible: { field_key: 'nivel_combustible', label: 'Nivel de combustible', field_type: 'select', hint: 'Lista', options: ['Reserva', '1/4', '1/2', '3/4', 'Lleno'] },
  clave_desbloqueo: { field_key: 'clave_desbloqueo', label: 'Clave o patrón de desbloqueo', field_type: 'text', hint: 'Texto' },
  estilo_deseado: { field_key: 'estilo_deseado', label: 'Estilo o corte deseado', field_type: 'text', hint: 'Texto · ej. fade medio' },
  alergias: { field_key: 'alergias', label: 'Alergias o sensibilidades', field_type: 'textarea', hint: 'Texto largo' },
  motivo_ingreso: { field_key: 'motivo_ingreso', label: 'Falla o motivo del ingreso', field_type: 'textarea', hint: 'Texto largo' },
  estado_recepcion: { field_key: 'estado_recepcion', label: 'Estado en que se recibe', field_type: 'textarea', hint: 'Golpes, rayones, faltantes…' },
  accesorios: { field_key: 'accesorios', label: 'Accesorios entregados', field_type: 'textarea', hint: 'Cargador, casco, llaves…' },
  autoriza_adicionales: { field_key: 'autoriza_adicionales', label: 'Autoriza trabajos adicionales', field_type: 'checkbox', hint: 'Casilla' },
  nombre_cliente: { field_key: 'nombre_cliente', label: 'Nombre completo', field_type: 'text', hint: 'Texto', customer: true },
  tipo_documento: { field_key: 'tipo_documento', label: 'Tipo de documento', field_type: 'select', hint: 'Lista', options: ['CC', 'NIT', 'CE', 'Pasaporte', 'TI'], customer: true },
  numero_documento: { field_key: 'numero_documento', label: 'Número de documento', field_type: 'text', hint: 'Texto', customer: true },
  correo: { field_key: 'correo', label: 'Correo', field_type: 'email', hint: 'Correo electrónico', customer: true },
  telefono: { field_key: 'telefono', label: 'Teléfono / WhatsApp', field_type: 'phone', hint: 'Teléfono', customer: true },
  direccion: { field_key: 'direccion', label: 'Dirección', field_type: 'text', hint: 'Texto', customer: true },
  fecha_nacimiento: { field_key: 'fecha_nacimiento', label: 'Fecha de nacimiento', field_type: 'date', hint: 'Fecha', customer: true },
};

/** Grupos del panel "Campos sugeridos" del editor. */
export const SERVICE_FIELD_GROUPS: Array<{ title: string; keys: string[] }> = [
  { title: 'Vehículo o equipo', keys: ['placa', 'marca_modelo', 'anio', 'color', 'kilometraje', 'serial_imei', 'nivel_combustible', 'clave_desbloqueo'] },
  { title: 'Atención', keys: ['motivo_ingreso', 'estado_recepcion', 'accesorios', 'autoriza_adicionales', 'estilo_deseado', 'alergias'] },
  { title: 'Cliente (se guarda en su perfil)', keys: ['nombre_cliente', 'tipo_documento', 'numero_documento', 'correo', 'telefono', 'direccion', 'fecha_nacimiento'] },
];

/**
 * Sección "Datos del cliente" con la que nace toda plantilla de estación. Es
 * editable: se pueden quitar campos o agregar otros. Se guarda en el perfil del
 * cliente, así que la próxima visita sale prellenada.
 */
export const DEFAULT_CUSTOMER_SECTION = {
  title: 'Datos del cliente',
  keys: ['nombre_cliente', 'tipo_documento', 'numero_documento', 'telefono', 'correo'],
};

export type StationTemplateType = 'carro' | 'moto' | 'celular' | 'barberia' | 'peluqueria' | 'salon_belleza' | 'general';

/** Tipos de estación al diseñar una plantilla: cada uno arranca con sus campos (editables). */
export const STATION_TEMPLATE_TYPES: Array<{ value: StationTemplateType; label: string; icon: string; keys: string[]; required: string[] }> = [
  { value: 'carro', label: 'Carro / Automóvil', icon: 'car', keys: ['placa', 'marca_modelo', 'kilometraje', 'nivel_combustible', 'motivo_ingreso', 'estado_recepcion'], required: ['placa'] },
  { value: 'moto', label: 'Moto', icon: 'bike', keys: ['placa', 'marca_modelo', 'kilometraje', 'motivo_ingreso', 'accesorios'], required: ['placa'] },
  { value: 'celular', label: 'Celulares / Electrónica', icon: 'smartphone', keys: ['marca_modelo', 'serial_imei', 'clave_desbloqueo', 'motivo_ingreso', 'accesorios', 'estado_recepcion'], required: ['marca_modelo', 'motivo_ingreso'] },
  { value: 'barberia', label: 'Barbería', icon: 'scissors', keys: ['estilo_deseado', 'alergias'], required: [] },
  { value: 'peluqueria', label: 'Peluquería', icon: 'scissors', keys: ['estilo_deseado', 'alergias'], required: [] },
  { value: 'salon_belleza', label: 'Salón de belleza / Spa', icon: 'sparkles', keys: ['estilo_deseado', 'alergias'], required: [] },
  { value: 'general', label: 'Otro / General', icon: 'clipboard-list', keys: ['motivo_ingreso'], required: [] },
];

/** Entidad donde se guarda cada campo: cliente → perfil; resto → la entidad de la plantilla. */
export function presetEntityType(preset: ServiceFieldPreset, templateEntity: EntityType): EntityType {
  return preset.customer ? 'customer' : templateEntity;
}
