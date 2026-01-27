import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  TableComponent,
  InputsearchComponent,
  ButtonComponent,
  IconComponent,
  TableColumn,
  TableAction,
} from '../../../../../../shared/components';
import { Customer } from '../../models/customer.model';

@Component({
  selector: 'app-customer-list',
  standalone: true,
  imports: [
    CommonModule,
    TableComponent,
    InputsearchComponent,
    ButtonComponent,
    IconComponent,
    FormsModule,
  ],
  template: `
    <!-- Customer List Container matching Products style -->
    <div
      class="bg-surface rounded-card shadow-card border border-border min-h-[600px]"
    >
      <div class="px-6 py-4 border-b border-border">
        <div
          class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
        >
          <div class="flex-1 min-w-0">
            <h2 class="text-lg font-semibold text-text-primary">
              Todos los Clientes ({{ totalItems }})
            </h2>
          </div>

          <div
            class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto"
          >
            <!-- Quick search input -->
            <app-inputsearch
              class="w-full sm:w-64 flex-shrink-0"
              size="sm"
              placeholder="Buscar clientes..."
              (search)="onSearch($event)"
            ></app-inputsearch>

            <!-- Action buttons -->
            <div class="flex gap-2 items-center ml-auto">
              <app-button
                variant="outline"
                size="sm"
                (clicked)="refresh.emit()"
                [disabled]="loading"
                title="Actualizar"
              >
                <app-icon name="refresh" [size]="16" slot="icon"></app-icon>
              </app-button>

              <app-button
                variant="primary"
                size="sm"
                (clicked)="create.emit()"
                title="Nuevo Cliente"
              >
                <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                <span class="hidden sm:inline">Nuevo Cliente</span>
              </app-button>
            </div>
          </div>
        </div>
      </div>

      <!-- Loading State -->
      <div *ngIf="loading" class="p-8 text-center">
        <div
          class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
        ></div>
        <p class="mt-2 text-text-secondary">Cargando clientes...</p>
      </div>

      <!-- Empty State -->
      <div
        *ngIf="!loading && customers.length === 0"
        class="p-12 text-center text-gray-500"
      >
        <app-icon
          name="users"
          [size]="48"
          class="mx-auto mb-4 text-gray-300"
        ></app-icon>
        <h3 class="text-lg font-medium text-gray-900">
          No se encontraron clientes
        </h3>
        <p class="mt-1">Comienza creando un nuevo cliente.</p>
        <div class="mt-6">
          <app-button variant="primary" (clicked)="create.emit()">
            <app-icon name="plus" [size]="16" class="mr-2"></app-icon>
            Agregar Cliente
          </app-button>
        </div>
      </div>

      <!-- Table -->
      <div *ngIf="!loading && customers.length > 0" class="p-6">
        <app-table
          [data]="customers"
          [columns]="columns"
          [actions]="actions"
          [loading]="loading"
          [hoverable]="true"
          [striped]="true"
          size="md"
        ></app-table>
      </div>
    </div>
  `,
})
export class CustomerListComponent {
  @Input() customers: Customer[] = [];
  @Input() loading = false;
  @Input() totalItems = 0;

  @Output() search = new EventEmitter<string>();
  @Output() create = new EventEmitter<void>();
  @Output() edit = new EventEmitter<Customer>();
  @Output() delete = new EventEmitter<Customer>();
  @Output() refresh = new EventEmitter<void>();

  columns: TableColumn[] = [
    { key: 'first_name', label: 'Nombre', sortable: true, priority: 1 },
    { key: 'last_name', label: 'Apellido', sortable: true, priority: 1 },
    { key: 'email', label: 'Correo', sortable: true, priority: 2 },
    { key: 'phone', label: 'Teléfono', priority: 3 },
    { key: 'document_number', label: 'Número de ID', priority: 2 },
    { key: 'total_orders', label: 'Pedidos', sortable: true, priority: 3 },
    {
      key: 'created_at',
      label: 'Unido',
      sortable: true,
      priority: 3,
      transform: (val: any) => (val ? new Date(val).toLocaleDateString() : '-'),
    },
  ];

  actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'ghost',
      action: (row) => this.edit.emit(row),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (row) => this.delete.emit(row),
    },
  ];

  onSearch(query: string) {
    this.search.emit(query);
  }
}
