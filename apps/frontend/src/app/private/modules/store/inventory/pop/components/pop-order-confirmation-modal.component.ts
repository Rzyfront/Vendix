import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { PopCartState } from '../interfaces/pop-cart.interface';
import { CostPreviewResponse } from '../../interfaces';

@Component({
  selector: 'app-pop-order-confirmation-modal',
  standalone: true,
  imports: [CommonModule, DatePipe, ModalComponent, ButtonComponent, IconComponent, CurrencyPipe],
  template: `
    <app-modal
      [isOpen]="isOpen"
      [title]="modalTitle"
      size="lg"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
    >
      <div class="space-y-3 p-4">

        <!-- Proveedor + Bodega -->
        <div class="grid grid-cols-2 gap-3">
          <div class="border-l-2 border-[var(--color-primary)] rounded-r-lg bg-[var(--color-surface)] p-3">
            <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">Proveedor</p>
            <div class="flex items-center gap-2">
              <app-icon name="truck" [size]="16" color="var(--color-primary)"></app-icon>
              <span class="text-sm font-medium text-[var(--color-text-primary)]">{{ supplierName || '—' }}</span>
            </div>
          </div>
          <div class="border-l-2 border-[var(--color-primary)] rounded-r-lg bg-[var(--color-surface)] p-3">
            <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">Bodega</p>
            <div class="flex items-center gap-2">
              <app-icon name="warehouse" [size]="16" color="var(--color-primary)"></app-icon>
              <span class="text-sm font-medium text-[var(--color-text-primary)]">{{ locationName || '—' }}</span>
            </div>
          </div>
        </div>

        <!-- Productos -->
        <section class="border-l-2 border-[var(--color-primary)] rounded-r-lg bg-[var(--color-surface)] p-3">
          <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
            Productos ({{ cartState?.items?.length || 0 }})
          </p>
          <div class="rounded-md overflow-hidden border border-[var(--color-border)] max-h-52 overflow-y-auto">
            @for (item of cartState?.items; track item.id; let idx = $index) {
              <div class="flex items-center gap-2 px-2.5 py-1.5 text-sm"
                   [class]="idx % 2 === 0 ? 'bg-[var(--color-surface)]' : 'bg-[var(--color-surface-elevated)]'">
                <div class="flex-1 min-w-0 truncate">
                  <span class="font-medium text-[var(--color-text-primary)]">
                    {{ item.is_prebulk ? item.prebulk_data?.name : item.product.name }}
                  </span>
                  @if (item.variant?.name) {
                    <span class="text-xs text-[var(--color-text-muted)]"> · {{ item.variant!.name }}</span>
                  }
                </div>
                <span class="text-xs text-[var(--color-text-secondary)] whitespace-nowrap shrink-0">
                  {{ item.quantity }} × {{ item.unit_cost | currency }}
                </span>
                <span class="font-medium text-[var(--color-text-primary)] whitespace-nowrap shrink-0 min-w-[4.5rem] text-right">
                  {{ item.total | currency }}
                </span>
              </div>
            }
          </div>
        </section>

        @if (actionType === 'create-receive' && (loadingPreview || (costPreview?.items?.length ?? 0) > 0)) {
          <section class="border-l-2 border-amber-400 rounded-r-lg bg-[var(--color-surface)] p-3">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  Valoración de Inventario
                </p>
                @if (costPreview?.costing_method) {
                  <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        [class]="costPreview!.costing_method === 'cpp'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-purple-100 text-purple-700'">
                    {{ costPreview!.costing_method === 'cpp' ? 'CPP' : 'FIFO' }}
                  </span>
                }
              </div>
              <button type="button"
                      class="text-[10px] text-[var(--color-primary)] hover:underline font-medium"
                      (click)="navigateToSettings.emit()">
                Cambiar estrategia →
              </button>
            </div>
            @if (loadingPreview) {
              <div class="space-y-2">
                <div class="h-8 bg-gray-100 rounded animate-pulse"></div>
                <div class="h-8 bg-gray-100 rounded animate-pulse w-3/4"></div>
              </div>
            } @else {
              <div class="rounded-md overflow-hidden border border-[var(--color-border)]">
                @for (item of costPreview?.items; track item.product_id + '-' + (item.product_variant_id || 0); let idx = $index) {
                  <div class="px-2.5 py-2 text-xs"
                       [class]="idx % 2 === 0 ? 'bg-[var(--color-surface)]' : 'bg-[var(--color-surface-elevated)]'">
                    <div class="font-medium text-[var(--color-text-primary)] mb-0.5">
                      {{ item.product_name }}
                      @if (item.variant_name) {
                        <span class="text-[var(--color-text-muted)]"> · {{ item.variant_name }}</span>
                      }
                    </div>
                    @if (item.is_reactivation) {
                      <div class="text-[var(--color-text-secondary)]">
                        <span class="inline-flex items-center gap-1 text-amber-600 font-medium">
                          <app-icon name="rotate-ccw" [size]="11"></app-icon>
                          Reactivación
                        </span>
                        — {{ item.incoming_quantity }} uds @ {{ item.incoming_cost | currency }}
                      </div>
                    } @else if (costPreview?.costing_method === 'cpp') {
                      <div class="flex items-center gap-3 text-[var(--color-text-secondary)]">
                        <span>Stock: {{ item.global_stock }} → <span class="font-medium text-[var(--color-text-primary)]">{{ item.new_stock }}</span></span>
                        <span class="text-[var(--color-border)]">|</span>
                        <span>Costo: {{ item.global_cost_per_unit | currency }} → <span class="font-medium text-[var(--color-text-primary)]">{{ item.new_cost_per_unit | currency }}</span></span>
                      </div>
                    } @else {
                      <div class="text-[var(--color-text-secondary)]">
                        Nueva capa: {{ item.incoming_quantity }} uds @ {{ item.incoming_cost | currency }}
                      </div>
                    }
                  </div>
                }
              </div>
            }
          </section>
        }

        <!-- Detalles -->
        <section class="border-l-2 border-[var(--color-primary)] rounded-r-lg bg-[var(--color-surface)] p-3">
          <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Detalles</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <!-- Fecha Orden -->
            <div class="flex items-center gap-1.5">
              <app-icon name="calendar" [size]="13" color="var(--color-text-muted)"></app-icon>
              <span class="text-[var(--color-text-muted)]">Orden:</span>
              <span class="font-medium text-[var(--color-text-primary)]">{{ cartState?.orderDate | date:'dd/MM/yyyy' }}</span>
            </div>
            <!-- Fecha Entrega -->
            @if (cartState?.expectedDate) {
              <div class="flex items-center gap-1.5">
                <app-icon name="calendar-check" [size]="13" color="var(--color-text-muted)"></app-icon>
                <span class="text-[var(--color-text-muted)]">Entrega:</span>
                <span class="font-medium text-[var(--color-text-primary)]">{{ cartState!.expectedDate | date:'dd/MM/yyyy' }}</span>
              </div>
            }
            <!-- Método Envío -->
            @if (cartState?.shippingMethod) {
              <div class="flex items-center gap-1.5">
                <app-icon name="truck" [size]="13" color="var(--color-text-muted)"></app-icon>
                <span class="text-[var(--color-text-muted)]">Envío:</span>
                <span class="font-medium text-[var(--color-text-primary)]">{{ shippingMethodLabel }}</span>
              </div>
            }
            <!-- Términos de pago -->
            @if (cartState?.paymentTerms) {
              <div class="flex items-center gap-1.5">
                <app-icon name="credit-card" [size]="13" color="var(--color-text-muted)"></app-icon>
                <span class="text-[var(--color-text-muted)]">Pago:</span>
                <span class="font-medium text-[var(--color-text-primary)]">{{ cartState!.paymentTerms }}</span>
              </div>
            }
          </div>
          <!-- Notas -->
          @if (cartState?.notes) {
            <div class="mt-2 pt-2 border-t border-[var(--color-border)]">
              <p class="text-xs text-[var(--color-text-muted)] font-medium mb-0.5">Notas</p>
              <p class="text-sm text-[var(--color-text-secondary)] whitespace-pre-line line-clamp-3">{{ cartState!.notes }}</p>
            </div>
          }
        </section>

        <!-- Totales -->
        <section class="rounded-lg overflow-hidden border border-[var(--color-primary)] bg-[var(--color-primary-light)]">
          <div class="px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
            <span>Subtotal: <span class="font-medium text-[var(--color-text-primary)]">{{ cartState?.summary?.subtotal | currency }}</span></span>
            @if ((cartState?.summary?.tax_amount || 0) > 0) {
              <span>Impuestos: <span class="font-medium text-[var(--color-text-primary)]">{{ cartState!.summary.tax_amount | currency }}</span></span>
            }
            @if ((cartState?.shippingCost || 0) > 0) {
              <span>Envío: <span class="font-medium text-[var(--color-text-primary)]">{{ cartState!.shippingCost | currency }}</span></span>
            }
          </div>
          <div class="px-3 py-2.5 flex items-center justify-between">
            <span class="text-sm font-semibold text-[var(--color-text-primary)]">Total</span>
            <span class="text-xl font-bold text-[var(--color-primary)]">{{ cartState?.summary?.total | currency }}</span>
          </div>
        </section>

      </div>

      <div slot="footer">
        <div class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <app-button variant="outline" (clicked)="onCancel()">Cancelar</app-button>
          <app-button variant="primary" (clicked)="onConfirm()">
            <app-icon [name]="actionType === 'create-receive' ? 'package-check' : 'check'" [size]="16" slot="icon"></app-icon>
            {{ actionType === 'create-receive' ? 'Crear y Recibir' : 'Crear Orden' }}
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class PopOrderConfirmationModalComponent {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Input() cartState: PopCartState | null = null;
  @Input() supplierName = '';
  @Input() locationName = '';
  @Input() actionType: 'create' | 'create-receive' = 'create';
  @Input() costPreview: CostPreviewResponse | null = null;
  @Input() loadingPreview = false;
  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();
  @Output() navigateToSettings = new EventEmitter<void>();

  get modalTitle(): string {
    return this.actionType === 'create-receive'
      ? 'Crear y Recibir Inventario'
      : 'Confirmar Orden de Compra';
  }

  get shippingMethodLabel(): string {
    const labels: Record<string, string> = {
      supplier_transport: 'Transporte Proveedor',
      freight: 'Flete',
      pickup: 'Recolección',
      other: 'Otro',
    };
    return labels[this.cartState?.shippingMethod || ''] || this.cartState?.shippingMethod || '';
  }

  onConfirm(): void {
    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    this.confirmed.emit();
  }

  onCancel(): void {
    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    this.cancelled.emit();
    this.isOpenChange.emit(false);
  }
}
