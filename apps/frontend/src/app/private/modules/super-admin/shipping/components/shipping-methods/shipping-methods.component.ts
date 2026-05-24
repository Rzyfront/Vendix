import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ShippingService } from '../../services/shipping.service';
import { ShippingMethod } from '../../interfaces/shipping.interface';
import { ShippingMethodModalComponent } from '../shipping-method-modal/shipping-method-modal.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import {
  TableColumn,
  TableAction,
} from '../../../../../../shared/components/table/table.component';
import {
  ResponsiveDataViewComponent,
  ItemListCardConfig,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'app-superadmin-shipping-methods',
  standalone: true,
  imports: [
    ShippingMethodModalComponent,
    IconComponent,
    ButtonComponent,
    ResponsiveDataViewComponent,
  ],
  template: `
    <div class="space-y-6">
      <!-- Methods Table -->
      <div
        class="bg-white rounded-2xl shadow-sm border border-[var(--color-border)] overflow-hidden"
      >
        <div
          class="p-6 border-b border-[var(--color-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-50/50"
        >
          <div>
            <h2 class="text-lg font-bold text-[var(--color-text-primary)] mb-1">
              Métodos de Envío del Sistema
            </h2>
            <p class="text-sm text-[var(--color-text-secondary)]">
              Opciones de entrega disponibles para todas las tiendas.
            </p>
          </div>
          <app-button (clicked)="openCreateModal()" variant="primary" size="sm">
            <app-icon name="plus" size="18" slot="icon" class="mr-2"></app-icon>
            Nuevo Método
          </app-button>
        </div>
        <div class="p-2 md:p-4">
          @if (loading()) {
            <div
              class="flex flex-col items-center justify-center py-20 text-gray-400 gap-3"
            >
              <app-icon name="loader-2" size="32" [spin]="true"></app-icon>
              <span class="text-sm font-medium italic"
                >Cargando métodos...</span
              >
            </div>
          } @else if (methods().length > 0) {
            <app-responsive-data-view
              [data]="methods()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [actions]="actions"
              emptyMessage="No hay métodos de envío del sistema configurados"
              emptyIcon="truck"
            ></app-responsive-data-view>
          } @else {
            <div class="py-20 text-center">
              <div
                class="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6 border border-gray-100"
              >
                <app-icon
                  name="package"
                  size="40"
                  class="text-gray-300"
                ></app-icon>
              </div>
              <h3 class="text-xl font-bold text-[var(--color-text-primary)]">
                Sin métodos de envío del sistema
              </h3>
              <p
                class="text-[var(--color-text-secondary)] max-w-sm mx-auto mt-2"
              >
                No hay métodos de envío del sistema configurados. Crea métodos
                que estarán disponibles para todas las tiendas.
              </p>
              <app-button
                (clicked)="openCreateModal()"
                variant="outline"
                size="sm"
                class="mt-8"
              >
                <app-icon
                  name="plus"
                  size="18"
                  slot="icon"
                  class="mr-2"
                ></app-icon>
                Crear método del sistema
              </app-button>
            </div>
          }
        </div>

        @defer (when showModal()) {
          <app-superadmin-shipping-method-modal
            [method]="selectedMethod()"
            (close)="closeModal()"
            (saved)="onSaved()"
          >
          </app-superadmin-shipping-method-modal>
        }
      </div>
    </div>
  `,
})
export class ShippingMethodsComponent implements OnInit {
  private shippingService = inject(ShippingService);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);

  readonly methods = signal<ShippingMethod[]>([]);
  readonly loading = signal(false);
  readonly showModal = signal(false);
  readonly selectedMethod = signal<ShippingMethod | undefined>(undefined);
  readonly deletingIds = signal<Set<number>>(new Set());

  readonly isDeleting = computed(() => this.deletingIds().size > 0);

  columns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true },
    { key: 'code', label: 'Código', sortable: true },
    {
      key: 'type',
      label: 'Tipo',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          pickup: '#3b82f6',
          own_fleet: '#10b981',
          carrier: '#f59e0b',
          third_party_provider: '#8b5cf6',
          custom: '#6b7280',
        },
      },
    },
    {
      key: 'is_system',
      label: 'Origen',
      badge: true,
      badgeConfig: { type: 'custom', colorMap: { true: '#8b5cf6' } },
      transform: (val: boolean) => (val ? 'Sistema' : 'Tienda'),
    },
    {
      key: 'is_active',
      label: 'Estado',
      badge: true,
      badgeConfig: { type: 'status' },
      align: 'center',
      transform: (val: boolean) => (val ? 'Activo' : 'Inactivo'),
    },
  ];

  actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'info',
      action: (method) => this.openEditModal(method),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (method) => this.deleteMethod(method),
      disabled: (method) => this.deletingIds().has(method.id),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'code',
    badgeKey: 'is_active',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (val: boolean) => (val ? 'Activo' : 'Inactivo'),
    detailKeys: [
      { key: 'type', label: 'Tipo' },
      {
        key: 'is_system',
        label: 'Origen',
        transform: (val: boolean) => (val ? 'Sistema' : 'Tienda'),
      },
    ],
  };

  ngOnInit() {
    this.loadData();
  }

  async loadData() {
    this.loading.set(true);
    try {
      const data = await firstValueFrom(this.shippingService.getMethods());
      this.methods.set(data);
    } catch (e) {
      const { userMessage, devMessage } = parseApiError(e);
      console.error('Error loading shipping methods', devMessage, e);
      this.toastService.error(userMessage, 'Error al cargar');
    } finally {
      this.loading.set(false);
    }
  }

  openCreateModal() {
    this.selectedMethod.set(undefined);
    this.showModal.set(true);
  }

  openEditModal(method: ShippingMethod) {
    this.selectedMethod.set(method);
    this.showModal.set(true);
  }

  async deleteMethod(method: ShippingMethod) {
    if (this.deletingIds().has(method.id)) return;

    const confirmed = await this.dialogService.confirm({
      title: 'Eliminar Método de Envío del Sistema',
      message: `¿Estás seguro de que deseas eliminar el método de envío "${method.name}"? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.deletingIds.update((s) => new Set(s).add(method.id));
    try {
      await firstValueFrom(this.shippingService.deleteMethod(method.id));
      this.toastService.success(
        `Método "${method.name}" eliminado.`,
        'Eliminado',
      );
      this.methods.update((arr) => arr.filter((m) => m.id !== method.id));
    } catch (e) {
      const { userMessage, devMessage } = parseApiError(e);
      console.error('Error deleting shipping method', devMessage, e);
      this.toastService.error(userMessage, 'Error al eliminar');
    } finally {
      this.deletingIds.update((s) => {
        const next = new Set(s);
        next.delete(method.id);
        return next;
      });
    }
  }

  onSaved() {
    this.loadData();
  }

  closeModal() {
    this.showModal.set(false);
    this.selectedMethod.set(undefined);
  }
}
