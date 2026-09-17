/**
 * Respuesta exitosa estándar
 */
export interface SuccessResponse<T = any> {
  success: true;
  message: string;
  data: T;
  meta?: Record<string, any>;
}

/**
 * Respuesta de error estándar
 */
export interface ErrorResponse {
  success: false;
  message: string;
  error: string | Record<string, any>;
  error_code?: string;
  statusCode?: number;
  timestamp?: string;
}

/**
 * Tipo unión para cualquier respuesta
 */
export type StandardResponse<T = any> = SuccessResponse<T> | ErrorResponse;

/**
 * CP-pos-smart-search · B.2 (ADR-08) — cómo se ordenó un listado con search.
 * Solo viaja en respuestas de listados con `search`; ausente en el resto.
 */
export type SearchRankMode =
  | 'ranked'
  | 'unranked_scan_cap'
  | 'unranked_error'
  | 'legacy';

export type SearchRankLayer = 'legacy' | 'l1' | 'l2' | 'trigram';

export interface SearchRankMeta {
  rank_mode: SearchRankMode;
  layer: SearchRankLayer;
  degraded: boolean;
}

/**
 * Metadata de paginación
 */
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  /** Presente solo en listados con `search` (contrato ADR-08). */
  search?: SearchRankMeta;
}

/**
 * Respuesta paginada
 */
export interface PaginatedResponse<T> {
  success: true;
  message: string;
  data: T[];
  meta: PaginationMeta;
}

/**
 * Helper para crear metadata de paginación
 */
export function createPaginationMeta(
  total: number,
  page: number,
  limit: number,
): PaginationMeta {
  const totalPages = Math.ceil(total / limit);
  return {
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}
