import { ResponseService } from './response.service';

/**
 * Helper para endpoints analytics que devuelven array plano por defecto
 * pero aceptan `page?` y `limit?` para paginar. Cuando el query trae
 * paginación, devuelve `{data, meta: {pagination}}` (envelope que espera
 * el `ResponsiveDataViewComponent` del frontend). Si no, devuelve el
 * array plano envuelto en `success` (default).
 *
 * Uso:
 *   return paginatedOrAll(this.response_service, query, rows);
 */
export function paginatedOrAll<T>(
  responseService: ResponseService,
  query: { page?: number; limit?: number },
  rows: T[],
): ReturnType<ResponseService['success']> | ReturnType<ResponseService['paginated']> {
  const hasPage = query.page !== undefined && query.limit !== undefined;
  if (!hasPage) {
    return responseService.success(rows) as ReturnType<ResponseService['success']>;
  }
  return responseService.paginated(
    rows,
    rows.length,
    query.page as number,
    query.limit as number,
  ) as ReturnType<ResponseService['paginated']>;
}
