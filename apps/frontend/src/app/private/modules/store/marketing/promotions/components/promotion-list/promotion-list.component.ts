import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import { CardComponent } from '../../../../../../../shared/components/card/card.component';
import {
  ResponsiveDataViewComponent,
  InputsearchComponent,
  OptionsDropdownComponent,
  IconComponent,
  ButtonComponent,
  PaginationComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  FilterConfig,
  FilterValues,
  DropdownAction,
} from '../../../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency';
import { Promotion } from '../../interfaces/promotion.interface';
import { selectPromotionsMeta } from '../../state/selectors/promotions.selectors';

@Component({
  selector: 'app-promotion-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardComponent,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    IconComponent,
    ButtonComponent,
    PaginationComponent,
  ],
  template: `
    <app-card [responsive]="true" [padding]="false">
      <!-- Search Section: sticky below stats on mobile -->
      <div
        class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                  md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
      >
        <div
          class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
        >
          <!-- Title -->
          <h2
            class="text-[13px] font-bold text-gray-600 tracking-wide
                     md:text-lg md:font-semibold md:text-text-primary"
          >
            Promociones
            <span *ngIf="meta" class="text-text-secondary font-normal">
              ({{ meta.total }})
            </span>
          </h2>

          <!-- Search + Actions Row -->
          <div class="flex items-center gap-2 w-full md:w-auto">
            <app-inputsearch
              class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              size="sm"
              placeholder="Buscar promociones..."
              [debounceTime]="300"
              (search)="onSearch($event)"
            ></app-inputsearch>

            <app-button
              variant="outline"
              size="sm"
              customClasses="w-9 h-9 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
              (clicked)="create.emit()"
              title="Nueva Promocion"
            >
              <app-icon slot="icon" name="plus" [size]="18"></app-icon>
            </app-button>

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
        <div
          class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
        ></div>
        <p class="mt-2 text-text-secondary">Cargando promociones...</p>
      </div>

      <!-- Empty State -->
      <div
        *ngIf="!loading && promotions.length === 0"
        class="p-12 text-center text-gray-500"
      >
        <app-icon
          name="tag"
          [size]="48"
          class="mx-auto mb-4 text-gray-300"
        ></app-icon>
        <h3 class="text-lg font-medium text-gray-900">
          No se encontraron promociones
        </h3>
        <p class="mt-1">Comienza creando una nueva promocion.</p>
        <div class="mt-6 flex justify-center">
          <app-button variant="primary" (clicked)="create.emit()">
            <app-icon slot="icon" name="plus" [size]="16"></app-icon>
            Nueva Promocion
          </app-button>
        </div>
      </div>

      <!-- Data View -->
      <div
        *ngIf="!loading && promotions.length > 0"
        class="px-2 pb-2 pt-3 md:p-4"
      >
        <app-responsive-data-view
          [data]="promotions"
          [columns]="columns"
          [cardConfig]="cardConfig"
          [actions]="tableActions"
          [loading]="loading"
          [hoverable]="true"
          [striped]="true"
          emptyMessage="No hay promociones"
          emptyIcon="tag"
          tableSize="md"
          (rowClick)="edit.emit($event)"
        ></app-responsive-data-view>

        <!-- Pagination -->
        <div *ngIf="meta && meta.total > 0" class="mt-4 flex justify-center">
          <app-pagination
            [currentPage]="meta.page"
            [totalPages]="meta.total_pages"
            [total]="meta.total"
            [limit]="meta.limit"
            (pageChange)="pageChange.emit($event)"
          ></app-pagination>
        </div>
      </div>
    </app-card>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class PromotionListComponent {
  @Input() promotions: Promotion[] = [];
  @Input() loading = false;
  @Input() meta: any = null;

  @Output() create = new EventEmitter<void>();
  @Output() edit = new EventEmitter<Promotion>();
  @Output() activate = new EventEmitter<number>();
  @Output() pause = new EventEmitter<number>();
  @Output() cancel = new EventEmitter<number>();
  @Output() delete = new EventEmitter<number>();
  @Output() pageChange = new EventEmitter<number>();
  @Output() searchChange = new EventEmitter<string>();
  @Output() filterChange = new EventEmitter<Record<string, string>>();

  private currency_service = inject(CurrencyFormatService);

  searchTerm = '';
  filterValues: FilterValues = {};

  // ── Filter Configs ──────────────────────────────────────────────────

  filterConfigs: FilterConfig[] = [
    {
      key: 'state',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'draft', label: 'Borrador' },
        { value: 'scheduled', label: 'Programada' },
        { value: 'active', label: 'Activa' },
        { value: 'paused', label: 'Pausada' },
        { value: 'expired', label: 'Expirada' },
        { value: 'cancelled', label: 'Cancelada' },
      ],
    },
    {
      key: 'type',
      label: 'Tipo',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'percentage', label: 'Porcentaje' },
        { value: 'fixed_amount', label: 'Monto fijo' },
      ],
    },
    {
      key: 'scope',
      label: 'Alcance',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'order', label: 'Orden' },
        { value: 'product', label: 'Producto' },
        { value: 'category', label: 'Categoria' },
      ],
    },
  ];

  dropdownActions: DropdownAction[] = [
    {
      label: 'Nueva Promocion',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ];

  // ── Table Columns ───────────────────────────────────────────────────

  columns: TableColumn[] = [
    {
      key: 'name',
      label: 'Nombre',
      sortable: true,
      priority: 1,
    },
    {
      key: 'type',
      label: 'Tipo',
      priority: 2,
      transform: (val: string) =>
        val === 'percentage' ? 'Porcentaje' : 'Monto fijo',
    },
    {
      key: 'value',
      label: 'Valor',
      priority: 1,
      transform: (val: number, row: any) =>
        row.type === 'percentage'
          ? `${val}%`
          : this.currency_service.format(val),
    },
    {
      key: 'scope',
      label: 'Alcance',
      priority: 3,
      transform: (val: string) => {
        const labels: Record<string, string> = {
          order: 'Orden',
          product: 'Producto',
          category: 'Categoria',
        };
        return labels[val] || val;
      },
    },
    {
      key: 'start_date',
      label: 'Inicio',
      priority: 3,
      transform: (val: string) =>
        val ? new Date(val).toLocaleDateString() : '-',
    },
    {
      key: 'state',
      label: 'Estado',
      sortable: true,
      priority: 1,
      transform: (val: string) => {
        const labels: Record<string, string> = {
          draft: 'Borrador',
          scheduled: 'Programada',
          active: 'Activa',
          paused: 'Pausada',
          expired: 'Expirada',
          cancelled: 'Cancelada',
        };
        return labels[val] || val;
      },
    },
    {
      key: 'usage_count',
      label: 'Usos',
      priority: 3,
      transform: (val: number, row: any) =>
        row.usage_limit ? `${val}/${row.usage_limit}` : `${val}`,
    },
  ];

  // ── Card Config (Mobile) ────────────────────────────────────────────

  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'code',
    subtitleTransform: (item: any) => (item.code ? `Codigo: ${item.code}` : ''),
    avatarFallbackIcon: 'tag',
    avatarShape: 'square',
    badgeKey: 'state',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (val: string) => {
      const labels: Record<string, string> = {
        draft: 'Borrador',
        scheduled: 'Programada',
        active: 'Activa',
        paused: 'Pausada',
        expired: 'Expirada',
        cancelled: 'Cancelada',
      };
      return labels[val] || val;
    },
    detailKeys: [
      {
        key: 'type',
        label: 'Tipo',
        icon: 'percent',
        transform: (val: string) =>
          val === 'percentage' ? 'Porcentaje' : 'Monto fijo',
      },
      {
        key: 'start_date',
        label: 'Inicio',
        icon: 'calendar',
        transform: (val: string) =>
          val ? new Date(val).toLocaleDateString() : '-',
      },
      {
        key: 'usage_count',
        label: 'Usos',
        transform: (val: number, item: any) =>
          item.usage_limit ? `${val}/${item.usage_limit}` : `${val}`,
      },
    ],
    footerKey: 'value',
    footerLabel: 'Descuento',
    footerStyle: 'prominent',
    footerTransform: (val: number, item: any) =>
      item.type === 'percentage'
        ? `${val}%`
        : this.currency_service.format(val),
  };

  // ── Table Actions ───────────────────────────────────────────────────

  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'info',
      action: (row: any) => this.edit.emit(row),
    },
    {
      label: 'Activar',
      icon: 'play',
      variant: 'success',
      action: (row: any) => this.activate.emit(row.id),
      show: (row: any) => ['draft', 'scheduled', 'paused'].includes(row.state),
    },
    {
      label: 'Pausar',
      icon: 'pause',
      variant: 'warning',
      action: (row: any) => this.pause.emit(row.id),
      show: (row: any) => row.state === 'active',
    },
    {
      label: 'Cancelar',
      icon: 'x-circle',
      variant: 'danger',
      action: (row: any) => this.cancel.emit(row.id),
      show: (row: any) => !['cancelled', 'expired'].includes(row.state),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (row: any) => this.delete.emit(row.id),
      show: (row: any) => row.state === 'draft',
    },
  ];

  // ── Event Handlers ──────────────────────────────────────────────────

  onSearch(term: string): void {
    this.searchTerm = term;
    this.searchChange.emit(term);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = { ...values };
    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(values)) {
      result[key] = (val as string) || '';
    }
    this.filterChange.emit(result);
  }

  onClearFilters(): void {
    this.filterValues = {};
    this.filterChange.emit({ state: '', type: '', scope: '' });
  }

  onActionClick(action: string): void {
    if (action === 'create') {
      this.create.emit();
    }
  }
}
