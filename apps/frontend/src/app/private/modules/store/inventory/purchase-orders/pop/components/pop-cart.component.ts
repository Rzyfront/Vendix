import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PopCartService, PopCartItem, PopCartState } from '../services/pop-cart.service';
import { IconComponent, ButtonComponent } from '../../../../../../../shared/components';
import { Subject, takeUntil } from 'rxjs';

@Component({
    selector: 'app-pop-cart',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        IconComponent
    ],
    template: `
    <div class="h-full flex flex-col">
       
        <!-- Empty State -->
        <div *ngIf="cartState?.items?.length === 0" class="flex-1 flex flex-col items-center justify-center text-text-secondary p-8 select-none">
            <app-icon name="shopping-cart" [size]="48" class="mb-4 text-border"></app-icon>
            <p>El carrito está vacío</p>
            <p class="text-xs">Selecciona productos del catálogo</p>
        </div>

        <!-- Items List -->
        <div *ngIf="cartState?.items && cartState!.items.length > 0" class="flex-1 overflow-y-auto">
            <div *ngFor="let item of cartState!.items; let i = index" class="p-4 border-b border-border bg-white hover:bg-surface-50 transition-colors">
                
                <!-- Item Header (Name & Remove) -->
                <div class="flex justify-between items-start mb-2">
                    <span class="font-medium text-text-primary text-sm line-clamp-1" [title]="item.product.name">
                        {{ item.product.name }}
                    </span>
                    <button 
                        class="text-text-secondary hover:text-red-500 transition-colors"
                        (click)="removeItem(i)"
                    >
                        <app-icon name="trash-2" [size]="16"></app-icon>
                    </button>
                </div>

                <!-- Item Controls (Qty & Cost) -->
                <div class="grid grid-cols-12 gap-3 items-center">
                    
                    <!-- Quantity Control -->
                    <div class="col-span-4 flex items-center bg-background border border-border rounded-md h-8">
                        <button 
                            class="w-8 h-full flex items-center justify-center hover:bg-surface-100 border-r border-border text-text-secondary disabled:opacity-50"
                            (click)="updateQty(i, item.quantity - 1)"
                            [disabled]="item.quantity <= 1"
                        >
                            <app-icon name="minus" [size]="12"></app-icon>
                        </button>
                        <input 
                            type="number" 
                            class="flex-1 w-full h-full text-center text-sm bg-transparent outline-none appearance-none"
                            [ngModel]="item.quantity"
                            (ngModelChange)="updateQty(i, $event)"
                            min="1"
                        >
                        <button 
                            class="w-8 h-full flex items-center justify-center hover:bg-surface-100 border-l border-border text-text-secondary"
                            (click)="updateQty(i, item.quantity + 1)"
                        >
                            <app-icon name="plus" [size]="12"></app-icon>
                        </button>
                    </div>

                    <!-- Unit Cost Input -->
                     <div class="col-span-4">
                        <div class="relative">
                            <span class="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-text-secondary">$</span>
                             <input 
                                type="number" 
                                class="w-full h-8 pl-5 pr-2 text-sm text-right bg-background border border-border rounded-md outline-none focus:border-primary transition-colors"
                                [ngModel]="item.unit_cost"
                                (ngModelChange)="updateCost(i, $event)"
                                placeholder="Costo"
                            >
                        </div>
                     </div>

                    <!-- Subtotal Display -->
                    <div class="col-span-4 text-right">
                        <div class="text-sm font-semibold text-text-primary">
                            {{ item.total | currency:'COP':'symbol-narrow':'1.0-0' }}
                        </div>
                         <div class="text-[10px] text-text-secondary flex justify-end gap-1 items-center cursor-pointer hover:text-primary">
                             <span>Lote / Venc.</span>
                             <app-icon name="edit-2" [size]="10"></app-icon>
                         </div>
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
    
    /* Chrome, Safari, Edge, Opera */
    input::-webkit-outer-spin-button,
    input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }

    /* Firefox */
    input[type=number] {
      -moz-appearance: textfield;
    }
  `]
})
export class PopCartComponent implements OnInit, OnDestroy {
    cartState: PopCartState | null = null;
    private destroy$ = new Subject<void>();

    constructor(private popCartService: PopCartService) { }

    ngOnInit(): void {
        this.popCartService.cartState$
            .pipe(takeUntil(this.destroy$))
            .subscribe((state: PopCartState) => {
                this.cartState = state;
            });
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    updateQty(index: number, newQty: any) {
        if (newQty < 1) return;
        this.popCartService.updateItemQuantity(index, Number(newQty));
    }

    updateCost(index: number, newCost: any) {
        this.popCartService.updateItemCost(index, Number(newCost));
    }

    removeItem(index: number) {
        this.popCartService.removeItem(index);
    }
}
