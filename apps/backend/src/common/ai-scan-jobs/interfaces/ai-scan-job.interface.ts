import type { AiJobProgress, AiJobStatusMeta } from '../ai-job-monitor.service';

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
  | 'customer_import'
  | 'product_image_enhance'
  | 'product_image_generate'
  | 'invoice_draft'
  | 'data_collection_template';

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

/**
 * `{status, result?, error?}` is the contract mobile reads; the rest is
 * additive (QUI-1020): timestamps, real progress, stall and failure class.
 */
export interface AiScanJobStatus<T = unknown> extends Partial<AiJobStatusMeta> {
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
  result?: T;
  error?: string;
  kind?: AiScanKind;
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
  /**
   * Real progress (pages, rows, steps) for the bar in the web (QUI-1020).
   * Optional to call; never throws.
   */
  reportProgress?: (progress: AiJobProgress) => Promise<void>;
}) => Promise<T>;
