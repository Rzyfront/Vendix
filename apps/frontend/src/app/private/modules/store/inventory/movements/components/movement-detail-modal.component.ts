import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

// Shared Components
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
} from '../../../../../../shared/components/index';

// Interfaces
import {
  InventoryMovement,
  MovementType,
  SourceOrderType,
} from '../../interfaces';

@Component({
  selector: 'app-movement-detail-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="isOpen"
      title="Detalle del Movimiento"
      size="md"
      (closed)="onClose()"
      (isOpenChange)="isOpenChange.emit($event)"
    >
      @if (movement) {
        <div class="space-y-6">
          <!-- Header with Type Badge -->
          <div
            class="flex items-center justify-between p-4 bg-surface-secondary rounded-xl border border-border"
          >
            <div class="flex items-center gap-3">
              <div
                class="w-12 h-12 rounded-xl flex items-center justify-center"
                [class]="getTypeColorClasses()"
              >
                <app-icon [name]="getTypeIcon()" [size]="24"></app-icon>
              </div>
              <div>
                <p class="text-sm text-text-secondary">Tipo de Movimiento</p>
                <p class="font-bold text-lg">{{ getTypeLabel() }}</p>
              </div>
            </div>
          </div>

          <!-- Product Section -->
          <div class="space-y-3">
            <h3
              class="text-sm font-semibold text-text-secondary uppercase tracking-wide flex items-center gap-2"
            >
              <app-icon name="package" [size]="16"></app-icon>
              Producto
            </h3>
            <div class="p-4 bg-surface rounded-xl border border-border">
              <p class="font-semibold text-text-primary">
                {{ movement.products?.name || 'Producto desconocido' }}
              </p>
              <p class="text-sm text-text-secondary mt-1">
                SKU: {{ movement.products?.sku || 'N/A' }}
              </p>
              @if (movement.product_variants) {
                <p class="text-sm text-primary mt-1">
                  <app-icon
                    name="git-branch"
                    [size]="14"
                    class="inline mr-1"
                  ></app-icon>
                  Variante: {{ movement.product_variants.sku }}
                  @if (movement.product_variants.name) {
                    ({{ movement.product_variants.name }})
                  }
                </p>
              }
            </div>
          </div>

          <!-- Locations Section -->
          @if (movement.from_location || movement.to_location) {
            <div class="space-y-3">
              <h3
                class="text-sm font-semibold text-text-secondary uppercase tracking-wide flex items-center gap-2"
              >
                <app-icon name="map-pin" [size]="16"></app-icon>
                Ubicaciones
              </h3>
              <div class="p-4 bg-surface rounded-xl border border-border">
                <div class="flex items-center gap-3">
                  @if (movement.from_location) {
                    <div class="flex-1">
                      <p class="text-xs text-text-muted uppercase">Origen</p>
                      <p class="font-medium text-text-primary">
                        {{ movement.from_location.name }}
                      </p>
                      <p class="text-xs text-text-secondary">
                        {{ movement.from_location.code }}
                      </p>
                    </div>
                  }
                  @if (movement.from_location && movement.to_location) {
                    <app-icon
                      name="arrow-right"
                      [size]="20"
                      class="text-text-muted flex-shrink-0"
                    ></app-icon>
                  }
                  @if (movement.to_location) {
                    <div class="flex-1">
                      <p class="text-xs text-text-muted uppercase">Destino</p>
                      <p class="font-medium text-text-primary">
                        {{ movement.to_location.name }}
                      </p>
                      <p class="text-xs text-text-secondary">
                        {{ movement.to_location.code }}
                      </p>
                    </div>
                  }
                </div>
              </div>
            </div>
          }

          <!-- Quantity Section -->
          <div class="space-y-3">
            <h3
              class="text-sm font-semibold text-text-secondary uppercase tracking-wide flex items-center gap-2"
            >
              <app-icon name="hash" [size]="16"></app-icon>
              Cantidad
            </h3>
            <div
              class="p-6 rounded-xl text-center"
              [class]="
                isInbound()
                  ? 'bg-success/10 border border-success/30'
                  : 'bg-error/10 border border-error/30'
              "
            >
              <p
                class="text-3xl font-bold"
                [class]="isInbound() ? 'text-success' : 'text-error'"
              >
                {{ isInbound() ? '+' : '-' }}{{ movement.quantity }}
              </p>
              <p class="text-sm text-text-secondary mt-1">unidades</p>
            </div>
          </div>

          <!-- Source Order Section -->
          @if (movement.source_order_type) {
            <div class="space-y-3">
              <h3
                class="text-sm font-semibold text-text-secondary uppercase tracking-wide flex items-center gap-2"
              >
                <app-icon name="link" [size]="16"></app-icon>
                Orden de Origen
              </h3>
              <div class="p-4 bg-surface rounded-xl border border-border">
                <div class="flex items-center gap-2">
                  <span
                    class="px-2 py-1 bg-muted/20 rounded-lg text-sm font-medium text-text-secondary"
                  >
                    {{ getSourceOrderLabel(movement.source_order_type) }}
                  </span>
                  @if (movement.source_order_id) {
                    <span class="text-sm text-text-primary font-medium">
                      #{{ movement.source_order_id }}
                    </span>
                  }
                </div>
              </div>
            </div>
          }

          <!-- Reason & Notes Section -->
          @if (movement.reason || movement.notes) {
            <div class="space-y-3">
              <h3
                class="text-sm font-semibold text-text-secondary uppercase tracking-wide flex items-center gap-2"
              >
                <app-icon name="file-text" [size]="16"></app-icon>
                Motivo
              </h3>
              <div class="p-4 bg-surface rounded-xl border border-border">
                @if (movement.reason) {
                  <p class="font-medium text-text-primary">
                    {{ movement.reason }}
                  </p>
                }
                @if (movement.notes) {
                  <p
                    class="text-sm text-text-secondary"
                    [class.mt-2]="movement.reason"
                  >
                    {{ movement.notes }}
                  </p>
                }
              </div>
            </div>
          }

          <!-- Audit Section -->
          <div class="space-y-3">
            <h3
              class="text-sm font-semibold text-text-secondary uppercase tracking-wide flex items-center gap-2"
            >
              <app-icon name="users" [size]="16"></app-icon>
              Auditoría
            </h3>
            <div
              class="p-4 bg-surface rounded-xl border border-border space-y-4"
            >
              <div class="flex items-start gap-3">
                <div
                  class="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0"
                >
                  <app-icon
                    name="user"
                    [size]="16"
                    class="text-primary"
                  ></app-icon>
                </div>
                <div class="flex-1">
                  <p class="text-sm text-text-secondary">Registrado por</p>
                  <p class="font-medium text-text-primary">
                    {{
                      movement.users?.user_name || 'Sistema'
                    }}
                  </p>
                  @if (movement.users?.email) {
                    <p class="text-xs text-text-muted">
                      {{ movement.users?.email }}
                    </p>
                  }
                  <p class="text-xs text-text-muted mt-1">
                    {{ movement.created_at | date: 'dd/MM/yyyy HH:mm' }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      } @else {
        <div class="flex items-center justify-center py-12">
          <div
            class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
          ></div>
        </div>
      }

      <!-- Footer -->
      <div
        slot="footer"
        class="flex justify-end px-6 py-4 bg-gray-50 rounded-b-xl"
      >
        <app-button
          variant="outline"
          type="button"
          (clicked)="onClose()"
          customClasses="!rounded-xl font-bold"
        >
          Cerrar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class MovementDetailModalComponent {
  @Input() isOpen = false;
  @Input() movement: InventoryMovement | null = null;

  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() close = new EventEmitter<void>();

  private typeConfig: Record<
    MovementType,
    { label: string; icon: string; colorClass: string }
  > = {
    stock_in: {
      label: 'Entrada',
      icon: 'arrow-down-circle',
      colorClass: 'bg-green-100 text-green-700 border border-green-200',
    },
    stock_out: {
      label: 'Salida',
      icon: 'arrow-up-circle',
      colorClass: 'bg-red-100 text-red-700 border border-red-200',
    },
    transfer: {
      label: 'Transferencia',
      icon: 'repeat',
      colorClass: 'bg-purple-100 text-purple-700 border border-purple-200',
    },
    adjustment: {
      label: 'Ajuste',
      icon: 'sliders',
      colorClass: 'bg-blue-100 text-blue-700 border border-blue-200',
    },
    sale: {
      label: 'Venta',
      icon: 'shopping-cart',
      colorClass: 'bg-amber-100 text-amber-700 border border-amber-200',
    },
    return: {
      label: 'Devolución',
      icon: 'corner-down-left',
      colorClass: 'bg-cyan-100 text-cyan-700 border border-cyan-200',
    },
    damage: {
      label: 'Daño',
      icon: 'alert-triangle',
      colorClass: 'bg-error/15 text-error-700 border border-error/30',
    },
    expiration: {
      label: 'Vencimiento',
      icon: 'clock',
      colorClass: 'bg-gray-100 text-gray-700 border border-gray-200',
    },
  };

  private sourceOrderLabels: Record<SourceOrderType, string> = {
    purchase: 'Orden de Compra',
    sale: 'Orden de Venta',
    transfer: 'Transferencia',
    return: 'Devolución',
  };

  isInbound(): boolean {
    if (!this.movement) return false;
    return (
      this.movement.movement_type === 'stock_in' ||
      this.movement.movement_type === 'return'
    );
  }

  getTypeLabel(): string {
    if (!this.movement) return '';
    return (
      this.typeConfig[this.movement.movement_type]?.label ||
      this.movement.movement_type
    );
  }

  getTypeIcon(): string {
    if (!this.movement) return 'help-circle';
    return (
      this.typeConfig[this.movement.movement_type]?.icon || 'help-circle'
    );
  }

  getTypeColorClasses(): string {
    if (!this.movement) return 'bg-muted/10 text-muted';
    return (
      this.typeConfig[this.movement.movement_type]?.colorClass ||
      'bg-muted/10 text-muted'
    );
  }

  getSourceOrderLabel(type: SourceOrderType): string {
    return this.sourceOrderLabels[type] || type;
  }

  onClose(): void {
    this.close.emit();
  }
}
