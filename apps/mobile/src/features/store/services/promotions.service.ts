import { apiClient, Endpoints } from '@/core/api';

function unwrap<T>(response: { data: T | unknown }): T {
  const d = response.data as { success?: boolean; data: T };
  if (d && typeof d === 'object' && 'success' in d) return d.data;
  return response.data as T;
}

export interface Promotion {
  id: number;
  name: string;
  is_active?: boolean;
  description?: string;
}

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
   */
  async getProductPromotions(productId: number): Promise<number[]> {
    const endpoint = Endpoints.STORE.PRODUCTS.PROMOTIONS.replace(':id', String(productId));
    const res = await apiClient.get(endpoint);
    const body = unwrap<{ data: number[] } | number[]>(res);
    if (Array.isArray(body)) return body;
    return (body as { data: number[] }).data ?? [];
  },
};
