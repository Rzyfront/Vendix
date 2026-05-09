import { Component, computed, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
} from '../../../../../../../shared/components/index';
import {
  OrgAdjustment,
  OrgAdjustmentStatus,
  OrgAdjustmentType,
} from '../../../interfaces/org-adjustment.interface';

const TYPE_LABELS: Record<OrgAdjustmentType, string> = {
  damage: 'Daño',
  loss: 'Pérdida',
  theft: 'Robo',
  expiration: 'Vencido',
  count_variance: 'Conteo',
  manual_correction: 'Corrección',
};

const STATUS_LABELS: Record<OrgAdjustmentStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  cancelled: 'Cancelado',
};

@Component({
  selector: 'app-org-adjustment-detail-modal',
  standalone: true,
  imports: [DatePipe, ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      [title]="modalTitle()"
      [subtitle]="modalSubtitle()"
      size="md"
      (closed)="onClose()"
      (isOpenChange)="isOpenChange.emit($event)"
    >
      @if (adjustment(); as a) {
        <div class="space-y-4">
          <!-- Status badge -->
          <div>
            <span
              class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium"
              [class]="statusClasses()"
            >
              <app-icon
                [name]="statusIcon()"
                [size]="14"
                class="mr-1.5"
              />
              {{ statusLabel() }}
            </span>
          </div>

          <!-- Product / location -->
          <div
            class="p-4 bg-surface-secondary rounded-xl border border-border space-y-2"
          >
            <div class="flex items-center gap-3">
              <app-icon name="package" [size]="18" class="text-info" />
              <div>
                <p class="text-xs text-text-secondary">Producto</p>
                <p class="text-sm font-semibold text-text-primary">
                  {{ a.products?.name || 'Sin nombre' }}
                  @if (a.product_variants?.name) {
                    <span class="text-text-secondary">
                      ({{ a.product_variants?.name }})
                    </span>
                  }
                </p>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <app-icon name="map-pin" [size]="18" class="text-success" />
              <div>
                <p class="text-xs text-text-secondary">Ubicación</p>
                <p class="text-sm font-semibold text-text-primary">
                  {{ a.inventory_locations?.name || '-' }}
                  @if (a.inventory_locations?.is_central_warehouse) {
                    <span
                      class="ml-2 inline-block px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-xs"
                    >
                      Bodega Central
                    </span>
                  }
                </p>
              </div>
            </div>
          </div>

          <!-- Quantity card -->
          <div
            class="grid grid-cols-3 gap-3 p-4 bg-surface-secondary rounded-xl border border-border"
          >
            <div class="text-center">
              <p class="text-xs text-text-secondary">Antes</p>
              <p class="text-lg font-semibold text-text-primary">
                {{ a.quantity_before }}
              </p>
            </div>
            <div class="text-center">
              <p class="text-xs text-text-secondary">Cambio</p>
              <p
                class="text-lg font-semibold"
                [class.text-success]="a.quantity_change > 0"
                [class.text-error]="a.quantity_change < 0"
              >
                {{ a.quantity_change > 0 ? '+' : '' }}{{ a.quantity_change }}
              </p>
            </div>
            <div class="text-center">
              <p class="text-xs text-text-secondary">Después</p>
              <p class="text-lg font-semibold text-text-primary">
                {{ a.quantity_after }}
              </p>
            </div>
          </div>

          <!-- Type & reason -->
          <div class="p-3 bg-surface-secondary rounded-xl border border-border">
            <p class="text-xs text-text-secondary">Tipo</p>
            <p class="text-sm font-medium text-text-primary">
              {{ typeLabel() }}
            </p>
          </div>
          @if (a.description) {
            <div
              class="p-3 bg-surface-secondary rounded-xl border border-border"
            >
              <p class="text-xs text-text-secondary">Motivo</p>
              <p class="text-sm text-text-primary">{{ a.description }}</p>
            </div>
          }

          <!-- Audit trail -->
          <div class="p-3 bg-surface-secondary rounded-xl border border-border">
            <h4 class="text-sm font-medium text-text-secondary mb-2">
              Auditoría
            </h4>
            <div class="space-y-2">
              <div class="flex items-center gap-3 text-sm">
                <div class="w-2 h-2 rounded-full bg-primary"></div>
                <span class="text-text-secondary w-24">Creado</span>
                <span class="text-text-primary font-medium">
                  {{ a.created_at | date: 'short' }}
                  @if (a.users_inventory_adjustments_created_by_user_idTousers; as creator) {
                    · {{ creator.username || creator.email }}
                  }
                </span>
              </div>
              @if (a.approved_at) {
                <div class="flex items-center gap-3 text-sm">
                  <div class="w-2 h-2 rounded-full bg-emerald-500"></div>
                  <span class="text-text-secondary w-24">Aprobado</span>
                  <span class="text-text-primary font-medium">
                    {{ a.approved_at | date: 'short' }}
                    @if (a.users_inventory_adjustments_approved_by_user_idTousers; as approver) {
                      · {{ approver.username || approver.email }}
                    }
                  </span>
                </div>
              }
            </div>
          </div>
        </div>
      }

      <div
        slot="footer"
        class="flex justify-end gap-3 px-6 py-4 bg-gray-50 rounded-b-xl"
      >
        <app-button
          variant="outline"
          (clicked)="onClose()"
          customClasses="!rounded-xl font-bold"
        >
          Cerrar
        </app-button>
        @if (canApproveCurrent()) {
          <app-button
            variant="primary"
            [loading]="isProcessing()"
            (clicked)="approve.emit(adjustment()!)"
            customClasses="!rounded-xl font-bold shadow-md shadow-primary-200"
          >
            <app-icon
              name="check"
              [size]="14"
              class="mr-1.5"
              slot="icon"
            />
            Aprobar
          </app-button>
        }
        @if (canCancelCurrent()) {
          <app-button
            variant="outline"
            [loading]="isProcessing()"
            (clicked)="cancel.emit(adjustment()!)"
            customClasses="!rounded-xl font-bold !text-error !border-error hover:!bg-error/5"
          >
            <app-icon
              name="x-circle"
              [size]="14"
              class="mr-1.5"
              slot="icon"
            />
            Cancelar
          </app-button>
        }
      </div>
    </app-modal>
  `,
})
export class OrgAdjustmentDetailModalComponent {
  readonly isOpen = input(false);
  readonly adjustment = input<OrgAdjustment | null>(null);
  readonly isProcessing = input(false);
  readonly canApprove = input(false);
  readonly canCancel = input(false);

  readonly isOpenChange = output<boolean>();
  readonly closed = output<void>();
  readonly approve = output<OrgAdjustment>();
  readonly cancel = output<OrgAdjustment>();

  readonly statusValue = computed<OrgAdjustmentStatus>(() => {
    const a = this.adjustment();
    if (!a) return 'pending';
    if (a.approved_by_user_id != null) return 'approved';
    return 'pending';
  });

  readonly statusLabel = computed(() => STATUS_LABELS[this.statusValue()]);

  readonly typeLabel = computed(() => {
    const a = this.adjustment();
    if (!a) return '';
    return TYPE_LABELS[a.adjustment_type] ?? a.adjustment_type;
  });

  readonly statusClasses = computed(() => {
    const map: Record<OrgAdjustmentStatus, string> = {
      pending: 'bg-amber-100 text-amber-700',
      approved: 'bg-emerald-100 text-emerald-700',
      cancelled: 'bg-gray-100 text-gray-500',
    };
    return map[this.statusValue()];
  });

  readonly statusIcon = computed(() => {
    const map: Record<OrgAdjustmentStatus, string> = {
      pending: 'clock',
      approved: 'check-circle',
      cancelled: 'x-circle',
    };
    return map[this.statusValue()];
  });

  readonly modalTitle = computed(() => {
    const a = this.adjustment();
    if (!a) return 'Detalle de ajuste';
    return `Ajuste #${a.id}`;
  });

  readonly modalSubtitle = computed(() => this.statusLabel());

  readonly canApproveCurrent = computed(
    () => this.canApprove() && this.statusValue() === 'pending',
  );
  readonly canCancelCurrent = computed(
    () => this.canCancel() && this.statusValue() !== 'cancelled',
  );

  onClose(): void {
    this.closed.emit();
  }
}
