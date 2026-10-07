/**
 * Contratos de la cola generica `ai-scan` (escaneos IA async: 202 + job_id + poll).
 * Los handlers por `kind` los registra cada dominio en `AiScanHandlerRegistry`.
 */
export type AiScanKind =
  | 'rut'
  | 'dian_habilitation'
  | 'dian_resolution'
  | 'route_sheet'
  | 'inventory_count'
  | 'member_roster'
  | 'product_image_enhance'
  | 'product_image_generate';

export interface AiScanJobContext {
  store_id: number | null;
  organization_id: number | null;
  user_id: number | null;
  is_super_admin: boolean;
  request_id?: string;
}

/** Payload del job. Los archivos viajan por S3 (keys), nunca por Redis. */
export interface AiScanJob {
  kind: AiScanKind;
  context: AiScanJobContext;
  file_keys: string[];
  params: Record<string, unknown>;
}

export interface AiScanJobStatus<T = unknown> {
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
  result?: T;
  error?: string;
}

export interface AiScanFile {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
  size: number;
}

export type AiScanHandler<T = unknown> = (input: {
  files: AiScanFile[];
  params: Record<string, unknown>;
  context: AiScanJobContext;
}) => Promise<T>;
