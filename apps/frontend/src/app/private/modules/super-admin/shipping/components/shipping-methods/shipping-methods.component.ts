import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ShippingService } from '../../services/shipping.service';
import { ShippingMethod } from '../../interfaces/shipping.interface';
import { ShippingMethodModalComponent } from '../shipping-method-modal/shipping-method-modal.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { TableColumn, TableAction } from '../../../../../../shared/components/table/table.component';
import { ResponsiveDataViewComponent, ItemListCardConfig } from '../../../../../../shared/components/index';

@Component({
  selector: 'app-superadmin-shipping-methods',
  standalone: true,
  imports: [CommonModule, ShippingMethodModalComponent, IconComponent, ButtonComponent, ResponsiveDataViewComponent],
  template: `
    <div class="space-y-6">
      <!-- Methods Table -->
      <div class="bg-white rounded-2xl shadow-sm border border-[var(--color-border)] overflow-hidden">
        <div class="p-6 border-b border-[var(--color-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-50/50">
          <div>
            <h2 class="text-lg font-bold text-[var(--color-text-primary)] mb-1">Métodos de Envío del Sistema</h2>
            <p class="text-sm text-[var(--color-text-secondary)]">Opciones de entrega disponibles para todas las tiendas.</p>
          </div>
          <app-button (clicked)="openCreateModal()" variant="primary" size="sm">
            <app-icon name="plus" size="18" slot="icon" class="mr-2"></app-icon>
            Nuevo Método
          </app-button>
        </div>
        <div class="p-2 md:p-4">
          <app-responsive-data-view
            [data]="methods"
            [columns]="columns"
            [cardConfig]="cardConfig"
            [actions]="actions"
            emptyMessage="No hay métodos de envío del sistema configurados"
            emptyIcon="truck"
            *ngIf="methods.length > 0; else emptyState"
          ></app-responsive-data-view>
        </div>

        <ng-template #emptyState>
          <div class="py-20 text-center">
            <div class="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6 border border-gray-100">
              <app-icon name="package" size="40" class="text-gray-300"></app-icon>
            </div>
            <h3 class="text-xl font-bold text-[var(--color-text-primary)]">Sin métodos de envío del sistema</h3>
            <p class="text-[var(--color-text-secondary)] max-w-sm mx-auto mt-2">
              No hay métodos de envío del sistema configurados. Crea métodos que estarán disponibles para todas las tiendas.
            </p>
            <app-button (clicked)="openCreateModal()" variant="outline" size="sm" class="mt-8">
              <app-icon name="plus" size="18" slot="icon" class="mr-2"></app-icon>
              Crear método del sistema
            </app-button>
          </div>
        </ng-template>

        <!-- MODAL -->
        <app-superadmin-shipping-method-modal
          *ngIf="showModal"
          [method]="selectedMethod"
          (close)="closeModal()"
          (saved)="loadData()">
        </app-superadmin-shipping-method-modal>
      </div>
    </div>
  `
})
export class ShippingMethodsComponent implements OnInit {
  private shippingService = inject(ShippingService);
  private dialogService = inject(DialogService);

  methods: ShippingMethod[] = [];
  showModal = false;
  selectedMethod?: ShippingMethod;

  columns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true },
    { key: 'code', label: 'Código', sortable: true },
    { key: 'type', label: 'Tipo', badge: true, badgeConfig: { type: 'custom', colorMap: { 'pickup': '#3b82f6', 'own_fleet': '#10b981', 'carrier': '#f59e0b', 'third_party_provider': '#8b5cf6', 'custom': '#6b7280' } } },
    { key: 'is_system', label: 'Origen', badge: true, badgeConfig: { type: 'custom', colorMap: { 'true': '#8b5cf6' } }, transform: (val: boolean) => val ? 'Sistema' : 'Tienda' },
    { key: 'is_active', label: 'Estado', badge: true, badgeConfig: { type: 'status' }, align: 'center', transform: (val: boolean) => val ? 'Activo' : 'Inactivo' },
  ];

  actions: TableAction[] = [
    { label: 'Editar', icon: 'edit', variant: 'ghost', action: (method) => this.openEditModal(method) },
    { label: 'Eliminar', icon: 'trash-2', variant: 'danger', action: (method) => this.deleteMethod(method) },
  ];

  // Card configuration for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'code',
    badgeKey: 'is_active',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (val: boolean) => val ? 'Activo' : 'Inactivo',
    detailKeys: [
      { key: 'type', label: 'Tipo' },
      { key: 'is_system', label: 'Origen', transform: (val: boolean) => val ? 'Sistema' : 'Tienda' },
    ],
  };

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.shippingService.getMethods().subscribe((data) => {
      this.methods = data;
    });
  }

  openCreateModal() {
    this.selectedMethod = undefined;
    this.showModal = true;
  }

  openEditModal(method: ShippingMethod) {
    this.selectedMethod = method;
    this.showModal = true;
  }

  deleteMethod(method: ShippingMethod) {
    this.dialogService.confirm({
      title: 'Eliminar Método de Envío del Sistema',
      message: `¿Estás seguro de que deseas eliminar el método de envío "${method.name}"? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger'
    }).then(confirmed => {
      if (confirmed) {
        this.shippingService.deleteMethod(method.id).subscribe(() => {
          this.loadData();
        });
      }
    });
  }

  closeModal() {
    this.showModal = false;
    this.selectedMethod = undefined;
  }
}
