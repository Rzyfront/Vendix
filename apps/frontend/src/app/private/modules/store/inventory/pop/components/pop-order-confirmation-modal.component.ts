import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { PopCartState } from '../interfaces/pop-cart.interface';

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
  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

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
    this.confirmed.emit();
  }

  onCancel(): void {
    this.cancelled.emit();
    this.isOpenChange.emit(false);
  }
}
