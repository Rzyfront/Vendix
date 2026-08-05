/**
 * Contrato del escáner de resoluciones DIAN, espejo de
 * `DianResolutionScanResult` en
 * `apps/backend/src/domains/store/invoicing/resolutions/resolution-scanner.service.ts`.
 *
 * El backend no persiste nada: devuelve campos anotados y quien decide es el
 * usuario. Por eso cada campo trae su propio veredicto en vez de un único
 * `confidence` global — un rango mal leído emite facturas fuera de la
 * numeración autorizada y la DIAN las rechaza una por una.
 */

/** Ámbito del escaneo: define a qué namespace HTTP se sube el archivo. */
export type ResolutionScannerScope = 'store' | 'platform';

export type ScannedResolutionDocumentType =
  | 'sales_invoice'
  | 'support_document';

export type ScannedResolutionEnvironment = 'test' | 'production';

export interface ResolutionScanField<T> {
  /** `null` cuando no se leyó o cuando falló su regla estructural. */
  value: T | null;
  /** 0-100 reportada por la IA para este campo solo. */
  confidence: number;
  /** Pasó su regla estructural y puede precargarse. */
  verified: boolean;
  /** Por qué un humano todavía tiene que mirarlo, o `null`. */
  warning: string | null;
}

export interface DianResolutionScanResult {
  prefix: ResolutionScanField<string>;
  document_type: ResolutionScanField<ScannedResolutionDocumentType>;
  resolution_number: ResolutionScanField<string>;
  resolution_date: ResolutionScanField<string>;
  range_from: ResolutionScanField<number>;
  range_to: ResolutionScanField<number>;
  valid_from: ResolutionScanField<string>;
  valid_to: ResolutionScanField<string>;
  technical_key: ResolutionScanField<string>;
  environment: ResolutionScanField<ScannedResolutionEnvironment>;
  confidence: number;
  /** Claves de campo que el usuario debe confirmar a mano antes de guardar. */
  requires_manual_confirmation: string[];
  /** Razones por las que la extracción no se puede usar tal cual. */
  blocking_issues: string[];
  extraction_notes: string | null;
}

export interface ResolutionScanApiResponse {
  success: boolean;
  message?: string;
  data: DianResolutionScanResult;
}

/** Claves de campo en el orden en que se muestran al revisar. */
export const RESOLUTION_SCAN_FIELD_KEYS = [
  'document_type',
  'prefix',
  'resolution_number',
  'resolution_date',
  'range_from',
  'range_to',
  'valid_from',
  'valid_to',
  'environment',
  'technical_key',
] as const;

export type ResolutionScanFieldKey =
  (typeof RESOLUTION_SCAN_FIELD_KEYS)[number];

export const RESOLUTION_SCAN_FIELD_LABELS: Record<
  ResolutionScanFieldKey,
  string
> = {
  document_type: 'Tipo de documento',
  prefix: 'Prefijo',
  resolution_number: 'Número de resolución',
  resolution_date: 'Fecha de la resolución',
  range_from: 'Rango inicial',
  range_to: 'Rango final',
  valid_from: 'Vigencia desde',
  valid_to: 'Vigencia hasta',
  environment: 'Ambiente',
  technical_key: 'Clave técnica',
};

export const SCANNED_DOCUMENT_TYPE_LABELS: Record<string, string> = {
  sales_invoice: 'Factura electrónica de venta',
  support_document: 'Documento soporte',
};

export const SCANNED_ENVIRONMENT_LABELS: Record<string, string> = {
  test: 'Pruebas (habilitación)',
  production: 'Producción',
};
