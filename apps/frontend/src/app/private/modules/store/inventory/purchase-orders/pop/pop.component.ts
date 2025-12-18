import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PopCartService } from './services/pop-cart.service';
import {
    CardComponent,
    IconComponent,
    ButtonComponent,
    SelectorComponent,
    SelectorOption
} from '../../../../../../shared/components';
import { SuppliersService, LocationsService } from '../../services';
import { PopProductSelectionComponent } from './components/pop-product-selection.component';
import { PopCartComponent } from './components/pop-cart.component';
import { PopCartSummary } from './services/pop-cart.service';
import { Subscription } from 'rxjs';

@Component({
    selector: 'app-pop',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        CardComponent,
        IconComponent,
        ButtonComponent,
        SelectorComponent,
        PopProductSelectionComponent,
        PopCartComponent
    ],
    template: `
    <div class="h-full flex flex-col gap-4 p-4 overflow-hidden bg-background">
      <!-- Header / Configuration Area -->
      <div class="flex-none">
        <!-- <app-pop-header></app-pop-header> -->
         <app-card [padding]="true">
            <div class="flex justify-between items-center">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                         <app-icon name="shopping-bag" class="text-primary" [size]="24"></app-icon>
                    </div>
                    <div>
                        <h1 class="text-xl font-bold text-text-primary">Orden de Compra</h1>
                        <p class="text-sm text-text-secondary">Point of Purchase</p>
                    </div>
                </div>
                <!-- Placeholder for Global Actions -->
        <app-button variant="outline" size="sm">
            <app-icon name="upload" class="mr-2" [size]="16"></app-icon>
            Importar CSV
        </app-button>
        </div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <app-selector
            [options]="supplierOptions"
            [(ngModel)]="selectedSupplierId"
            (valueChange)="onSupplierChange($event)"
            label="Proveedor"
            placeholder="Seleccionar proveedor..."
        ></app-selector>
        <app-selector
            [options]="locationOptions"
            [(ngModel)]="selectedLocationId"
            (valueChange)="onLocationChange($event)"
            label="Ubicación de Destino"
            placeholder="Seleccionar bodega/tienda..."
        ></app-selector>
    </div>
    </app-card>
      </div>

      <!-- Main Content Grid -->
      <div class="flex-1 min-h-0 grid grid-cols-12 gap-4">
        
        <!-- Left: Product Catalog (7 cols) -->
        <div class="col-span-12 lg:col-span-7 h-full flex flex-col min-h-0">
          <app-card class="h-full flex flex-col overflow-hidden" [padding]="false">
             <div class="flex-1 min-h-0 bg-surface">
                 <app-pop-product-selection class="block h-full"></app-pop-product-selection>
             </div>
          </app-card>
        </div>

        <!-- Right: Cart & Totals (5 cols) -->
        <div class="col-span-12 lg:col-span-5 h-full flex flex-col min-h-0">
            <app-card class="h-full flex flex-col overflow-hidden" [padding]="false">
                <div class="p-4 border-b border-border bg-surface-50">
                    <h2 class="font-semibold text-text-primary">Items de la Orden ({{ cartSummary.itemCount }})</h2>
                </div>
                <div class="flex-1 overflow-y-auto min-h-0">
                    <app-pop-cart class="block h-full"></app-pop-cart>
                </div>
                <!-- Footer / Totals -->
                <div class="p-4 border-t border-border bg-surface-50">
                     <div class="space-y-2 mb-4">
                         <div class="flex justify-between text-sm">
                             <span class="text-text-secondary">Subtotal</span>
                             <span class="font-medium">{{ cartSummary.subtotal | currency:'COP':'symbol-narrow':'1.0-0' }}</span>
                         </div>
                         <div class="flex justify-between text-sm">
                             <span class="text-text-secondary">Impuestos</span>
                             <span class="font-medium">{{ cartSummary.taxAmount | currency:'COP':'symbol-narrow':'1.0-0' }}</span>
                         </div>
                         <div class="flex justify-between text-lg font-bold text-primary mt-2 pt-2 border-t border-border">
                             <span>Total</span>
                             <span>{{ cartSummary.total | currency:'COP':'symbol-narrow':'1.0-0' }}</span>
                         </div>
                     </div>
                     <app-button variant="primary" class="w-full" size="lg">
                         Procesar Compra
                     </app-button>
                </div>
            </app-card>
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
export class PopComponent implements OnInit, OnDestroy {

    supplierOptions: SelectorOption[] = [];
    locationOptions: SelectorOption[] = [];

    selectedSupplierId: number | null = null;
    selectedLocationId: number | null = null;

    cartSummary: PopCartSummary = {
        subtotal: 0,
        taxAmount: 0,
        discountAmount: 0,
        total: 0,
        itemCount: 0
    };

    private sub: Subscription | null = null;

    constructor(
        private popCartService: PopCartService,
        private suppliersService: SuppliersService,
        private locationsService: LocationsService
    ) { }

    ngOnInit(): void {
        this.loadSuppliers();
        this.loadLocations();

        this.sub = this.popCartService.cartState$.subscribe(state => {
            this.cartSummary = state.summary;
        });
    }

    ngOnDestroy(): void {
        if (this.sub) {
            this.sub.unsubscribe();
        }
    }

    loadSuppliers() {
        this.suppliersService.getSuppliers({ is_active: true }).subscribe((res: any) => {
            if (res.data) {
                this.supplierOptions = res.data.map((s: any) => ({
                    label: s.name,
                    value: s.id
                }));
            }
        });
    }

    loadLocations() {
        this.locationsService.getLocations({ is_active: true }).subscribe((res: any) => {
            if (res.data) {
                this.locationOptions = res.data.map((l: any) => ({
                    label: l.name,
                    value: l.id
                }));
            }
        });
    }

    onSupplierChange(supplierId: any) {
        if (supplierId) {
            this.popCartService.setSupplier(Number(supplierId));
        }
    }

    onLocationChange(locationId: any) {
        if (locationId) {
            this.popCartService.setLocation(Number(locationId));
        }
    }

}
