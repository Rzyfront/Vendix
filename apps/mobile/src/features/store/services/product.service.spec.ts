import { ProductService } from './product.service';
import { apiClient } from '@/core/api';

jest.mock('@/core/api', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  Endpoints: { STORE: { PRODUCTS: { LIST: '/store/products', SEARCH: '/store/products' } } },
}));

const mockClient = apiClient as unknown as { get: jest.Mock };

function sentUrl(): string {
  expect(mockClient.get).toHaveBeenCalledTimes(1);
  return mockClient.get.mock.calls[0][0] as string;
}

function sentKeys(url: string): string[] {
  const qs = url.split('?')[1] ?? '';
  return qs
    .split('&')
    .filter(Boolean)
    .map((part) => part.split('=')[0]);
}

describe('ProductService E.3 (F-025/F-059)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.get.mockResolvedValue({ data: { success: true, data: [], meta: { total: 0 } } });
  });

  it('list() hace strip de keys no-whitelisted (nunca viajan por la red)', async () => {
    await ProductService.list({
      page: 1,
      limit: 50,
      state: 'active',
      pos_optimized: true,
      include_variants: true,
      min_price: 1000,
      max_price: 5000,
      in_stock: true,
      sort_by: 'price',
      sort_order: 'desc',
    } as any);

    const keys = sentKeys(sentUrl());
    for (const banned of ['min_price', 'max_price', 'in_stock', 'sort_by', 'sort_order']) {
      expect(keys).not.toContain(banned);
    }
    // Whitelisted intactas.
    for (const kept of ['page', 'limit', 'state', 'pos_optimized', 'include_variants']) {
      expect(keys).toContain(kept);
    }
  });

  it('list() con filtro precio activo genera URL 200-segura (solo DTO)', async () => {
    await ProductService.list({ min_price: 1000, limit: 50 } as any);

    const keys = sentKeys(sentUrl());
    // Subconjunto estricto de ProductQueryDto (page/limit/search/state/
    // store_id/category_id/brand_id/include_inactive/pos_optimized/barcode/
    // include_stock/include_variants/track_inventory/product_type/...).
    const allowed = new Set([
      'page',
      'limit',
      'search',
      'state',
      'store_id',
      'category_id',
      'brand_id',
      'include_inactive',
      'pos_optimized',
      'barcode',
      'include_stock',
      'include_variants',
      'track_inventory',
      'product_type',
      'requires_booking',
      'is_sellable',
    ]);
    for (const key of keys) expect(allowed.has(key)).toBe(true);
  });

  it('search() envía page (load-more) y solo keys whitelisted', async () => {
    await ProductService.search('cafe', 20, 2);

    const url = sentUrl();
    expect(url).toContain('page=2');
    expect(url).toContain('search=cafe');
    const keys = sentKeys(url);
    expect(keys.sort()).toEqual(
      ['include_variants', 'limit', 'page', 'pos_optimized', 'search', 'state'].sort(),
    );
  });

  it('search() default sigue página 1 (cero regresión primer pintado)', async () => {
    await ProductService.search('cafe');

    expect(sentUrl()).toContain('page=1');
    expect(sentUrl()).toContain('limit=20');
  });
});
