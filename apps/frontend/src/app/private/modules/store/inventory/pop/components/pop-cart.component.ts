import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  Output,
  EventEmitter,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  PopCartService,
  PopCartState,
  PopCartItem,
  PopCartSummary,
} from '../services/pop-cart.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { FormsModule } from '@angular/forms';

import { InputComponent } from '../../../../../../shared/components/input/input.component';

@Component({
  selector: 'app-pop-cart',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent, InputComponent, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="h-full flex flex-col bg-surface rounded-md shadow-card border border-border overflow-hidden"
    >
      <!-- Cart Header & Summary Section (Fixed at top) -->
      <div class="flex-none bg-surface border-b border-border shadow-sm">
        <!-- Header Row -->
        <div class="px-5 py-3 border-b border-border/50">
          <div class="flex justify-between items-center gap-4">
            <h2 class="text-base font-bold text-text-primary flex items-center gap-2">
              <app-icon name="shopping-cart" [size]="18" class="text-primary"></app-icon>
              Orden de Compra ({{ (cartState$ | async)?.items?.length || 0 }})
            </h2>
            <app-button
              *ngIf="((cartState$ | async)?.items?.length ?? 0) > 0"
              variant="outline"
              size="sm"
              (clicked)="clearCart()"
              [loading]="(loading$ | async) ?? false"
              class="text-destructive hover:text-destructive hover:bg-destructive/10 !px-2 !h-8"
            >
              <app-icon name="trash-2" [size]="14" slot="icon"></app-icon>
              Vaciar
            </app-button>
          </div>
        </div>

        <!-- Totals Row (High Contrast) -->
        <div class="px-5 py-4 bg-muted/20">
          <div class="space-y-1.5 mb-4">
            <div class="flex justify-between text-xs text-text-secondary">
              <span>Subtotal</span>
              <span class="font-medium">{{ formatCurrency((summary$ | async)?.subtotal || 0) }}</span>
            </div>
            <div class="flex justify-between text-xs text-text-secondary">
              <span>Impuestos</span>
              <span class="font-medium">{{ formatCurrency((summary$ | async)?.tax_amount || 0) }}</span>
            </div>
            <div class="pt-2 border-t border-border/50 flex justify-between items-center">
              <span class="font-bold text-text-primary text-base">Total Estimado</span>
              <span class="font-extrabold text-2xl text-primary tracking-tight">
                {{ formatCurrency((summary$ | async)?.total || 0) }}
              </span>
            </div>
          </div>

          <!-- Checkout Actions -->
          <!-- Checkout Actions -->
          <!-- Checkout Actions -->
          <div class="flex items-center gap-2 mt-4">
            <!-- Draft (Text) -->
            <app-button
              variant="outline"
              size="md"
              (clicked)="onSaveDraft()"
              [disabled]="((loading$ | async) ?? false) || ((isEmpty$ | async) ?? false)"
              class="!h-10 text-sm font-medium px-3 shrink-0"
              title="Guardar como borrador"
            >
              <app-icon name="save" [size]="16" slot="icon"></app-icon>
              Borrador
            </app-button>

            <!-- Create Order -->
            <app-button
              variant="primary"
              size="md"
              (clicked)="onSubmitOrder()"
              [disabled]="((loading$ | async) ?? false) || ((isEmpty$ | async) ?? false)"
              class="!h-10 text-sm font-bold flex-1 !px-2"
            >
              <app-icon name="file-text" [size]="18" slot="icon"></app-icon>
              Crear
            </app-button>

            <!-- Create & Receive -->
            <app-button
               variant="success"
               size="md"
               (clicked)="onCreateAndReceive()"
               [disabled]="((loading$ | async) ?? false) || ((isEmpty$ | async) ?? false)"
               class="!h-10 text-sm font-bold flex-1 !px-2 whitespace-nowrap"
               title="Crear y recibir inventario automáticamente"
            >
               <app-icon name="check-circle" [size]="18" slot="icon"></app-icon>
               Crear y Recibir
            </app-button>
          </div>
        </div>

        <!-- Supplier Information (Compact) -->
        <div
          *ngIf="(cartState$ | async)?.supplierId"
          class="px-5 py-2.5 bg-primary/5 border-t border-primary/10 flex items-center gap-3"
        >
          <div class="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            <app-icon name="truck" [size]="14"></app-icon>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-[11px] text-text-secondary font-medium leading-none mb-0.5">Proveedor Seleccionado</p>
            <p class="text-xs font-bold text-text-primary truncate">
              ID: {{ (cartState$ | async)?.supplierId }}
            </p>
          </div>
        </div>
      </div>

      <!-- Cart Content (Scrollable Items) -->
      <div class="flex-1 overflow-y-auto p-4 bg-bg/30">
        <!-- Empty State -->
        <div
          *ngIf="isEmpty$ | async"
          class="flex flex-col items-center justify-center h-full min-h-[200px] text-center opacity-60"
        >
          <div class="w-12 h-12 bg-muted/20 rounded-full flex items-center justify-center mb-3">
            <app-icon name="shopping-cart" [size]="24" class="text-muted"></app-icon>
          </div>
          <h3 class="text-sm font-semibold text-text-primary mb-1">
            Orden vacía
          </h3>
          <p class="text-[11px] text-text-secondary">
            Selecciona productos en el panel izquierdo
          </p>
        </div>

        <!-- Cart Items List -->
        <div *ngIf="!(isEmpty$ | async)" class="space-y-2">
          <div
            *ngFor="
              let item of (cartState$ | async)?.items;
              trackBy: trackByItemId
            "
            class="group flex flex-col gap-2 p-2.5 rounded-md border border-border bg-surface hover:bg-muted/30 hover:border-primary/30 transition-all duration-200"
          >
            <!-- Top Row: Info and Remove Button -->
            <div class="flex items-start gap-3">
              <!-- Item Info -->
              <div class="flex-1 min-w-0">
                <div class="flex justify-between items-start gap-2">
                  <h4
                    class="text-sm font-semibold text-text-primary truncate leading-tight mb-0.5"
                    [title]="item.product.name"
                  >
                    {{ item.product.name }}
                  </h4>
                  <button
                    (click)="removeFromCart(item.id)"
                    class="p-1 rounded-sm text-text-secondary hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Eliminar"
                  >
                    <app-icon name="trash-2" [size]="14"></app-icon>
                  </button>
                </div>
                <!-- SKU -->
                <div class="text-[10px] text-text-secondary mb-2">SKU: {{ item.product.code }}</div>

                <div class="flex justify-between items-end">
                   <!-- Unit Cost Input (Editable for POP) -->
                  <div class="flex flex-col">
                    <span class="text-[10px] text-text-secondary uppercase mb-1">Costo Unit.</span>
                     <app-input
                        type="number"
                        size="sm"
                        [ngModel]="item.unit_cost"
                        (ngModelChange)="updateCost(item.id, $event)"
                        customInputClass="text-right !h-7 !py-0"
                        customWrapperClass="!mt-0"
                        min="0"
                     ></app-input>
                  </div>
                  
                  <div class="flex flex-col items-end">
                     <span class="text-[10px] text-text-secondary uppercase mb-1">Total</span>
                     <span class="text-sm font-bold text-primary">
                        {{ formatCurrency(item.total) }}
                     </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Bottom Row: Quantity Controls -->
            <div
              class="flex items-center justify-between pt-2 border-t border-border/50"
            >
              <span class="text-[10px] uppercase tracking-wider font-bold text-text-secondary/60">
                Cantidad
              </span>
              <div
                class="flex items-center bg-muted/50 border border-border/50 rounded-md h-7 overflow-hidden"
              >
                <button
                  class="px-2.5 hover:bg-muted h-full flex items-center text-text-secondary transition-colors"
                  (click)="updateQuantity(item.id, item.quantity - 1)"
                  [disabled]="(loading$ | async) ?? false"
                >
                  <app-icon name="minus" [size]="12"></app-icon>
                </button>
                <input
                  class="w-12 text-center text-xs font-bold text-text-primary bg-transparent border-0 outline-none p-0 h-full focus:ring-0"
                  type="number"
                  min="1"
                  [ngModel]="item.quantity"
                  (ngModelChange)="updateQuantity(item.id, $event)"
                  [disabled]="(loading$ | async) ?? false"
                />
                <button
                  class="px-2.5 hover:bg-muted h-full flex items-center text-text-secondary transition-colors"
                  (click)="updateQuantity(item.id, item.quantity + 1)"
                  [disabled]="(loading$ | async) ?? false"
                >
                  <app-icon name="plus" [size]="12"></app-icon>
                </button>
              </div>
            </div>
            
            <!-- Lot Info Trigger -->
             <div 
                class="flex items-center gap-1 text-[10px] text-text-secondary hover:text-primary cursor-pointer mt-1"
                (click)="openLotModal(item)"
             >
                 <app-icon name="package" [size]="10"></app-icon>
                 <span>{{ item.lot_info ? 'Lote Configurado' : 'Configurar Lote / Vencimiento' }}</span>
             </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
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
    `,
  ],
})
export class PopCartComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  cartState$: Observable<PopCartState>;
  isEmpty$: Observable<boolean>;
  summary$: Observable<PopCartSummary>;
  loading$: Observable<boolean>;

  @Output() saveDraft = new EventEmitter<void>();
  @Output() submitOrder = new EventEmitter<void>();
  @Output() requestLotConfig = new EventEmitter<any>();

  constructor(
    private cartService: PopCartService,
    private toastService: ToastService,
    private dialogService: DialogService,
  ) {
    this.cartState$ = this.cartService.cartState$;
    this.isEmpty$ = this.cartService.isEmpty$;
    this.summary$ = this.cartService.summary$;
    this.loading$ = this.cartService.loading$;
  }

  ngOnInit(): void {
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  trackByItemId(_index: number, item: PopCartItem): string {
    return item.id;
  }

  updateQuantity(itemId: string, quantity: number): void {
    if (quantity <= 0) {
      this.removeFromCart(itemId);
      return;
    }

    this.cartService
      .updateCartItem({ itemId, quantity })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => { },
        error: (error) => {
          this.toastService.error(
            error.message || 'Error al actualizar cantidad',
          );
        },
      });
  }

  updateCost(itemId: string, cost: number): void {
    if (cost < 0) return;

    this.cartService.updateCartItem({ itemId, unit_cost: Number(cost) })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => { },
        error: (error) => {
          this.toastService.error('Error al actualizar costo');
        }
      });
  }

  removeFromCart(itemId: string): void {
    this.cartService
      .removeFromCart(itemId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Producto eliminado de la orden');
        },
        error: (error) => {
          this.toastService.error(
            error.message || 'Error al eliminar producto',
          );
        },
      });
  }

  async clearCart(): Promise<void> {
    const confirm = await this.dialogService.confirm({
      title: 'Vaciar Orden',
      message: '¿Estás seguro de que quieres eliminar todos los productos?',
      confirmText: 'Vaciar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });

    if (confirm) {
      this.cartService
        .clearCart()
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toastService.info('Orden vaciada');
          },
          error: (error) => {
            this.toastService.error(error.message || 'Error al vaciar orden');
          },
        });
    }
  }

  onSaveDraft(): void {
    this.saveDraft.emit();
  }

  @Output() createAndReceive = new EventEmitter<void>();

  onSubmitOrder(): void {
    this.submitOrder.emit();
  }

  onCreateAndReceive(): void {
    this.createAndReceive.emit();
  }

  openLotModal(item: PopCartItem): void {
    this.requestLotConfig.emit(item);
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0
    }).format(amount);
  }
}
