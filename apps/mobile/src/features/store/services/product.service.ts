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
  PriceTierKind,
  ProductPriceTierOverride,
  BulkProductAnalysisResult,
  BulkUploadResult,
} from '../types';
import {
  resolveSaleUnitPresentations,
  type SaleUnitPresentation,
} from '../pricing';

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
      // Paridad web `pos-product-search.component` (min/max price, sort,
      // in-stock). Backend actual puede ignorarlos (DTO no los declara);
      // el cliente aplica fallback local en `pos/index.tsx`.
      min_price: query?.min_price,
      max_price: query?.max_price,
      in_stock: query?.in_stock,
      sort_by: query?.sort_by,
      sort_order: query?.sort_order,
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
   *
   * `kind` discrimina los dos ejes que conviven en la tabla: `customer_tier`
   * ("a quién le vendo") vs `sale_unit` ("en qué presentación vendo"). El
   * selector de presentaciones del POS SIEMPRE debe filtrar por `sale_unit`.
   */
  async getPriceTiers(params?: {
    is_active?: boolean;
    search?: string;
    kind?: PriceTierKind;
  }): Promise<PriceTier[]> {
    const query: string[] = [];
    if (params?.is_active !== undefined) query.push(`is_active=${params.is_active}`);
    if (params?.search) query.push(`search=${encodeURIComponent(params.search)}`);
    if (params?.kind) query.push(`kind=${params.kind}`);
    const qs = query.length ? `?${query.join('&')}` : '';
    const res = await apiClient.get(`${Endpoints.STORE.PRICE_TIERS.LIST}${qs}`);
    const body = unwrap<{ data?: PriceTier[] } | PriceTier[]>(res);
    return Array.isArray(body) ? body : body.data ?? [];
  },

  /**
   * Catálogo de presentaciones de venta de la tienda
   * (`price_tiers.kind='sale_unit'`, solo activas). Es la lista que hay que
   * cruzar con `product.enabled_price_tier_ids` para saber qué puede ofrecer
   * el POS para un producto concreto.
   *
   * Se pide una sola vez por sesión de POS y se cachea en el caller: el
   * catálogo es de tienda, no de producto.
   */
  async getSaleUnitTiers(): Promise<PriceTier[]> {
    return ProductService.getPriceTiers({ kind: 'sale_unit', is_active: true });
  },

  /**
   * Presentaciones que el POS puede ofrecer para UN producto, con el precio del
   * paquete ya resuelto.
   *
   * Cruza las tres fuentes que el backend también cruza al persistir
   * (`tier-snapshot.util.ts`): el allowlist del producto
   * (`enabled_price_tier_ids`), el catálogo `sale_unit` de la tienda y los
   * overrides del producto (`override_price`, `override_units_per_package`).
   *
   * Devuelve `[]` cuando el producto no tiene allowlist — ese producto se
   * vende exactamente como hoy y ninguna UI cambia.
   */
  async getSaleUnitPresentations(
    product: Pick<
      Product,
      'id' | 'base_price' | 'sale_price' | 'is_on_sale' | 'price_unit_quantity' | 'enabled_price_tier_ids' | 'has_multiple_price_tiers'
    >,
    options?: { tiers?: PriceTier[]; defaultTierId?: number | null },
  ): Promise<SaleUnitPresentation[]> {
    const enabled = product.enabled_price_tier_ids ?? [];
    if (enabled.length === 0) return [];

    const [tiers, overrides] = await Promise.all([
      options?.tiers
        ? Promise.resolve(options.tiers)
        : ProductService.getSaleUnitTiers(),
      ProductService.getProductPriceTierOverrides(product.id),
    ]);

    return resolveSaleUnitPresentations(
      product,
      tiers,
      overrides,
      options?.defaultTierId ?? null,
    );
  },

  /**
   * Resuelve un código de barras pistoleado.
   *
   * El backend responde con el producto Y —cuando el código pertenece a una
   * presentación— con `scanned_price_tier_id`. Sin ese dato el POS recibiría el
   * producto y tendría que adivinar la unidad de venta, que es justo lo que el
   * código de barras vino a resolver.
   *
   * Devuelve `null` cuando ningún producto coincide.
   */
  async findByBarcode(
    barcode: string,
  ): Promise<{ product: Product; scannedPriceTierId: number | null } | null> {
    const code = barcode.trim();
    if (!code) return null;
    const page = await ProductService.list({
      barcode: code,
      limit: 1,
      include_variants: true,
      pos_optimized: true,
    });
    const product = page.data?.[0];
    if (!product) return null;
    const scanned = product.scanned_price_tier_id;
    return {
      product,
      scannedPriceTierId:
        scanned != null && Number.isFinite(Number(scanned)) ? Number(scanned) : null,
    };
  },

  /**
   * Lista los overrides de precio (override_price, override_units_per_package)
   * que un producto tiene configurados para cada tarifa aplicada.
   * Se usa para hidratar el form al re-editar un producto con
   * multi-tarifa.
   */
  async getProductPriceTierOverrides(
    productId: number,
  ): Promise<ProductPriceTierOverride[]> {
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

  /* ============================================================
   * Bulk product upload (wizard 3-step)
   * ============================================================
   * Implementa el flujo del web `bulk-upload-modal.component.ts`:
   * analyze (dry-run con validación cell-by-cell) → upload-session (commit).
   * Los templates se descargan con `getBulkUploadTemplate(type)`.
   */

  /**
   * Descarga la plantilla Excel para carga masiva.
   * `type='products'` → plantilla de productos (17 columnas).
   * `type='services'` → plantilla de servicios (27 columnas).
   * Devuelve un Blob listo para `FileSystem.writeAsStringAsync`.
   */
  async getBulkUploadTemplate(type: 'products' | 'services' = 'products'): Promise<Blob> {
    const res = await apiClient.get(
      `${Endpoints.STORE.PRODUCTS.BULK_TEMPLATE_DOWNLOAD}?type=${type}`,
      { responseType: 'blob' },
    );
    return res.data as Blob;
  },

  /**
   * Descarga un XLSX con los productos actuales del store, en el mismo
   * formato de la plantilla + 3 columnas informativas (precio compra,
   * cantidad actual, tiene imagen). Pensado para auditoría/edición rápida.
   */
  async exportCurrentProducts(): Promise<Blob> {
    const res = await apiClient.get(Endpoints.STORE.PRODUCTS.BULK_EXPORT, {
      responseType: 'blob',
    });
    return res.data as Blob;
  },

  /**
   * Paso 1 del wizard: analiza el archivo Excel/CSV sin procesar (dry-run).
   * Devuelve el `session_id` que se usará en `uploadBulkProductsFromSession`,
   * más el análisis per-row con `status` (ready/warning/error) y
   * `modified_fields`/`nulled_fields` para el cell-level preview del Paso 2.
   */
  async analyzeBulkProducts(file: { uri: string; name: string }): Promise<BulkProductAnalysisResult> {
    const formData = new FormData();
    // @ts-expect-error RN FormData accepts file objects with uri/name/type
    formData.append('file', {
      uri: file.uri,
      name: file.name,
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const res = await apiClient.post(Endpoints.STORE.PRODUCTS.BULK_ANALYZE, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return unwrap<BulkProductAnalysisResult>(res);
  },

  /**
   * Paso 3 del wizard: procesa la carga desde una sesión previamente analizada.
   * El backend descarga el XLSX de S3 (subido en analyze), lo re-parsea y
   * aplica create/update por SKU.
   */
  async uploadBulkProductsFromSession(sessionId: string): Promise<BulkUploadResult> {
    const res = await apiClient.post(
      Endpoints.STORE.PRODUCTS.BULK_UPLOAD_SESSION,
      { session_id: sessionId },
    );
    return unwrap<BulkUploadResult>(res);
  },

  /**
   * Cancela una sesión de análisis, eliminando el XLSX temporal en S3.
   * Se llama al cerrar el modal sin haber completado la carga, para no
   * dejar archivos huérfanos.
   */
  async cancelBulkProductSession(sessionId: string): Promise<void> {
    const endpoint = Endpoints.STORE.PRODUCTS.BULK_CANCEL_SESSION.replace(
      ':sessionId',
      sessionId,
    );
    await apiClient.delete(endpoint);
  },

  /* ============================================================
   * Bulk image upload (wizard 3-step)
   * ============================================================ */

  /**
   * Descarga la plantilla ZIP para carga masiva de imágenes.
   * `type='example'` → ZIP con carpetas de ejemplo.
   * `type='store-skus'` → ZIP con los SKUs reales del store.
   */
  async getBulkImageTemplate(type: 'example' | 'store-skus' = 'example'): Promise<Blob> {
    const res = await apiClient.get(
      `${Endpoints.STORE.PRODUCTS.BULK_IMAGES_TEMPLATE}?type=${type}`,
      { responseType: 'blob' },
    );
    return res.data as Blob;
  },

  /**
   * Analiza un ZIP de imágenes (dry-run). Devuelve el session_id y el
   * análisis SKU por SKU con advertencias/errores.
   */
  async analyzeBulkImages(file: { uri: string; name: string; size: number }): Promise<BulkImageAnalysisResult & { session_id: string }> {
    const formData = new FormData();
    // @ts-expect-error RN FormData accepts file objects with uri/name/type
    formData.append('file', {
      uri: file.uri,
      name: file.name,
      type: 'application/zip',
    });
    const res = await apiClient.post(Endpoints.STORE.PRODUCTS.BULK_IMAGES_ANALYZE, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return unwrap<BulkImageAnalysisResult & { session_id: string }>(res);
  },

  /**
   * Procesa las imágenes de una sesión previamente analizada.
   */
  async uploadBulkImagesFromSession(sessionId: string): Promise<BulkImageUploadResult> {
    const res = await apiClient.post(
      Endpoints.STORE.PRODUCTS.BULK_IMAGES_UPLOAD_SESSION,
      { session_id: sessionId },
    );
    return unwrap<BulkImageUploadResult>(res);
  },
};

export interface BulkImageAnalysisResult {
  total_skus: number;
  ready: number;
  with_warnings: number;
  with_errors: number;
  skus: Array<{
    sku: string;
    product_name: string | null;
    images_in_zip: number;
    valid_images: number;
    current_image_count: number;
    images_to_upload: number;
    status: 'ready' | 'warning' | 'error';
    warnings: string[];
    errors: string[];
  }>;
}

export interface BulkImageUploadResult {
  total_skus_processed: number;
  successful: number;
  failed: number;
  skipped: number;
  results: Array<{
    sku: string;
    status: 'success' | 'error' | 'skipped';
    message: string;
  }>;
}
