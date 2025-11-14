import { Injectable } from '@angular/core';
import { Observable, of, BehaviorSubject } from 'rxjs';
import { delay, map } from 'rxjs/operators';

export interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  cost?: number;
  category: string;
  brand?: string;
  stock: number;
  minStock: number;
  image?: string;
  description?: string;
  barcode?: string;
  tags?: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SearchFilters {
  query?: string;
  category?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  sortBy?: 'name' | 'price' | 'stock' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

export interface SearchResult {
  products: Product[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

@Injectable({
  providedIn: 'root',
})
export class PosProductService {
  private products: Product[] = [];
  private categories: string[] = [];
  private brands: string[] = [];
  private searchHistory$ = new BehaviorSubject<string[]>([]);

  constructor() {
    this.initializeMockData();
  }

  private initializeMockData(): void {
    this.products = [
      {
        id: '1',
        name: 'Laptop Dell Inspiron 15',
        sku: 'LAP-DEL-001',
        price: 899.99,
        cost: 650.0,
        category: 'Electrónica',
        brand: 'Dell',
        stock: 15,
        minStock: 5,
        barcode: '1234567890123',
        tags: ['computadora', 'portátil', 'dell'],
        isActive: true,
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-01-15'),
      },
      {
        id: '2',
        name: 'Mouse Logitech MX Master 3',
        sku: 'MOU-LOG-002',
        price: 99.99,
        cost: 65.0,
        category: 'Accesorios',
        brand: 'Logitech',
        stock: 25,
        minStock: 10,
        barcode: '2345678901234',
        tags: ['mouse', 'inalámbrico', 'logitech'],
        isActive: true,
        createdAt: new Date('2024-01-16'),
        updatedAt: new Date('2024-01-16'),
      },
      {
        id: '3',
        name: 'Teclado Mecánico RGB',
        sku: 'KEY-MEC-003',
        price: 129.99,
        cost: 85.0,
        category: 'Accesorios',
        brand: 'Corsair',
        stock: 8,
        minStock: 5,
        barcode: '3456789012345',
        tags: ['teclado', 'mecánico', 'rgb'],
        isActive: true,
        createdAt: new Date('2024-01-17'),
        updatedAt: new Date('2024-01-17'),
      },
      {
        id: '4',
        name: 'Monitor LG 27" 4K',
        sku: 'MON-LG-004',
        price: 449.99,
        cost: 320.0,
        category: 'Electrónica',
        brand: 'LG',
        stock: 12,
        minStock: 3,
        barcode: '4567890123456',
        tags: ['monitor', '4k', 'lg'],
        isActive: true,
        createdAt: new Date('2024-01-18'),
        updatedAt: new Date('2024-01-18'),
      },
      {
        id: '5',
        name: 'Auriculares Bluetooth Sony',
        sku: 'AUD-SON-005',
        price: 199.99,
        cost: 140.0,
        category: 'Audio',
        brand: 'Sony',
        stock: 0,
        minStock: 5,
        barcode: '5678901234567',
        tags: ['auriculares', 'bluetooth', 'sony'],
        isActive: true,
        createdAt: new Date('2024-01-19'),
        updatedAt: new Date('2024-01-19'),
      },
      {
        id: '6',
        name: 'USB-C Hub 7-en-1',
        sku: 'HUB-USB-006',
        price: 49.99,
        cost: 25.0,
        category: 'Accesorios',
        brand: 'Anker',
        stock: 30,
        minStock: 10,
        barcode: '6789012345678',
        tags: ['hub', 'usb-c', 'anker'],
        isActive: true,
        createdAt: new Date('2024-01-20'),
        updatedAt: new Date('2024-01-20'),
      },
      {
        id: '7',
        name: 'Webcam HD 1080p',
        sku: 'CAM-HD-007',
        price: 79.99,
        cost: 45.0,
        category: 'Accesorios',
        brand: 'Logitech',
        stock: 18,
        minStock: 8,
        barcode: '7890123456789',
        tags: ['webcam', 'hd', 'logitech'],
        isActive: true,
        createdAt: new Date('2024-01-21'),
        updatedAt: new Date('2024-01-21'),
      },
      {
        id: '8',
        name: 'Silla Gaming Ergonómica',
        sku: 'SIL-GAM-008',
        price: 299.99,
        cost: 180.0,
        category: 'Muebles',
        brand: 'DXRacer',
        stock: 6,
        minStock: 2,
        barcode: '8901234567890',
        tags: ['silla', 'gaming', 'ergonómica'],
        isActive: true,
        createdAt: new Date('2024-01-22'),
        updatedAt: new Date('2024-01-22'),
      },
    ];

    this.categories = [...new Set(this.products.map((p) => p.category))];
    this.brands = [
      ...new Set(
        this.products
          .map((p) => p.brand)
          .filter((brand): brand is string => Boolean(brand)),
      ),
    ];
  }

  searchProducts(
    filters: SearchFilters,
    page: number = 1,
    pageSize: number = 20,
  ): Observable<SearchResult> {
    return of(filters).pipe(
      delay(300),
      map(() => {
        let filteredProducts = this.products.filter((p) => p.isActive);

        if (filters.query) {
          const query = filters.query.toLowerCase();
          filteredProducts = filteredProducts.filter(
            (p) =>
              p.name.toLowerCase().includes(query) ||
              p.sku.toLowerCase().includes(query) ||
              p.barcode?.includes(query) ||
              p.tags?.some((tag) => tag.toLowerCase().includes(query)),
          );

          this.addToSearchHistory(filters.query);
        }

        if (filters.category) {
          filteredProducts = filteredProducts.filter(
            (p) => p.category === filters.category,
          );
        }

        if (filters.brand) {
          filteredProducts = filteredProducts.filter(
            (p) => p.brand === filters.brand,
          );
        }

        if (filters.minPrice !== undefined) {
          filteredProducts = filteredProducts.filter(
            (p) => p.price >= filters.minPrice!,
          );
        }

        if (filters.maxPrice !== undefined) {
          filteredProducts = filteredProducts.filter(
            (p) => p.price <= filters.maxPrice!,
          );
        }

        if (filters.inStock) {
          filteredProducts = filteredProducts.filter((p) => p.stock > 0);
        }

        if (filters.sortBy) {
          filteredProducts.sort((a, b) => {
            let aValue: any = a[filters.sortBy!];
            let bValue: any = b[filters.sortBy!];

            if (filters.sortBy === 'name') {
              aValue = aValue.toLowerCase();
              bValue = bValue.toLowerCase();
            }

            if (filters.sortOrder === 'desc') {
              return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
            } else {
              return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
            }
          });
        }

        const total = filteredProducts.length;
        const totalPages = Math.ceil(total / pageSize);
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

        return {
          products: paginatedProducts,
          total,
          page,
          pageSize,
          totalPages,
        };
      }),
    );
  }

  getProductByBarcode(barcode: string): Observable<Product | null> {
    return of(barcode).pipe(
      delay(100),
      map(() => {
        const product = this.products.find(
          (p) => p.barcode === barcode && p.isActive,
        );
        return product || null;
      }),
    );
  }

  getProductById(id: string): Observable<Product | null> {
    return of(id).pipe(
      delay(100),
      map(() => {
        const product = this.products.find((p) => p.id === id && p.isActive);
        return product || null;
      }),
    );
  }

  getProductBySku(sku: string): Observable<Product | null> {
    return of(sku).pipe(
      delay(100),
      map(() => {
        const product = this.products.find(
          (p) => p.sku.toLowerCase() === sku.toLowerCase() && p.isActive,
        );
        return product || null;
      }),
    );
  }

  getCategories(): Observable<string[]> {
    return of(this.categories).pipe(delay(100));
  }

  getBrands(): Observable<string[]> {
    return of(this.brands).pipe(delay(100));
  }

  getSearchHistory(): Observable<string[]> {
    return this.searchHistory$.asObservable();
  }

  private addToSearchHistory(query: string): void {
    if (!query || query.trim().length < 2) return;

    const currentHistory = this.searchHistory$.value;
    const updatedHistory = [
      query.trim(),
      ...currentHistory.filter((q) => q !== query.trim()),
    ].slice(0, 10);
    this.searchHistory$.next(updatedHistory);
  }

  clearSearchHistory(): void {
    this.searchHistory$.next([]);
  }

  getPopularProducts(limit: number = 10): Observable<Product[]> {
    return of(
      this.products
        .filter((p) => p.isActive && p.stock > 0)
        .sort((a, b) => b.stock - a.stock)
        .slice(0, limit),
    ).pipe(delay(200));
  }

  getLowStockProducts(): Observable<Product[]> {
    return of(
      this.products
        .filter((p) => p.isActive && p.stock <= p.minStock)
        .sort((a, b) => a.stock - b.stock),
    ).pipe(delay(200));
  }

  updateStock(productId: string, quantity: number): Observable<Product | null> {
    return of(productId).pipe(
      delay(100),
      map(() => {
        const product = this.products.find((p) => p.id === productId);
        if (product) {
          product.stock = Math.max(0, product.stock - quantity);
          product.updatedAt = new Date();
        }
        return product || null;
      }),
    );
  }
}
