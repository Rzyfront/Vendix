import {
  Component,
  Input,
  Output,
  EventEmitter,
  forwardRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormsModule,
  ReactiveFormsModule,
  NG_VALUE_ACCESSOR,
  ControlValueAccessor,
} from '@angular/forms';
import { FormBuilder } from '@angular/forms';
import { CurrencyPipe } from '@angular/common';

import { ProductsService, Product } from '../services/products.service';
import { InputComponent } from '../../../../../shared/components/input/input.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-product-selector',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    InputComponent,
    IconComponent,
  ],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ProductSelectorComponent),
      multi: true,
    },
  ],
  template: `
    <div class="product-selector">
      <div class="relative">
        <app-input
          [formControl]="searchControl"
          [label]="label"
          [placeholder]="placeholder"
          [required]="required"
          [control]="searchControl"
          (input)="onSearchInput($event)"
        >
          <app-icon name="search" [size]="16" slot="suffix"></app-icon>
        </app-input>

        <!-- Dropdown de resultados -->
        <div
          *ngIf="showDropdown && searchResults.length > 0"
          class="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto"
        >
          <div
            *ngFor="let product of searchResults"
            class="px-4 py-3 hover:bg-gray-100 cursor-pointer border-b border-gray-100 last:border-b-0"
            (click)="selectProduct(product)"
          >
            <div class="flex justify-between items-start">
              <div class="flex-1">
                <div class="font-medium text-gray-900">{{ product.name }}</div>
                <div class="text-sm text-gray-500">SKU: {{ product.sku }}</div>
                <div class="text-sm text-gray-500">
                  Stock: {{ product.stock_quantity }} unidades
                </div>
              </div>
              <div class="text-right ml-4">
                <div class="font-medium text-gray-900">
                  {{ product.price | currency }}
                </div>
                <div class="text-sm text-gray-500" *ngIf="product.category">
                  {{ product.category.name }}
                </div>
                <div class="text-sm text-gray-500" *ngIf="product.brand">
                  {{ product.brand.name }}
                </div>
              </div>
            </div>
          </div>

          <div
            *ngIf="searchResults.length === 0 && searchControl.value"
            class="px-4 py-3 text-gray-500 text-center"
          >
            No se encontraron productos
          </div>
        </div>
      </div>

      <!-- Producto seleccionado -->
      <div *ngIf="selectedProduct" class="mt-2 p-3 bg-gray-50 rounded-md">
        <div class="flex justify-between items-center">
          <div>
            <div class="font-medium">{{ selectedProduct.name }}</div>
            <div class="text-sm text-gray-500">
              SKU: {{ selectedProduct.sku }}
            </div>
            <div class="text-sm text-green-600">
              Stock disponible: {{ selectedProduct.stock_quantity }} unidades
            </div>
          </div>
          <div class="text-right">
            <div class="font-medium">
              {{ selectedProduct.price | currency }}
            </div>
            <button
              type="button"
              (click)="clearSelection()"
              class="mt-1 text-sm text-red-600 hover:text-red-800"
            >
              Cambiar producto
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .product-selector {
        position: relative;
      }

      .product-selector .absolute {
        top: 100%;
        left: 0;
        right: 0;
      }
    `,
  ],
})
export class ProductSelectorComponent implements ControlValueAccessor {
  @Input() label: string = 'Producto';
  @Input() placeholder: string = 'Buscar producto...';
  @Input() required: boolean = false;
  @Input() storeId: number | null = null;
  @Output() productSelected = new EventEmitter<Product>();
  @Output() inventoryChecked = new EventEmitter<{
    available: boolean;
    stock: number;
  }>();

  searchControl: any;
  showDropdown = false;
  searchResults: Product[] = [];
  selectedProduct: Product | null = null;
  private searchTimeout: any;

  constructor(
    private productsService: ProductsService,
    private currencyPipe: CurrencyPipe,
  ) {
    this.searchControl = { value: '', setValue: () => {} };
  }

  onSearchInput(event: any): void {
    const value = event.target?.value || event;

    // Limpiar timeout anterior
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }

    // Si está vacío, limpiar resultados
    if (!value || value.trim() === '') {
      this.searchResults = [];
      this.showDropdown = false;
      return;
    }

    // Esperar 300ms antes de buscar (debounce)
    this.searchTimeout = setTimeout(() => {
      this.searchProducts(value.trim());
    }, 300);
  }

  private searchProducts(query: string): void {
    if (!this.storeId) {
      console.warn('Store ID is required for product search');
      return;
    }

    this.productsService
      .searchProducts({
        search: query,
        store_id: this.storeId,
        is_active: true,
        limit: 10,
        sort_by: 'name',
        sort_order: 'asc',
      })
      .subscribe({
        next: (response) => {
          this.searchResults = response.data || [];
          this.showDropdown = true;
        },
        error: (error) => {
          console.error('Error searching products:', error);
          this.searchResults = [];
          this.showDropdown = true;
        },
      });
  }

  selectProduct(product: Product): void {
    this.selectedProduct = product;
    this.searchControl.setValue(product.name);
    this.showDropdown = false;
    this.searchResults = [];

    // Verificar inventario
    this.checkInventory(product);

    // Emitir eventos
    this.productSelected.emit(product);
    this.onChange(product);
    this.onTouched();
  }

  private checkInventory(product: Product): void {
    this.productsService
      .checkInventory(product.id, undefined, this.storeId || undefined)
      .subscribe({
        next: (inventory) => {
          this.inventoryChecked.emit({
            available: inventory.available,
            stock: inventory.stock_quantity,
          });
        },
        error: (error) => {
          console.error('Error checking inventory:', error);
          this.inventoryChecked.emit({
            available: false,
            stock: 0,
          });
        },
      });
  }

  clearSelection(): void {
    this.selectedProduct = null;
    this.searchControl.setValue('');
    this.showDropdown = false;
    this.searchResults = [];
    this.onChange(null);
  }

  // ControlValueAccessor implementation
  onChange: any = () => {};
  onTouched: any = () => {};

  writeValue(value: Product | null): void {
    if (value) {
      this.selectedProduct = value;
      this.searchControl.setValue(value.name);
    } else {
      this.selectedProduct = null;
      this.searchControl.setValue('');
    }
  }

  registerOnChange(fn: any): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    if (isDisabled) {
      this.searchControl.disable();
    } else {
      this.searchControl.enable();
    }
  }
}
