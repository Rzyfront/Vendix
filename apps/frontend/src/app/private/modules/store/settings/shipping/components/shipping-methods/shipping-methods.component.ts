import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ShippingService } from '../../services/shipping.service';
import { ShippingMethod } from '../../interfaces/shipping.interface';
import { ShippingMethodModalComponent } from '../shipping-method-modal/shipping-method-modal.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { DialogService } from '../../../../../../../shared/components/dialog/dialog.service';
import { TableComponent, TableColumn, TableAction } from '../../../../../../../shared/components/table/table.component';

@Component({
  selector: 'app-shipping-methods',
  standalone: true,
  imports: [CommonModule, ShippingMethodModalComponent, IconComponent, ButtonComponent, TableComponent],
  template: `
    <div class="bg-white rounded-2xl shadow-sm border border-[var(--color-border)] overflow-hidden">
      <div class="p-6 border-b border-[var(--color-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-50/50">
        <div>
          <h2 class="text-lg font-bold text-[var(--color-text-primary)] mb-1">Métodos de Envío</h2>
          <p class="text-sm text-[var(--color-text-secondary)]">Opciones de entrega disponibles para tus clientes.</p>
        </div>
        <app-button (clicked)="openCreateModal()" variant="primary" size="sm">
          <app-icon name="plus" size="18" slot="icon" class="mr-2"></app-icon>
          Nuevo Método
        </app-button>
      </div>
      <div class="p-2 md:p-4">
        <app-table
          [data]="methods"
          [columns]="columns"
          [actions]="actions"
          emptyMessage="No hay métodos de envío configurados"
          *ngIf="methods.length > 0; else emptyState"
        ></app-table>
      </div>

      <ng-template #emptyState>
        <div class="py-20 text-center">
          <div class="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6 border border-gray-100">
            <app-icon name="package" size="40" class="text-gray-300"></app-icon>
          </div>
          <h3 class="text-xl font-bold text-[var(--color-text-primary)]">Sin métodos de envío</h3>
          <p class="text-[var(--color-text-secondary)] max-w-sm mx-auto mt-2">
            Aún no has configurado ningún método de envío para tu tienda. Comienza agregando uno para tus clientes.
          </p>
          <app-button (clicked)="openCreateModal()" variant="outline" size="sm" class="mt-8">
            <app-icon name="plus" size="18" slot="icon" class="mr-2"></app-icon>
            Configurar mi primer método
          </app-button>
        </div>
      </ng-template>

      <!-- MODAL -->
      <app-shipping-method-modal 
        *ngIf="showModal" 
        [method]="selectedMethod"
        (close)="closeModal()"
        (saved)="loadMethods()">
      </app-shipping-method-modal>
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
    { key: 'type', label: 'Tipo', badge: true, badgeConfig: { type: 'custom', colorMap: { 'pickup': '#3b82f6', 'own_fleet': '#10b981', 'carrier': '#f59e0b', 'third_party_provider': '#8b5cf6', 'custom': '#6b7280' } } },
    { key: 'is_active', label: 'Estado', badge: true, badgeConfig: { type: 'status' }, align: 'center', transform: (val: boolean) => val ? 'Activo' : 'Inactivo' },
  ];

  actions: TableAction[] = [
    { label: 'Editar', icon: 'edit', variant: 'ghost', action: (method) => this.openEditModal(method) },
    { label: 'Eliminar', icon: 'trash', variant: 'danger', action: (method) => this.deleteMethod(method) },
  ];

  ngOnInit() {
    this.loadMethods();
  }

  loadMethods() {
    this.shippingService.getMethods().subscribe(data => {
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
      title: 'Eliminar Método de Envío',
      message: `¿Estás seguro de que deseas eliminar el método de envío "${method.name}"? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger'
    }).then(confirmed => {
      if (confirmed) {
        this.shippingService.deleteMethod(method.id).subscribe(() => {
          this.loadMethods();
        });
      }
    });
  }

  closeModal() {
    this.showModal = false;
    this.selectedMethod = undefined;
  }
}
