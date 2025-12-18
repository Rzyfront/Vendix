import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InputsearchComponent, IconComponent, ButtonComponent } from '../../../../../../../shared/components';
import { ProductsService } from '../../../../products/services/products.service';
import { PopCartService } from '../services/pop-cart.service';
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';

@Component({
    selector: 'app-pop-product-selection',
    standalone: true,
    imports: [
        CommonModule,
        InputsearchComponent,
        IconComponent
    ],
    template: `
    <div class="flex flex-col h-full gap-4">
      <!-- Search Bar -->
      <app-inputsearch
        placeholder="Buscar producto por nombre, SKU o código de barras..."
        [debounceTime]="300"
        (search)="onSearch($event)"
        class="w-full"
      ></app-inputsearch>

      <!-- Products Grid -->
      <div class="flex-1 overflow-y-auto min-h-0 pr-2">
        
        <div *ngIf="loading" class="flex justify-center py-8">
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>

        <div *ngIf="!loading && products.length === 0" class="flex flex-col items-center justify-center h-48 text-text-secondary">
            <app-icon name="search" [size]="48" class="mb-2 opacity-50"></app-icon>
            <p>No se encontraron productos</p>
        </div>

        <div *ngIf="!loading && products.length > 0" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div 
            *ngFor="let product of products"
            class="group bg-surface border border-border rounded-lg p-3 hover:border-primary hover:shadow-md transition-all cursor-pointer flex flex-col gap-2"
            (click)="onSelectProduct(product)"
          >
            <!-- Product Header -->
            <div class="flex justify-between items-start gap-2">
                <div class="min-w-0">
                    <h3 class="font-medium text-text-primary text-sm line-clamp-2" [title]="product.name">
                        {{ product.name }}
                    </h3>
                    <p class="text-xs text-text-secondary truncate">
                        SKU: {{ product.sku || 'N/A' }}
                    </p>
                </div>
                <!-- Optional Image or Icon placeholder -->
                <div class="w-10 h-10 bg-surface-50 rounded flex items-center justify-center flex-shrink-0">
                    <app-icon name="package" [size]="18" class="text-text-secondary"></app-icon>
                </div>
            </div>

            <!-- Stock & Price Info -->
            <div class="mt-auto pt-2 border-t border-border/50 flex justify-between items-end">
                <div class="flex flex-col">
                    <span class="text-[10px] text-text-secondary uppercase tracking-wider">Costo Base</span>
                    <span class="font-semibold text-text-primary">
                        {{ product.base_price | currency:'COP':'symbol-narrow':'1.0-0' }}
                    </span>
                </div>
                <button 
                    class="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    (click)="$event.stopPropagation(); onSelectProduct(product)"
                >
                    <app-icon name="plus" [size]="14"></app-icon>
                </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  `,
    styles: [`
    :host {
      display: block;
      height: 100%;
    }
  `]
})
export class PopProductSelectionComponent implements OnInit, OnDestroy {
    products: any[] = [];
    loading = false;
    searchTerm = '';
    private destroy$ = new Subject<void>();
    private searchSubject = new Subject<string>();

    constructor(
        private productsService: ProductsService,
        private popCartService: PopCartService
    ) { }

    ngOnInit(): void {
        this.setupSearch();
        this.loadProducts();
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    setupSearch() {
        this.searchSubject.pipe(
            debounceTime(300),
            distinctUntilChanged(),
            takeUntil(this.destroy$)
        ).subscribe(term => {
            this.searchTerm = term;
            this.loadProducts();
        });
    }

    onSearch(term: string) {
        this.searchSubject.next(term);
    }

    loadProducts() {
        this.loading = true;
        const params: any = {
            page: 1,
            limit: 50
        };

        if (this.searchTerm) {
            params.search = this.searchTerm;
        }

        this.productsService.getProducts(params).subscribe({
            next: (res: any) => {
                this.products = res.data || [];
                this.loading = false;
            },
            error: () => {
                this.loading = false;
                // Handle error silently or via toast
            }
        });
    }

    onSelectProduct(product: any) {
        // Add to cart service
        this.popCartService.addItem(product);
    }
}
