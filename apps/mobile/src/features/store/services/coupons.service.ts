/**
 * CouponsService — API layer para Marketing → Cupones.
 *
 * Consume los endpoints del backend `apps/backend/src/domains/store/coupons/`.
 * Pattern idéntico a PromotionsService: apiClient + unwrapPaginated + unwrap helper.
 * Mobile-dev RULE 6: nunca reimplementar lógica del backend — solo consumir el contrato.
 */
import { apiClient, Endpoints } from '@/core/api';
import { unwrapPaginated } from '@/core/api/pagination';
import type {
  Coupon,
  CouponStats,
  CreateCouponDto,
  UpdateCouponDto,
  CouponQuery,
  CouponApiResponse,
} from '@/features/store/types/coupon.types';
import type { PaginatedResponse } from '@/features/store/types/api.types';

function unwrap<T>(response: { data: T | unknown }): T {
  const d = response.data as { success?: boolean; data: T };
  if (d && typeof d === 'object' && 'success' in d) return d.data;
  return response.data as T;
}

export type { Coupon, CouponStats, CreateCouponDto, UpdateCouponDto };

export const CouponsService = {
  /**
   * Lista paginada de cupones. Soporta search, pagination, sorting, filtering.
   * Consume GET /store/coupons con CouponQueryDto.
   */
  async list(query: CouponQuery = {}): Promise<PaginatedResponse<Coupon>> {
    const params: Record<string, string | number | boolean> = {};
    if (query.search) params.search = query.search;
    if (query.page) params.page = query.page;
    if (query.limit) params.limit = query.limit;
    if (query.sort_by) params.sort_by = query.sort_by;
    if (query.sort_order) params.sort_order = query.sort_order;
    if (query.is_active !== undefined) params.is_active = query.is_active;
    if (query.discount_type) params.discount_type = query.discount_type;

    const res = await apiClient.get(Endpoints.STORE.COUPONS.LIST, { params });
    return unwrapPaginated<Coupon>(res as { data: unknown }, {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
  },

  /**
   * Obtiene el detalle de un cupón por ID.
   * Incluye coupon_products, coupon_categories, y _count.coupon_uses.
   */
  async getById(id: number): Promise<Coupon> {
    const endpoint = Endpoints.STORE.COUPONS.GET.replace(':id', String(id));
    const res = await apiClient.get(endpoint);
    return unwrap<Coupon | { data: Coupon }>(res) as Coupon;
  },

  /**
   * Resumen con 4 métricas: total_coupons, active_coupons, total_uses,
   * total_discount_applied. Consume GET /store/coupons/stats.
   */
  async getStats(): Promise<CouponStats> {
    const res = await apiClient.get(Endpoints.STORE.COUPONS.STATS);
    return unwrap<CouponStats | { data: CouponStats }>(res) as CouponStats;
  },

  /**
   * Crea un cupón nuevo. Retorna { data, message } del backend
   * para mostrar toast verbatim.
   */
  async create(dto: CreateCouponDto): Promise<CouponApiResponse<Coupon>> {
    const res = await apiClient.post(Endpoints.STORE.COUPONS.CREATE, dto);
    const body = unwrap<{ data: Coupon; message?: string } | Coupon>(res) as
      | { data: Coupon; message?: string }
      | Coupon;
    if ('data' in body) return body;
    return { data: body as Coupon };
  },

  /**
   * Actualiza un cupón existente. PATCH parcial.
   */
  async update(
    id: number,
    dto: UpdateCouponDto,
  ): Promise<CouponApiResponse<Coupon>> {
    const endpoint = Endpoints.STORE.COUPONS.UPDATE.replace(':id', String(id));
    const res = await apiClient.patch(endpoint, dto);
    const body = unwrap<{ data: Coupon; message?: string } | Coupon>(res) as
      | { data: Coupon; message?: string }
      | Coupon;
    if ('data' in body) return body;
    return { data: body as Coupon };
  },

  /**
   * Elimina un cupón. Soft-delete en backend (is_active = false).
   * Retorna mensaje verbatim del backend para toast.
   */
  async remove(id: number): Promise<{ message: string }> {
    const endpoint = Endpoints.STORE.COUPONS.DELETE.replace(':id', String(id));
    const res = await apiClient.delete(endpoint);
    return unwrap<{ message: string } | { data: null; message: string }>(
      res,
    ) as { message: string };
  },
};
