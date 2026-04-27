import { apiClient, Endpoints } from '@/core/api';
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
} from '../types';

function unwrap<T>(response: { data: T | ApiResponse<T> }): T {
  const d = response.data as ApiResponse<T>;
  if (d && typeof d === 'object' && 'success' in d) return d.data;
  return response.data as T;
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
    };
    const res = await apiClient.get(`${Endpoints.STORE.PRODUCTS.LIST}${buildQuery(params)}`);
    return unwrap<PaginatedResponse<Product>>(res);
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
    const res = await apiClient.get(`${Endpoints.STORE.PRODUCTS.SEARCH}?search=${encodeURIComponent(query)}&limit=${limit}`);
    return unwrap<PaginatedResponse<Product>>(res);
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

  async getCategories(): Promise<ProductCategory[]> {
    const res = await apiClient.get(Endpoints.STORE.CATEGORIES.LIST);
    return unwrap<ProductCategory[]>(res);
  },

  async getBrands(): Promise<Brand[]> {
    const res = await apiClient.get(Endpoints.STORE.BRANDS.LIST);
    return unwrap<Brand[]>(res);
  },
};
