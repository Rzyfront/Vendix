/**
 * Contrato del escáner IA de la habilitación DIAN.
 *
 * El endpoint `POST {store|organization}/invoicing/dian-config/scan-habilitation`
 * recibe entre 1 y 3 archivos en el campo multipart `files` (image/jpeg,
 * image/png, image/webp o application/pdf, ≤10MB cada uno) y devuelve
 * `{ success, data: DianHabilitationScanResult }`.
 *
 * Cada clave del resultado corresponde 1:1 a un control de
 * `DianConfigFormComponent`, así que el paso 3 del asistente precarga el
 * formulario sin capa de mapeo. Espejo de
 * `DianHabilitationScannerService` (backend): si allá cambia un campo, cambia
 * acá.
 */

/** Namespaces que exponen el escáner. La plataforma no lo expone. */
export type HabilitationScannerScope = 'store' | 'organization';

export type ScannedHabilitationEnvironment = 'test' | 'production';

/**
 * Un campo extraído con su veredicto.
 *
 * `verified` no significa "la IA estaba segura": significa que el valor pasó
 * una regla estructural comprobable (UUID, 4-20 dígitos, 40 hex, fecha real).
 * Un campo que falla su regla llega con `value: null` aunque el modelo lo
 * hubiera leído con confianza alta.
 */
export interface HabilitationScanField<T> {
  value: T | null;
  /** 0-100, reportada por el modelo para ese campo solo. */
  confidence: number;
  /** Pasó su regla estructural y puede precargarse. */
  verified: boolean;
  /** Por qué un humano igual tiene que mirarlo, o null. */
  warning: string | null;
}

export interface DianHabilitationScanResult {
  name: HabilitationScanField<string>;
  nit: HabilitationScanField<string>;
  nit_dv: HabilitationScanField<string>;
  environment: HabilitationScanField<ScannedHabilitationEnvironment>;
  software_id: HabilitationScanField<string>;
  software_pin: HabilitationScanField<string>;
  test_set_id: HabilitationScanField<string>;
  resolution_number: HabilitationScanField<string>;
  resolution_prefix: HabilitationScanField<string>;
  resolution_range_from: HabilitationScanField<number>;
  resolution_range_to: HabilitationScanField<number>;
  resolution_valid_from: HabilitationScanField<string>;
  resolution_valid_to: HabilitationScanField<string>;
  resolution_date: HabilitationScanField<string>;
  resolution_technical_key: HabilitationScanField<string>;
  /** 0-100 de legibilidad global reportada por el modelo. */
  confidence: number;
  /** Campos que el usuario debe confirmar a mano antes de guardar. */
  requires_manual_confirmation: string[];
  /** Campos que ninguno de los documentos alcanzó a llenar. */
  missing_fields: string[];
  extraction_notes: string | null;
  /** Cuántos documentos recibió el modelo. */
  documents_scanned: number;
}

/** Envelope del endpoint. */
export interface HabilitationScanApiResponse {
  success: boolean;
  data: DianHabilitationScanResult;
  message?: string;
}

/** Claves escaneadas, en el orden en que el formulario las pinta. */
export const HABILITATION_SCAN_FIELD_KEYS = [
  'name',
  'nit',
  'nit_dv',
  'environment',
  'software_id',
  'software_pin',
  'test_set_id',
  'resolution_number',
  'resolution_prefix',
  'resolution_range_from',
  'resolution_range_to',
  'resolution_valid_from',
  'resolution_valid_to',
  'resolution_date',
  'resolution_technical_key',
] as const;

export type HabilitationScanFieldKey =
  (typeof HABILITATION_SCAN_FIELD_KEYS)[number];

/** Etiquetas visibles, iguales a las del formulario de configuración DIAN. */
export const HABILITATION_SCAN_FIELD_LABELS: Record<
  HabilitationScanFieldKey,
  string
> = {
  name: 'Nombre de la configuración',
  nit: 'NIT',
  nit_dv: 'DV',
  environment: 'Ambiente',
  software_id: 'Software ID',
  software_pin: 'Software PIN',
  test_set_id: 'Test Set ID',
  resolution_number: 'Número de resolución',
  resolution_prefix: 'Prefijo',
  resolution_range_from: 'Rango desde',
  resolution_range_to: 'Rango hasta',
  resolution_valid_from: 'Vigente desde',
  resolution_valid_to: 'Vigente hasta',
  resolution_date: 'Fecha de la resolución',
  resolution_technical_key: 'Clave técnica (ClTec)',
};

/** Secciones del formulario, para agrupar la revisión igual que el paso 3. */
export const HABILITATION_SCAN_SECTIONS: ReadonlyArray<{
  title: string;
  keys: readonly HabilitationScanFieldKey[];
}> = [
  { title: 'Identificación', keys: ['name', 'nit', 'nit_dv'] },
  {
    title: 'Software DIAN',
    keys: ['environment', 'software_id', 'software_pin', 'test_set_id'],
  },
  {
    title: 'Resolución DIAN',
    keys: [
      'resolution_number',
      'resolution_prefix',
      'resolution_range_from',
      'resolution_range_to',
      'resolution_valid_from',
      'resolution_valid_to',
      'resolution_date',
      'resolution_technical_key',
    ],
  },
];

export const SCANNED_ENVIRONMENT_LABELS: Record<string, string> = {
  test: 'Habilitación (Pruebas)',
  production: 'Producción',
};
