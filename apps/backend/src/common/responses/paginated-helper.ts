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

/**
 * Wrapper para endpoints cuyo servicio pagina INTERNAMENTE (devuelve
 * `{data: slice, meta}` cuando recibe `page`+`limit`, o un objeto con
 * el array en `products`/`data` cuando NO). El frontend hace paginación
 * in-memory (`onPageChange` solo dispatcha `setPage`, NO recarga el
 * effect), así que necesitamos devolver SIEMPRE el array completo y
 * dejar que el paginator del frontend haga el slice.
 *
 * Estrategia: invocamos el servicio forzando `page: undefined` y un
 * `limit` muy alto para entrar al path "no paginado" (array completo
 * hasta el cap). Extraemos el array con `rowsExtractor` (default
 * `result.data ?? []`; para profitability use `result.products ?? []`)
 * y se lo pasamos a `paginatedOrAll` para construir el envelope meta
 * correcto.
 *
 * Uso:
 *   return fetchAllThenPaginate(this.response_service, query,
 *     (q) => this.sales_analytics_service.getSalesByProduct(q),
 *   );
 */
export async function fetchAllThenPaginate<T extends object>(
  responseService: ResponseService,
  query: { page?: number; limit?: number; [key: string]: any },
  serviceCall: (q: any) => Promise<any>,
  rowsExtractor: (result: any) => T[] = (r) => r.data ?? [],
) {
  const fullQuery = { ...query, page: undefined, limit: 10000 };
  const result = await serviceCall(fullQuery);
  const rows = rowsExtractor(result);
  return paginatedOrAll(responseService, query, rows);
}
