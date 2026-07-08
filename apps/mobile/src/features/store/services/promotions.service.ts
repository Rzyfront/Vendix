import { apiClient, Endpoints } from '@/core/api';
import { unwrapPaginated } from '@/core/api/pagination';
import type { PaginatedResponse } from '@/features/store/types/api.types';
import type {
  CreatePromotionDto,
  Promotion,
  PromotionApiResponse,
  PromotionQuery,
  PromotionStats,
  QuantityTier,
  UpdatePromotionDto,
} from '@/features/store/types/promotions.types';

function unwrap<T>(response: { data: T | unknown }): T {
  const d = response.data as { success?: boolean; data: T };
  if (d && typeof d === 'object' && 'success' in d) return d.data;
  return response.data as T;
}

// Re-export the canonical `Promotion` interface for backwards compat with
// any existing imports of `PromotionsService.Promotion` or
// `import { Promotion } from '@/features/store/services/promotions.service'`.
export type { Promotion };

export const PromotionsService = {
  /**
   * Lista el catálogo de promociones activas del store.
   * Se usa para hidratar el MultiSelector en el form de producto.
   */
  async getActive(): Promise<Promotion[]> {
    const res = await apiClient.get(Endpoints.STORE.PROMOTIONS.ACTIVE);
    const body = unwrap<Promotion[] | { data: Promotion[] }>(res);
    if (Array.isArray(body)) return body;
    return (body as { data: Promotion[] }).data ?? [];
  },

  /**
   * Obtiene los IDs de las promociones asignadas a un producto.
   * Se llama al editar un producto para hidratar el form.
   *
   * Backend `GET /store/products/:id/promotions` devuelve la lista de
   * objetos `Promotion` completos (no IDs), por lo que mapeamos a IDs
   * aquí para que el MultiSelector del form pueda hidratar
   * `form.promotion_ids` con números puros.
   */
  async getProductPromotions(productId: number): Promise<number[]> {
    const endpoint = Endpoints.STORE.PRODUCTS.PROMOTIONS.replace(':id', String(productId));
    const res = await apiClient.get(endpoint);
    const body = unwrap<
      { data: Array<{ id: number }> } | Array<{ id: number }>
    >(res);
    const arr = Array.isArray(body)
      ? body
      : (body as { data: Array<{ id: number }> }).data ?? [];
    return arr.map((p) => p.id);
  },

  /**
   * Lista paginada de promociones (admin). Acepta search, page, limit,
   * sort_by, sort_order, state, type, scope, rule_type.
   * Consume `GET /store/promotions` con `QueryPromotionsDto`.
   *
   * Devuelve el shape canónico `PaginatedResponse<Promotion>` de
   * `core/api/pagination.ts` con `pagination` (NO `meta`) para que
   * encaje con `getNextPageParam` del repo.
   */
  async list(query: PromotionQuery = {}): Promise<PaginatedResponse<Promotion>> {
    const params: Record<string, string | number> = {};
    if (query.search) params.search = query.search;
    if (query.page) params.page = query.page;
    if (query.limit) params.limit = query.limit;
    if (query.sort_by) params.sort_by = query.sort_by;
    if (query.sort_order) params.sort_order = query.sort_order;
    if (query.state) params.state = query.state;
    if (query.type) params.type = query.type;
    if (query.scope) params.scope = query.scope;
    if (query.rule_type) params.rule_type = query.rule_type;

    const res = await apiClient.get(Endpoints.STORE.PROMOTIONS.LIST, { params });
    return unwrapPaginated<Promotion>(res as { data: unknown }, {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
  },

  /**
   * Obtiene el detalle de una promoción por id.
   * Incluye relations (products, categories, quantity_tiers) y
   * `_count.order_promotions` (uso histórico).
   */
  async getById(id: number): Promise<Promotion> {
    const endpoint = Endpoints.STORE.PROMOTIONS.GET.replace(':id', String(id));
    const res = await apiClient.get(endpoint);
    return unwrap<Promotion | { data: Promotion }>(res) as Promotion;
  },

  /**
   * Resumen con 4 métricas: activas, programadas, descuento total otorgado,
   * usos totales. Consume `GET /store/promotions/summary`.
   */
  async getSummary(): Promise<PromotionStats> {
    const res = await apiClient.get(Endpoints.STORE.PROMOTIONS.STATS);
    return unwrap<PromotionStats | { data: PromotionStats }>(res) as PromotionStats;
  },

  /**
   * Crea una promoción nueva. Estado inicial = `draft`.
   * Retorna `{ data, message }` para que el cliente muestre el
   * `message` verbatim del backend como toast.
   */
  async create(dto: CreatePromotionDto): Promise<PromotionApiResponse<Promotion>> {
    const res = await apiClient.post(Endpoints.STORE.PROMOTIONS.CREATE, dto);
    const body = unwrap<{ data: Promotion; message?: string } | Promotion>(res) as
      | { data: Promotion; message?: string }
      | Promotion;
    if ('data' in body) return body;
    return { data: body as Promotion };
  },

  /**
   * Actualiza una promoción. PATCH parcial. El backend maneja la
   * reescritura transaccional de `promotion_products` /
   * `promotion_categories` / `promotion_quantity_tiers`.
   */
  async update(id: number, dto: UpdatePromotionDto): Promise<PromotionApiResponse<Promotion>> {
    const endpoint = Endpoints.STORE.PROMOTIONS.UPDATE.replace(':id', String(id));
    const res = await apiClient.patch(endpoint, dto);
    const body = unwrap<{ data: Promotion; message?: string } | Promotion>(res) as
      | { data: Promotion; message?: string }
      | Promotion;
    if ('data' in body) return body;
    return { data: body as Promotion };
  },

  /**
   * Activa una promoción. El backend decide entre `scheduled` y
   * `active` según `start_date > now`.
   */
  async activate(id: number): Promise<PromotionApiResponse<Promotion>> {
    const endpoint = Endpoints.STORE.PROMOTIONS.ACTIVATE.replace(':id', String(id));
    const res = await apiClient.post(endpoint, {});
    const body = unwrap<{ data: Promotion; message?: string } | Promotion>(res) as
      | { data: Promotion; message?: string }
      | Promotion;
    if ('data' in body) return body;
    return { data: body as Promotion };
  },

  /**
   * Pausa una promoción activa.
   */
  async pause(id: number): Promise<PromotionApiResponse<Promotion>> {
    const endpoint = Endpoints.STORE.PROMOTIONS.PAUSE.replace(':id', String(id));
    const res = await apiClient.post(endpoint, {});
    const body = unwrap<{ data: Promotion; message?: string } | Promotion>(res) as
      | { data: Promotion; message?: string }
      | Promotion;
    if ('data' in body) return body;
    return { data: body as Promotion };
  },

  /**
   * Cancela una promoción. Estado final = `cancelled`.
   */
  async cancel(id: number): Promise<PromotionApiResponse<Promotion>> {
    const endpoint = Endpoints.STORE.PROMOTIONS.CANCEL.replace(':id', String(id));
    const res = await apiClient.post(endpoint, {});
    const body = unwrap<{ data: Promotion; message?: string } | Promotion>(res) as
      | { data: Promotion; message?: string }
      | Promotion;
    if ('data' in body) return body;
    return { data: body as Promotion };
  },

  /**
   * Elimina una promoción. **Solo permitido en `state === 'draft'`**
   * (backend `promotions.service.ts:445-450`). El cliente oculta el
   * botón en otros estados; el backend revalida y devuelve 400 si se
   * intenta igualmente.
   */
  async remove(id: number): Promise<{ message: string }> {
    const endpoint = Endpoints.STORE.PROMOTIONS.DELETE.replace(':id', String(id));
    const res = await apiClient.delete(endpoint);
    return unwrap<{ message: string } | { data: null; message: string }>(res) as {
      message: string;
    };
  },

  /**
   * Helper para tests/debug: tier rows completas (sin IDs).
   * No es un endpoint, solo se usa en el cliente para hidratar el
   * FormArray `quantity_tiers` antes del submit.
   */
  buildTierRows(tiers: QuantityTier[] = []): QuantityTier[] {
    return tiers.map((t, i) => ({
      id: t.id,
      min_quantity: t.min_quantity,
      max_quantity: t.max_quantity ?? null,
      type: t.type,
      value: t.value,
      sort_order: t.sort_order ?? i,
    }));
  },
};
