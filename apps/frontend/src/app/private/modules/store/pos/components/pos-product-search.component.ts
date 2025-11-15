import {
  Component,
  EventEmitter,
  Output,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Subject,
  debounceTime,
  distinctUntilChanged,
  takeUntil,
  Observable,
} from 'rxjs';
import {
  PosProductService,
  SearchFilters,
  Product,
  Category,
  Brand,
} from '../services/pos-product.service';

@Component({
  selector: 'app-pos-product-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="product-search-container">
      <div class="search-header">
        <div class="search-input-group">
          <div class="search-input-wrapper">
            <i class="fas fa-search search-icon"></i>
            <input
              type="text"
              class="search-input"
              placeholder="Buscar productos por nombre, SKU o código de barras..."
              [(ngModel)]="searchQuery"
              (input)="onSearchInput($event)"
              (keyup.enter)="performSearch()"
              (keyup.escape)="clearSearch()"
            />
            <button
              *ngIf="searchQuery"
              class="clear-search-btn"
              (click)="clearSearch()"
              type="button"
            >
              <i class="fas fa-times"></i>
            </button>
          </div>
          <button
            class="barcode-scan-btn"
            (click)="toggleBarcodeScanner()"
            type="button"
            title="Escanear código de barras"
          >
            <i class="fas fa-barcode"></i>
          </button>
        </div>

        <div class="search-actions">
          <button
            class="filter-toggle-btn"
            (click)="toggleFilters()"
            [class.active]="showFilters"
            type="button"
          >
            <i class="fas fa-filter"></i>
            Filtros
            <span *ngIf="activeFiltersCount > 0" class="filter-count">
              {{ activeFiltersCount }}
            </span>
          </button>
        </div>
      </div>

      <div class="search-filters" *ngIf="showFilters">
        <div class="filters-grid">
          <div class="filter-group">
            <label for="category-filter">Categoría</label>
            <select
              id="category-filter"
              class="filter-select"
              [(ngModel)]="filters.category"
              (change)="applyFilters()"
            >
              <option value="">Todas las categorías</option>
              <option
                *ngFor="let category of categories$ | async"
                [value]="category.id"
              >
                {{ category.name }}
              </option>
            </select>
          </div>

          <div class="filter-group">
            <label for="brand-filter">Marca</label>
            <select
              id="brand-filter"
              class="filter-select"
              [(ngModel)]="filters.brand"
              (change)="applyFilters()"
            >
              <option value="">Todas las marcas</option>
              <option *ngFor="let brand of brands$ | async" [value]="brand.id">
                {{ brand.name }}
              </option>
            </select>
          </div>

          <div class="filter-group">
            <label for="min-price-filter">Precio Mínimo</label>
            <input
              type="number"
              id="min-price-filter"
              class="filter-input"
              [(ngModel)]="filters.minPrice"
              (change)="applyFilters()"
              placeholder="0.00"
              step="0.01"
              min="0"
            />
          </div>

          <div class="filter-group">
            <label for="max-price-filter">Precio Máximo</label>
            <input
              type="number"
              id="max-price-filter"
              class="filter-input"
              [(ngModel)]="filters.maxPrice"
              (change)="applyFilters()"
              placeholder="999.99"
              step="0.01"
              min="0"
            />
          </div>

          <div class="filter-group">
            <label class="checkbox-label">
              <input
                type="checkbox"
                [(ngModel)]="filters.inStock"
                (change)="applyFilters()"
              />
              Solo productos con stock
            </label>
          </div>

          <div class="filter-group">
            <label for="sort-filter">Ordenar por</label>
            <select
              id="sort-filter"
              class="filter-select"
              [(ngModel)]="filters.sortBy"
              (change)="applyFilters()"
            >
              <option value="">Relevancia</option>
              <option value="name">Nombre</option>
              <option value="price">Precio</option>
              <option value="stock">Stock</option>
              <option value="createdAt">Fecha de creación</option>
            </select>
          </div>

          <div class="filter-group" *ngIf="filters.sortBy">
            <label for="sort-order">Orden</label>
            <select
              id="sort-order"
              class="filter-select"
              [(ngModel)]="filters.sortOrder"
              (change)="applyFilters()"
            >
              <option value="asc">Ascendente</option>
              <option value="desc">Descendente</option>
            </select>
          </div>
        </div>

        <div class="filter-actions">
          <button
            class="btn btn-secondary"
            (click)="clearFilters()"
            type="button"
          >
            Limpiar Filtros
          </button>
        </div>
      </div>

      <div
        class="search-suggestions"
        *ngIf="
          showSuggestions &&
          (suggestions$ | async)?.length &&
          (suggestions$ | async)!.length > 0
        "
      >
        <div class="suggestions-list">
          <div
            *ngFor="let suggestion of suggestions$ | async"
            class="suggestion-item"
            (click)="selectSuggestion(suggestion)"
          >
            <i class="fas fa-history"></i>
            {{ suggestion }}
          </div>
        </div>
      </div>

      <div class="barcode-scanner" *ngIf="showBarcodeScanner">
        <div class="scanner-content">
          <h3>Escanear Código de Barras</h3>
          <input
            type="text"
            class="barcode-input"
            [(ngModel)]="barcodeInput"
            (keyup.enter)="processBarcode()"
            (keyup.escape)="toggleBarcodeScanner()"
            placeholder="Ingrese o escanee código de barras"
            autofocus
          />
          <div class="scanner-actions">
            <button
              class="btn btn-secondary"
              (click)="toggleBarcodeScanner()"
              type="button"
            >
              Cancelar
            </button>
            <button
              class="btn btn-primary"
              (click)="processBarcode()"
              type="button"
            >
              Buscar
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .product-search-container {
        background: white;
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        margin-bottom: 20px;
      }

      .search-header {
        display: flex;
        gap: 16px;
        align-items: center;
        margin-bottom: 16px;
      }

      .search-input-group {
        flex: 1;
        display: flex;
        gap: 8px;
      }

      .search-input-wrapper {
        flex: 1;
        position: relative;
        display: flex;
        align-items: center;
      }

      .search-icon {
        position: absolute;
        left: 12px;
        color: #6b7280;
        z-index: 1;
      }

      .search-input {
        width: 100%;
        padding: 12px 16px 12px 40px;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        font-size: 16px;
        transition: border-color 0.3s ease;
      }

      .search-input:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .clear-search-btn {
        position: absolute;
        right: 12px;
        background: none;
        border: none;
        color: #6b7280;
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        transition: background-color 0.3s ease;
      }

      .clear-search-btn:hover {
        background-color: #f3f4f6;
      }

      .barcode-scan-btn {
        padding: 12px 16px;
        background-color: #f3f4f6;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        color: #374151;
        cursor: pointer;
        transition: all 0.3s ease;
      }

      .barcode-scan-btn:hover {
        background-color: #e5e7eb;
        border-color: #d1d5db;
      }

      .search-actions {
        display: flex;
        gap: 8px;
      }

      .filter-toggle-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 16px;
        background-color: #f3f4f6;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        color: #374151;
        cursor: pointer;
        transition: all 0.3s ease;
        position: relative;
      }

      .filter-toggle-btn:hover,
      .filter-toggle-btn.active {
        background-color: #3b82f6;
        border-color: #3b82f6;
        color: white;
      }

      .filter-count {
        background-color: #ef4444;
        color: white;
        border-radius: 50%;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: bold;
      }

      .search-filters {
        background-color: #f9fafb;
        border-radius: 8px;
        padding: 20px;
        margin-bottom: 16px;
      }

      .filters-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 16px;
        margin-bottom: 16px;
      }

      .filter-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .filter-group label {
        font-weight: 500;
        color: #374151;
        font-size: 14px;
      }

      .filter-select,
      .filter-input {
        padding: 8px 12px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 14px;
        transition: border-color 0.3s ease;
      }

      .filter-select:focus,
      .filter-input:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .checkbox-label {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        font-size: 14px;
      }

      .checkbox-label input[type='checkbox'] {
        margin: 0;
      }

      .filter-actions {
        display: flex;
        justify-content: flex-end;
      }

      .btn {
        padding: 8px 16px;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s ease;
      }

      .btn-primary {
        background-color: #3b82f6;
        color: white;
      }

      .btn-primary:hover {
        background-color: #2563eb;
      }

      .btn-secondary {
        background-color: #6b7280;
        color: white;
      }

      .btn-secondary:hover {
        background-color: #4b5563;
      }

      .search-suggestions {
        position: relative;
        background-color: white;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        z-index: 10;
      }

      .suggestions-list {
        max-height: 200px;
        overflow-y: auto;
      }

      .suggestion-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        cursor: pointer;
        transition: background-color 0.3s ease;
        border-bottom: 1px solid #f3f4f6;
      }

      .suggestion-item:last-child {
        border-bottom: none;
      }

      .suggestion-item:hover {
        background-color: #f9fafb;
      }

      .suggestion-item i {
        color: #6b7280;
        font-size: 14px;
      }

      .barcode-scanner {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }

      .scanner-content {
        background: white;
        border-radius: 12px;
        padding: 32px;
        max-width: 400px;
        width: 90%;
        text-align: center;
      }

      .scanner-content h3 {
        margin-bottom: 20px;
        color: #1f2937;
      }

      .barcode-input {
        width: 100%;
        padding: 16px;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        font-size: 18px;
        text-align: center;
        margin-bottom: 20px;
      }

      .barcode-input:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .scanner-actions {
        display: flex;
        gap: 12px;
        justify-content: center;
      }

      @media (max-width: 768px) {
        .search-header {
          flex-direction: column;
          align-items: stretch;
        }

        .filters-grid {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class PosProductSearchComponent implements OnInit, OnDestroy {
  @Output() search = new EventEmitter<SearchFilters>();
  @Output() productSelected = new EventEmitter<Product>();
  @Output() barcodeScanned = new EventEmitter<string>();

  searchQuery: string = '';
  showFilters: boolean = false;
  showSuggestions: boolean = false;
  showBarcodeScanner: boolean = false;
  barcodeInput: string = '';

  filters: SearchFilters = {
    query: '',
    category: '',
    brand: '',
    minPrice: undefined,
    maxPrice: undefined,
    inStock: false,
    sortBy: undefined,
    sortOrder: 'asc',
  };

  categories$!: Observable<Category[]>;
  brands$!: Observable<Brand[]>;
  suggestions$!: Observable<string[]>;

  private searchSubject = new Subject<string>();
  private destroy$ = new Subject<void>();

  constructor(private productService: PosProductService) {}

  ngOnInit(): void {
    this.categories$ = this.productService.getCategories();
    this.brands$ = this.productService.getBrands();
    this.suggestions$ = this.productService.getSearchHistory();

    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((query) => {
        this.filters.query = query;
        this.performSearch();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery = value;
    this.showSuggestions = value.length > 0;

    if (value.length >= 2) {
      this.searchSubject.next(value);
    }
  }

  performSearch(): void {
    this.showSuggestions = false;
    this.search.emit({ ...this.filters });
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.filters.query = '';
    this.showSuggestions = false;
    this.search.emit({ ...this.filters });
  }

  toggleFilters(): void {
    this.showFilters = !this.showFilters;
  }

  applyFilters(): void {
    this.performSearch();
  }

  clearFilters(): void {
    this.filters = {
      query: this.searchQuery,
      category: '',
      brand: '',
      minPrice: undefined,
      maxPrice: undefined,
      inStock: false,
      sortBy: undefined,
      sortOrder: 'asc',
    };
    this.performSearch();
  }

  selectSuggestion(suggestion: string): void {
    this.searchQuery = suggestion;
    this.filters.query = suggestion;
    this.showSuggestions = false;
    this.performSearch();
  }

  toggleBarcodeScanner(): void {
    this.showBarcodeScanner = !this.showBarcodeScanner;
    if (this.showBarcodeScanner) {
      this.barcodeInput = '';
    }
  }

  processBarcode(): void {
    if (this.barcodeInput.trim()) {
      this.barcodeScanned.emit(this.barcodeInput.trim());
      this.toggleBarcodeScanner();
    }
  }

  get activeFiltersCount(): number {
    let count = 0;
    if (this.filters.category) count++;
    if (this.filters.brand) count++;
    if (this.filters.minPrice !== undefined) count++;
    if (this.filters.maxPrice !== undefined) count++;
    if (this.filters.inStock) count++;
    if (this.filters.sortBy) count++;
    return count;
  }
}
