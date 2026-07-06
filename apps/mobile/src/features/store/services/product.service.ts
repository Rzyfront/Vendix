import { apiClient, Endpoints } from '@/core/api';
import { unwrapPaginated } from '@/core/api/pagination';
import type {
  ApiResponse,
  PaginatedResponse,
  Product,
  ProductStats,
  ProductQuery,
  CreateProductDto,
  UpdateProductDto,
  ProductVariant,
  ProductImage,
  ProductCategory,
  Brand,
  TaxCategory,
  PriceTier,
} from '../types';

function unwrap<T>(response: { data: T | ApiResponse<T> }): T {
  const d = response.data as ApiResponse<T>;
  if (d && typeof d === 'object' && 'success' in d) return d.data;
  return response.data as T;
}

/**
 * Payload para crear una nueva categoría de impuesto. Coincide con el
 * endpoint backend POST /store/taxes/categories.
 */
export interface CreateTaxCategoryDto {
  name: string;
  type?: 'percentage' | 'fixed';
  tax_type?: 'iva' | 'inc' | 'ica' | 'withholding' | 'reteiva' | 'reteica' | 'other';
  rate: number;
  description?: string;
}

function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      if (Array.isArray(value)) {
        value.forEach((v) => parts.push(`${key}=${encodeURIComponent(String(v))}`));
      } else {
        parts.push(`${key}=${encodeURIComponent(String(value))}`);
      }
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export const ProductService = {
  async list(query?: ProductQuery): Promise<PaginatedResponse<Product>> {
    const params: Record<string, unknown> = {
      page: query?.page ?? 1,
      limit: query?.limit ?? 20,
      search: query?.search,
      state: query?.state,
      category_id: query?.category_id,
      brand_id: query?.brand_id,
      product_type: query?.product_type,
      barcode: query?.barcode,
      include_inactive: query?.include_inactive,
      pos_optimized: query?.pos_optimized,
      include_variants: query?.include_variants,
    };
    const res = await apiClient.get(`${Endpoints.STORE.PRODUCTS.LIST}${buildQuery(params)}`);
    return unwrapPaginated<Product>(res, { page: query?.page ?? 1, limit: query?.limit ?? 20 });
  },

  async getById(id: number): Promise<Product> {
    const endpoint = Endpoints.STORE.PRODUCTS.GET.replace(':id', String(id));
    const res = await apiClient.get(endpoint);
    return unwrap<Product>(res);
  },

  async create(data: CreateProductDto): Promise<Product> {
    const res = await apiClient.post(Endpoints.STORE.PRODUCTS.CREATE, data);
    return unwrap<Product>(res);
  },

  async update(id: number, data: UpdateProductDto): Promise<Product> {
    const endpoint = Endpoints.STORE.PRODUCTS.UPDATE.replace(':id', String(id));
    const res = await apiClient.patch(endpoint, data);
    return unwrap<Product>(res);
  },

  async delete(id: number): Promise<void> {
    const endpoint = Endpoints.STORE.PRODUCTS.DELETE.replace(':id', String(id));
    await apiClient.delete(endpoint);
  },

  async deactivate(id: number): Promise<Product> {
    const endpoint = Endpoints.STORE.PRODUCTS.DEACTIVATE.replace(':id', String(id));
    const res = await apiClient.patch(endpoint);
    return unwrap<Product>(res);
  },

  async stats(storeId: number): Promise<ProductStats> {
    const endpoint = Endpoints.STORE.PRODUCTS.STATS.replace(':storeId', String(storeId));
    const res = await apiClient.get(endpoint);
    return unwrap<ProductStats>(res);
  },

  async search(query: string, limit = 20): Promise<PaginatedResponse<Product>> {
    const res = await apiClient.get(
      `${Endpoints.STORE.PRODUCTS.SEARCH}${buildQuery({
        search: query,
        limit,
        state: 'active',
        include_variants: true,
        pos_optimized: true,
      })}`,
    );
    return unwrapPaginated<Product>(res, { page: 1, limit });
  },

  async getVariants(productId: number): Promise<ProductVariant[]> {
    const endpoint = Endpoints.STORE.PRODUCTS.VARIANTS.replace(':productId', String(productId));
    const res = await apiClient.get(endpoint);
    return unwrap<ProductVariant[]>(res);
  },

  async getImages(productId: number): Promise<ProductImage[]> {
    const endpoint = Endpoints.STORE.PRODUCTS.IMAGES.replace(':productId', String(productId));
    const res = await apiClient.get(endpoint);
    return unwrap<ProductImage[]>(res);
  },

  /**
   * Lista las tarifas de precio del store (multi-tarifa). Se usa en
   * el form de producto para que el usuario seleccione cuáles aplican.
   * Devuelve `{ data: PriceTier[], meta: { total, ... } }`.
   */
  async getPriceTiers(params?: { is_active?: boolean; search?: string }): Promise<PriceTier[]> {
    const query: string[] = [];
    if (params?.is_active !== undefined) query.push(`is_active=${params.is_active}`);
    if (params?.search) query.push(`search=${encodeURIComponent(params.search)}`);
    const qs = query.length ? `?${query.join('&')}` : '';
    const res = await apiClient.get(`${Endpoints.STORE.PRICE_TIERS.LIST}${qs}`);
    const body = unwrap<{ data?: PriceTier[] } | PriceTier[]>(res);
    return Array.isArray(body) ? body : body.data ?? [];
  },

  /**
   * Lista los overrides de precio (override_price, override_units_per_package)
   * que un producto tiene configurados para cada tarifa aplicada.
   * Se usa para hidratar el form al re-editar un producto con
   * multi-tarifa.
   */
  async getProductPriceTierOverrides(productId: number): Promise<
    Array<{
      price_tier_id: number;
      override_price?: number | null;
      override_units_per_package?: number | null;
    }>
  > {
    const res = await apiClient.get(
      `/store/price-tiers/products/${productId}/overrides`,
    );
    const body = unwrap<unknown[] | { data?: unknown[] }>(res);
    return Array.isArray(body) ? (body as any[]) : ((body as any).data ?? []);
  },

  /**
   * Genera (o regenera) el link público de compra online + QR del
   * producto. El backend busca el dominio ecommerce principal de la
   * tienda y construye la URL + QR code. Devuelve el QR como data URL
   * listo para renderizar en un `<Image>`.
   */
  async generateOnlinePurchaseLink(productId: number): Promise<{
    generated: boolean;
    product_id: number;
    online_purchase_url: string | null;
    online_purchase_qr_code: string | null;
    qr_data_url: string | null;
    online_purchase_domain_id: number | null;
    domain_hostname: string | null;
    online_purchase_generated_at: string | null;
    online_purchase_ready: boolean;
    online_purchase_status_reason: string | null;
    online_purchase_status_message: string | null;
  }> {
    const res = await apiClient.post(
      `/store/products/${productId}/online-purchase-link`,
    );
    return unwrap<{
      generated: boolean;
      product_id: number;
      online_purchase_url: string | null;
      online_purchase_qr_code: string | null;
      qr_data_url: string | null;
      online_purchase_domain_id: number | null;
      domain_hostname: string | null;
      online_purchase_generated_at: string | null;
      online_purchase_ready: boolean;
      online_purchase_status_reason: string | null;
      online_purchase_status_message: string | null;
    }>(res);
  },

  /**
   * Crea/actualiza el override de precio y unidades por empaque de
   * una tarifa específica sobre un producto. El backend reconcilia con
   * la tabla `product_price_tier_overrides`.
   */
  async upsertProductPriceTierOverride(
    productId: number,
    tierId: number,
    body: { override_price?: number; override_units_per_package?: number },
  ): Promise<void> {
    const endpoint = `/store/price-tiers/products/${productId}/overrides/${tierId}`;
    await apiClient.put(endpoint, body);
  },

  /**
   * Elimina el override de una tarifa para un producto. Se llama cuando
   * el usuario desactiva la multi-tarifa o quita una tarifa de la
   * selección, y esa tarifa ya tenía override persistido.
   */
  async removeProductPriceTierOverride(
    productId: number,
    tierId: number,
  ): Promise<void> {
    const endpoint = `/store/price-tiers/products/${productId}/overrides/${tierId}`;
    await apiClient.delete(endpoint);
  },

  async getCategories(): Promise<ProductCategory[]> {
    const res = await apiClient.get(Endpoints.STORE.CATEGORIES.LIST);
    return unwrap<ProductCategory[]>(res);
  },

  async getBrands(): Promise<Brand[]> {
    const res = await apiClient.get(Endpoints.STORE.BRANDS.LIST);
    return unwrap<Brand[]>(res);
  },

  async getTaxes(): Promise<TaxCategory[]> {
    // Pedimos un limit alto para traer todos los impuestos en una sola llamada
    // (la mayoría de tiendas tienen < 50). El backend siempre devuelve respuesta
    // paginada `{ data: TaxCategory[], meta: {...} }` envuelta en el envelope estándar.
    const res = await apiClient.get(
      `${Endpoints.STORE.TAXES.CATEGORIES}?limit=200`,
    );
    const unwrapped = unwrap<TaxCategory[] | { data: TaxCategory[]; meta: unknown }>(res);
    // Si la respuesta es paginada, devolvemos el array interno.
    if (unwrapped && typeof unwrapped === 'object' && 'data' in unwrapped && Array.isArray((unwrapped as { data: TaxCategory[] }).data)) {
      return (unwrapped as { data: TaxCategory[] }).data;
    }
    return unwrapped as TaxCategory[];
  },

  /**
   * Crea una nueva categoría de impuesto (ej. IVA, INC, ReteFuente).
   * Persiste en backend y devuelve el TaxCategory con el id real.
   */
  async createTaxCategory(data: CreateTaxCategoryDto): Promise<TaxCategory> {
    const res = await apiClient.post(Endpoints.STORE.TAXES.CATEGORY_CREATE, data);
    return unwrap<TaxCategory>(res);
  },

  /**
   * Elimina una categoría de impuesto. Tras borrar, el caller debe
   * invalidar el queryKey `['product-taxes']` para refrescar la lista.
   */
  async deleteTaxCategory(id: number): Promise<void> {
    const endpoint = Endpoints.STORE.TAXES.CATEGORY_DELETE.replace(':id', String(id));
    await apiClient.delete(endpoint);
  },

  /**
   * Persiste las promociones asignadas a un producto (PATCH separado,
   * no bundled en el DTO de update — sigue el patrón del web y de
   * `syncPriceTierOverrides`).
   */
  async updatePromotions(productId: number, ids: number[]): Promise<void> {
    const endpoint = Endpoints.STORE.PRODUCTS.PROMOTIONS.replace(':id', String(productId));
    await apiClient.patch(endpoint, { promotion_ids: ids });
  },

  /**
   * Llama al backend de IA para generar la descripción de un producto a partir
   * de su nombre + SKU + categoría + marca. Devuelve el texto sugerido.
   */
  async generateDescription(payload: {
    name: string;
    sku?: string;
    category_id?: number | null;
    brand_id?: number | null;
  }): Promise<{ description: string }> {
    const res = await apiClient.post(
      Endpoints.STORE.PRODUCTS.GENERATE_DESCRIPTION,
      payload,
    );
    return unwrap<{ description: string }>(res);
  },
};
