import { Component, EventEmitter, Input, Output, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ResponsiveDataViewComponent,
  InputsearchComponent,
  IconComponent,
  ButtonComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  OptionsDropdownComponent,
  FilterConfig,
  DropdownAction,
  FilterValues,
} from '../../../../../../shared/components';
import { Customer } from '../../models/customer.model';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';

@Component({
  selector: 'app-customer-list',
  standalone: true,
  imports: [
    CommonModule,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    IconComponent,
    ButtonComponent,
    FormsModule,
  ],
  template: `
    <!-- Customer List Container - Mobile First -->
    <div class="md:bg-surface md:rounded-xl md:shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border md:min-h-[600px] md:overflow-hidden">

      <!-- Search Section: sticky below stats on mobile -->
      <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
        <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
          <!-- Title -->
          <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
            Todos los Clientes ({{ totalItems }})
          </h2>

          <!-- Search + Options -->
          <div class="flex items-center gap-2 w-full md:w-auto">
            <app-inputsearch
              class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              size="sm"
              placeholder="Buscar clientes..."
              (search)="onSearch($event)"
            ></app-inputsearch>

            <app-options-dropdown
              class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              [filters]="filterConfigs"
              [filterValues]="filterValues"
              [actions]="dropdownActions"
              [isLoading]="loading"
              (filterChange)="onFilterChange($event)"
              (clearAllFilters)="onClearFilters()"
              (actionClick)="onActionClick($event)"
            ></app-options-dropdown>
          </div>
        </div>
      </div>

      <!-- Loading State -->
      <div *ngIf="loading" class="p-4 md:p-6 text-center">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <p class="mt-2 text-text-secondary">Cargando clientes...</p>
      </div>

      <!-- Empty State -->
      <div *ngIf="!loading && customers.length === 0" class="p-12 text-center text-gray-500">
        <app-icon name="users" [size]="48" class="mx-auto mb-4 text-gray-300"></app-icon>
        <h3 class="text-lg font-medium text-gray-900">No se encontraron clientes</h3>
        <p class="mt-1">Comienza creando un nuevo cliente.</p>
        <div class="mt-6">
          <app-button variant="primary" (clicked)="create.emit()">
            <app-icon name="plus" [size]="16" class="mr-2"></app-icon>
            Agregar Cliente
          </app-button>
        </div>
      </div>

      <!-- Responsive Data View -->
      <div *ngIf="!loading && customers.length > 0" class="px-2 pb-2 pt-1 md:p-4">
        <app-responsive-data-view
          [data]="customers"
          [columns]="columns"
          [cardConfig]="cardConfig"
          [actions]="actions"
          [loading]="loading"
          [hoverable]="true"
          [striped]="true"
          [emptyMessage]="'No se encontraron clientes'"
          [emptyIcon]="'users'"
          tableSize="md"
        ></app-responsive-data-view>
      </div>
    </div>
  `,
})
export class CustomerListComponent implements OnInit {
  private currencyService = inject(CurrencyFormatService);

  @Input() customers: Customer[] = [];
  @Input() loading = false;
  @Input() totalItems = 0;

  ngOnInit(): void {
    // Asegurar que la moneda esté cargada
    this.currencyService.loadCurrency();
  }

  @Output() search = new EventEmitter<string>();
  @Output() filter = new EventEmitter<FilterValues>();
  @Output() create = new EventEmitter<void>();
  @Output() edit = new EventEmitter<Customer>();
  @Output() delete = new EventEmitter<Customer>();
  @Output() refresh = new EventEmitter<void>();

  // Filter configuration for the options dropdown
  filterConfigs: FilterConfig[] = [
    {
      key: 'is_active',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'true', label: 'Activos' },
        { value: 'false', label: 'Inactivos' },
      ],
    },
  ];

  // Current filter values
  filterValues: FilterValues = {};

  // Dropdown actions
  dropdownActions: DropdownAction[] = [
    { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
    { label: 'Nuevo Cliente', icon: 'plus', action: 'create', variant: 'primary' },
  ];

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

  cardConfig: ItemListCardConfig = {
    titleKey: 'first_name',
    titleTransform: (item: any) => `${item.first_name} ${item.last_name}`,
    subtitleKey: 'email',
    avatarFallbackIcon: 'user',
    avatarShape: 'circle',
    badgeKey: 'state',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (v: any) => (v === 'active' ? 'Activo' : 'Inactivo'),
    detailKeys: [
      { key: 'phone', label: 'Teléfono', icon: 'phone' },
      { key: 'document_number', label: 'Documento', icon: 'credit-card' },
      { key: 'total_orders', label: 'Pedidos' },
      {
        key: 'created_at',
        label: 'Registrado',
        transform: (v: any) => (v ? new Date(v).toLocaleDateString() : '-'),
      },
    ],
    footerKey: 'total_spend',
    footerLabel: 'Total Gastado',
    footerStyle: 'prominent',
    footerTransform: (v: any) => this.formatCurrency(v || 0),
  };

  actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'ghost',
      action: (row: any) => this.edit.emit(row),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (row: any) => this.delete.emit(row),
    },
  ];

  onSearch(query: string) {
    this.search.emit(query);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    this.filter.emit(values);
  }

  onClearFilters(): void {
    this.filterValues = {};
    this.filter.emit({});
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.create.emit();
        break;
      case 'refresh':
        this.refresh.emit();
        break;
    }
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value);
  }
}
