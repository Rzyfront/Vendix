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
  statusCode?: number;
  timestamp?: string;
}

/**
 * Tipo unión para cualquier respuesta
 */
export type StandardResponse<T = any> = SuccessResponse<T> | ErrorResponse;

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
