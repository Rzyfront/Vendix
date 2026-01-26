import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

// Shared Components
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
} from '../../../../../../shared/components/index';

// Interfaces
import { InventoryAdjustment, AdjustmentType } from '../../interfaces';

@Component({
  selector: 'app-adjustment-detail-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="isOpen"
      title="Detalle del Ajuste"
      size="md"
      (closed)="onClose()"
      (isOpenChange)="isOpenChange.emit($event)"
    >
      @if (adjustment) {
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
                <p class="text-sm text-text-secondary">Tipo de Ajuste</p>
                <p class="font-bold text-lg">{{ getTypeLabel() }}</p>
              </div>
            </div>
            <div
              class="px-3 py-1.5 rounded-full text-sm font-medium"
              [class]="
                adjustment.approved_at
                  ? 'bg-success/10 text-success'
                  : 'bg-warning/10 text-warning'
              "
            >
              {{ adjustment.approved_at ? 'Aprobado' : 'Pendiente' }}
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
                {{
                  adjustment.products?.name ||
                    adjustment.product?.name ||
                    'Producto desconocido'
                }}
              </p>
              <p class="text-sm text-text-secondary mt-1">
                SKU:
                {{
                  adjustment.products?.sku || adjustment.product?.sku || 'N/A'
                }}
              </p>
              @if (adjustment.product_variants) {
                <p class="text-sm text-primary mt-1">
                  <app-icon
                    name="git-branch"
                    [size]="14"
                    class="inline mr-1"
                  ></app-icon>
                  Variante: {{ adjustment.product_variants.sku }}
                </p>
              }
            </div>
          </div>

          <!-- Location & Batch Section -->
          <div class="space-y-3">
            <h3
              class="text-sm font-semibold text-text-secondary uppercase tracking-wide flex items-center gap-2"
            >
              <app-icon name="map-pin" [size]="16"></app-icon>
              Ubicacion
            </h3>
            <div class="p-4 bg-surface rounded-xl border border-border">
              <p class="font-semibold text-text-primary">
                {{
                  adjustment.inventory_locations?.name ||
                    adjustment.location?.name ||
                    'Ubicacion desconocida'
                }}
              </p>
              <p class="text-sm text-text-secondary">
                Codigo:
                {{
                  adjustment.inventory_locations?.code ||
                    adjustment.location?.code ||
                    'N/A'
                }}
              </p>
              @if (adjustment.inventory_batches) {
                <div class="mt-3 pt-3 border-t border-border">
                  <p class="text-sm text-text-secondary">Lote</p>
                  <p class="font-medium text-text-primary">
                    {{ adjustment.inventory_batches.batch_number }}
                  </p>
                  @if (adjustment.inventory_batches.expiration_date) {
                    <p class="text-xs text-text-muted mt-1">
                      Vence:
                      {{
                        adjustment.inventory_batches.expiration_date
                          | date: 'dd/MM/yyyy'
                      }}
                    </p>
                  }
                </div>
              }
            </div>
          </div>

          <!-- Quantity Changes Section -->
          <div class="space-y-3">
            <h3
              class="text-sm font-semibold text-text-secondary uppercase tracking-wide flex items-center gap-2"
            >
              <app-icon name="hash" [size]="16"></app-icon>
              Cambio de Cantidad
            </h3>
            <div class="grid grid-cols-3 gap-3">
              <div
                class="p-4 bg-surface rounded-xl border border-border text-center"
              >
                <p class="text-sm text-text-secondary mb-1">Antes</p>
                <p class="text-2xl font-bold text-text-primary">
                  {{ adjustment.quantity_before }}
                </p>
              </div>
              <div
                class="p-4 rounded-xl text-center flex flex-col items-center justify-center"
                [class]="
                  adjustment.quantity_change > 0
                    ? 'bg-success/10 border border-success/30'
                    : adjustment.quantity_change < 0
                      ? 'bg-error/10 border border-error/30'
                      : 'bg-muted/10 border border-border'
                "
              >
                <app-icon
                  [name]="
                    adjustment.quantity_change > 0
                      ? 'trending-up'
                      : adjustment.quantity_change < 0
                        ? 'trending-down'
                        : 'minus'
                  "
                  [size]="20"
                  [class]="
                    adjustment.quantity_change > 0
                      ? 'text-success'
                      : adjustment.quantity_change < 0
                        ? 'text-error'
                        : 'text-muted'
                  "
                ></app-icon>
                <p
                  class="text-lg font-bold mt-1"
                  [class]="
                    adjustment.quantity_change > 0
                      ? 'text-success'
                      : adjustment.quantity_change < 0
                        ? 'text-error'
                        : 'text-text-secondary'
                  "
                >
                  {{ adjustment.quantity_change > 0 ? '+' : ''
                  }}{{ adjustment.quantity_change }}
                </p>
              </div>
              <div
                class="p-4 bg-surface rounded-xl border border-border text-center"
              >
                <p class="text-sm text-text-secondary mb-1">Despues</p>
                <p class="text-2xl font-bold text-text-primary">
                  {{ adjustment.quantity_after }}
                </p>
              </div>
            </div>
          </div>

          <!-- Reason Section -->
          @if (adjustment.reason_code || adjustment.description) {
            <div class="space-y-3">
              <h3
                class="text-sm font-semibold text-text-secondary uppercase tracking-wide flex items-center gap-2"
              >
                <app-icon name="file-text" [size]="16"></app-icon>
                Motivo
              </h3>
              <div class="p-4 bg-surface rounded-xl border border-border">
                @if (adjustment.reason_code) {
                  <div class="flex items-center gap-2 mb-2">
                    <span
                      class="px-2 py-1 bg-muted/20 rounded-lg text-sm font-medium text-text-secondary"
                    >
                      {{ getReasonLabel(adjustment.reason_code) }}
                    </span>
                  </div>
                }
                @if (adjustment.description) {
                  <p class="text-text-primary">{{ adjustment.description }}</p>
                } @else {
                  <p class="text-text-muted italic">
                    Sin descripcion adicional
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
              Auditoria
            </h3>
            <div
              class="p-4 bg-surface rounded-xl border border-border space-y-4"
            >
              <!-- Created By -->
              <div class="flex items-start gap-3">
                <div
                  class="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0"
                >
                  <app-icon
                    name="user-plus"
                    [size]="16"
                    class="text-primary"
                  ></app-icon>
                </div>
                <div class="flex-1">
                  <p class="text-sm text-text-secondary">Creado por</p>
                  <p class="font-medium text-text-primary">
                    {{
                      adjustment.created_by_user?.user_name ||
                        'Usuario desconocido'
                    }}
                  </p>
                  @if (adjustment.created_by_user?.email) {
                    <p class="text-xs text-text-muted">
                      {{ adjustment.created_by_user?.email }}
                    </p>
                  }
                  <p class="text-xs text-text-muted mt-1">
                    {{ adjustment.created_at | date: 'dd/MM/yyyy HH:mm' }}
                  </p>
                </div>
              </div>

              <!-- Approved By -->
              @if (adjustment.approved_at) {
                <div class="flex items-start gap-3 pt-3 border-t border-border">
                  <div
                    class="w-8 h-8 bg-success/10 rounded-full flex items-center justify-center flex-shrink-0"
                  >
                    <app-icon
                      name="check-circle"
                      [size]="16"
                      class="text-success"
                    ></app-icon>
                  </div>
                  <div class="flex-1">
                    <p class="text-sm text-text-secondary">Aprobado por</p>
                    <p class="font-medium text-text-primary">
                      {{
                        adjustment.approved_by_user?.user_name ||
                          'Usuario desconocido'
                      }}
                    </p>
                    @if (adjustment.approved_by_user?.email) {
                      <p class="text-xs text-text-muted">
                        {{ adjustment.approved_by_user?.email }}
                      </p>
                    }
                    <p class="text-xs text-text-muted mt-1">
                      {{ adjustment.approved_at | date: 'dd/MM/yyyy HH:mm' }}
                    </p>
                  </div>
                </div>
              }
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
export class AdjustmentDetailModalComponent {
  @Input() isOpen = false;
  @Input() adjustment: InventoryAdjustment | null = null;

  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() close = new EventEmitter<void>();

  private typeConfig: Record<
    AdjustmentType,
    { label: string; icon: string; colorClass: string }
  > = {
    damage: {
      label: 'Dañado',
      icon: 'alert-triangle',
      colorClass: 'bg-warning/20 text-warning-700 border border-warning/30',
    },
    loss: {
      label: 'Perdida',
      icon: 'circle-x',
      colorClass: 'bg-error/15 text-error-700 border border-error/30',
    },
    theft: {
      label: 'Robo',
      icon: 'shield-off',
      colorClass: 'bg-error/20 text-error-800 border border-error/40',
    },
    expiration: {
      label: 'Vencido',
      icon: 'clock',
      colorClass: 'bg-orange-100 text-orange-700 border border-orange-200',
    },
    count_variance: {
      label: 'Conteo',
      icon: 'hash',
      colorClass: 'bg-info/15 text-info-700 border border-info/30',
    },
    manual_correction: {
      label: 'Corrección',
      icon: 'edit',
      colorClass: 'bg-primary/15 text-primary-700 border border-primary/30',
    },
  };

  private reasonLabels: Record<string, string> = {
    INV_COUNT: 'Conteo de inventario',
    DAMAGED: 'Producto danado',
    EXPIRED: 'Producto vencido',
    LOST: 'Producto perdido',
    THEFT: 'Robo confirmado',
    OTHER: 'Otro',
  };

  getTypeLabel(): string {
    if (!this.adjustment) return '';
    return (
      this.typeConfig[this.adjustment.adjustment_type]?.label ||
      this.adjustment.adjustment_type
    );
  }

  getTypeIcon(): string {
    if (!this.adjustment) return 'help-circle';
    return (
      this.typeConfig[this.adjustment.adjustment_type]?.icon || 'help-circle'
    );
  }

  getTypeColorClasses(): string {
    if (!this.adjustment) return 'bg-muted/10 text-muted';
    return (
      this.typeConfig[this.adjustment.adjustment_type]?.colorClass ||
      'bg-muted/10 text-muted'
    );
  }

  getReasonLabel(code: string): string {
    return this.reasonLabels[code] || code;
  }

  onClose(): void {
    this.close.emit();
  }
}
