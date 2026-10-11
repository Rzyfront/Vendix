import { Component, input, output, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import { ResponsiveDataViewComponent } from '../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import {
  TableColumn,
  TableAction,
} from '../../../../../../shared/components/table/table.component';
import { ItemListCardConfig } from '../../../../../../shared/components/item-list/item-list.interfaces';
import {
  FilterConfig,
  FilterValues,
  DropdownAction,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { PaginationComponent } from '../../../../../../shared/components/pagination/pagination.component';
import { EmptyStateComponent } from '../../../../../../shared/components/empty-state/empty-state.component';
import { Quotation } from '../../interfaces/quotation.interface';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';

@Component({
  selector: 'app-quotation-list',
  standalone: true,
  imports: [
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
    FormsModule,
],
  template: `
    <app-card [responsive]="true" [padding]="false" overflow="visible">
      <!-- Search Section (inside card) -->
      <div
        class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
               md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
      >
        <div
          class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
        >
          <h2
            class="text-[13px] font-semibold text-text-secondary tracking-wide md:text-lg md:text-text-primary"
          >
            Cotizaciones ({{ paginationData().total }})
          </h2>

          <div class="flex items-center gap-2 w-full md:w-auto">
            <app-inputsearch
              class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              size="sm"
              placeholder="Buscar cotización..."
              ariaLabel="Buscar cotizaciones"
              [debounceTime]="300"
              [ngModel]="searchTerm()"
              (searchChange)="search.emit($event)"
            />

            <app-options-dropdown
              class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              [actions]="dropdownActions()"
              [filters]="filterOptions"
              [filterValues]="filterValues()"
              [isLoading]="loading()"
              (actionClick)="onActionClick($event)"
              (filterChange)="filterChange.emit($event)"
              (clearAllFilters)="clearAllFilters.emit()"
            />
          </div>
        </div>
      </div>

      <!-- Loading State -->
      @if (loading()) {
        <div class="p-4 md:p-6 text-center">
          <div
            class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
          ></div>
          <p class="mt-2 text-text-secondary">Cargando cotizaciones...</p>
        </div>
      }

      <!-- Data View -->
      @if (!loading() && quotations().length === 0) {
        <app-empty-state
          icon="file-text"
          title="No se encontraron cotizaciones"
          description="Ajusta la búsqueda o los filtros para encontrar cotizaciones."
          [showActionButton]="false"
          [showRefreshButton]="false"
          [showClearFilters]="hasFilters()"
          (clearFiltersClick)="clearAllFilters.emit()"
        />
      }

      @if (!loading() && quotations().length > 0) {
        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="quotations()"
            [columns]="columns"
            [cardConfig]="cardConfig"
            [actions]="actions"
            [loading]="loading()"
            rowLabelKey="quotation_number"
            emptyMessage="No se encontraron cotizaciones"
            emptyIcon="file-text"
            (rowClick)="viewDetail.emit($event)"
          ></app-responsive-data-view>
          <div class="mt-4 flex justify-center">
            <app-pagination
              [currentPage]="paginationData().page"
              [totalPages]="paginationData().totalPages"
              [total]="paginationData().total"
              [limit]="paginationData().limit"
              infoStyle="none"
              (pageChange)="pageChange.emit($event)"
            />
          </div>
        </div>
      }
    </app-card>
  `,
})
export class QuotationListComponent {
  private currencyService = inject(CurrencyFormatService);

  quotations = input.required<Quotation[]>();
  loading = input<boolean>(false);
  showContractAction = input(false);
  canCreateQuotation = input(false);
  canReadProfiles = input(false);
  canCreateFromQuotation = input(false);
  canConvertToOrder = input(false);
  canMutateQuotation = input(false);
  canUpdateContractQuotation = input(false);
  canDeleteQuotation = input(false);
  paginationData = input({ page: 1, limit: 50, total: 0, totalPages: 0 });
  searchTerm = input('');
  filterValues = input<FilterValues>({});

  viewDetail = output<Quotation>();
  send = output<Quotation>();
  accept = output<Quotation>();
  reject = output<Quotation>();
  cancel = output<Quotation>();
  convert = output<Quotation>();
  duplicate = output<Quotation>();
  deleteQuotation = output<Quotation>();
  edit = output<Quotation>();
  create = output<void>();
  createContract = output<void>();
  createFromQuotation = output<Quotation>();
  manageProfiles = output<void>();
  search = output<string>();
  filterChange = output<FilterValues>();
  clearAllFilters = output<void>();
  pageChange = output<number>();

  filterOptions: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      placeholder: 'Todos',
      options: [
        { label: 'Borrador', value: 'draft' },
        { label: 'Enviada', value: 'sent' },
        { label: 'Aceptada', value: 'accepted' },
        { label: 'Rechazada', value: 'rejected' },
        { label: 'Expirada', value: 'expired' },
        { label: 'Convertida', value: 'converted' },
        { label: 'Contratada', value: 'contracted' },
        { label: 'Cancelada', value: 'cancelled' },
      ],
    },
  ];

  readonly hasFilters = computed(() =>
    Boolean(this.searchTerm().trim()) || Object.values(this.filterValues()).some(Boolean),
  );

  readonly dropdownActions = computed<DropdownAction[]>(() => {
    const actions: DropdownAction[] = [];
    if (this.canCreateQuotation()) {
      actions.push({ label: 'Crear cotización de venta', icon: 'plus', action: 'create' });
    }
    if (this.showContractAction()) {
      actions.push({ label: 'Cotizar contrato', icon: 'file-text', action: 'createContract' });
    }
    if (this.canReadProfiles()) {
      actions.push({ label: 'Perfiles', icon: 'settings', action: 'manageProfiles' });
    }
    return actions;
  });

  onActionClick(action: string): void {
    if (action === 'create' && this.canCreateQuotation()) this.create.emit();
    if (action === 'createContract' && this.showContractAction()) this.createContract.emit();
    if (action === 'manageProfiles' && this.canReadProfiles()) this.manageProfiles.emit();
  }

  columns: TableColumn[] = [
    { key: 'quotation_number', label: 'Número', sortable: true },
    {
      key: 'customer',
      label: 'Cliente',
      transform: (_, item) =>
        item.customer
          ? `${item.customer.first_name} ${item.customer.last_name}`
          : 'Sin cliente',
    },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      badgeConfig: { type: 'status' },
      transform: (v: string) => this.getStatusLabel(v),
    },
    {
      key: 'grand_total',
      label: 'Total',
      align: 'right',
      transform: (v: number) => this.currencyService.format(v || 0),
    },
    {
      key: 'valid_until',
      label: 'Válida hasta',
      transform: (v: string) =>
        v ? formatDateOnlyUTC(v) : '-',
    },
    {
      key: 'created_at',
      label: 'Fecha',
      transform: (v: string) => new Date(v).toLocaleDateString('es-CO'),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'quotation_number',
    subtitleKey: 'customer',
    subtitleTransform: (item: Quotation) =>
      item.customer
        ? `${item.customer.first_name} ${item.customer.last_name}`
        : 'Sin cliente',
    badgeKey: 'status',
    badgeTransform: (v: string) => this.getStatusLabel(v),
    badgeConfig: { type: 'status', size: 'sm' },
    footerKey: 'grand_total',
    footerLabel: 'Total',
    footerStyle: 'prominent',
    footerTransform: (v: number) => this.currencyService.format(v || 0),
    detailKeys: [
      {
        key: 'valid_until',
        label: 'Válida hasta',
        transform: (v: string) =>
          v ? formatDateOnlyUTC(v) : '-',
      },
      {
        key: 'created_at',
        label: 'Fecha',
        transform: (v: string) => new Date(v).toLocaleDateString('es-CO'),
      },
    ],
  };

  actions: TableAction[] = [
    {
      label: 'Enviar',
      icon: 'send',
      variant: 'primary',
      action: (item: Quotation) => this.send.emit(item),
      show: (item: Quotation) => this.canMutateQuotation() && item.status === 'draft',
    },
    {
      label: 'Aceptar',
      icon: 'check-circle',
      variant: 'success',
      action: (item: Quotation) => this.accept.emit(item),
      show: (item: Quotation) => this.canMutateQuotation() && item.status === 'sent',
    },
    {
      label: 'Rechazar',
      icon: 'x-circle',
      variant: 'danger',
      action: (item: Quotation) => this.reject.emit(item),
      show: (item: Quotation) => this.canMutateQuotation() && item.status === 'sent',
    },
    {
      label: 'Convertir a Orden',
      icon: 'arrow-right-circle',
      variant: 'success',
      action: (item: Quotation) => this.convert.emit(item),
      tooltip: (item: Quotation) =>
        item.status === 'accepted'
          ? 'Convertir a orden'
          : 'Primero acepta la cotización para convertirla en orden',
      show: (item: Quotation) => this.canConvertToOrder() &&
        (item.destination === undefined || item.destination === 'sale') && item.status === 'accepted',
    },
    {
      label: 'Crear contrato',
      icon: 'file-text',
      variant: 'success',
      action: (item: Quotation) => this.createFromQuotation.emit(item),
      show: (item: Quotation) => this.canCreateFromQuotation() && item.destination === 'contract' && item.status === 'accepted',
    },
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'info',
      action: (item: Quotation) => this.edit.emit(item),
      show: (item: Quotation) => item.status === 'draft' &&
        (item.destination === 'contract' ? this.canUpdateContractQuotation() : this.canMutateQuotation()),
    },
    {
      label: 'Duplicar',
      icon: 'copy',
      variant: 'ghost',
      action: (item: Quotation) => this.duplicate.emit(item),
      show: () => this.canCreateQuotation(),
    },
    {
      label: 'Cancelar',
      icon: 'ban',
      variant: 'danger',
      action: (item: Quotation) => this.cancel.emit(item),
      show: (item: Quotation) => this.canMutateQuotation() && ['draft', 'sent', 'accepted'].includes(item.status),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: Quotation) => this.deleteQuotation.emit(item),
      show: (item: Quotation) => this.canDeleteQuotation() && item.status === 'draft',
    },
  ];

  private getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      sent: 'Enviada',
      accepted: 'Aceptada',
      rejected: 'Rechazada',
      expired: 'Expirada',
      converted: 'Convertida',
      contracted: 'Contratada',
      cancelled: 'Cancelada',
    };
    return labels[status] || status;
  }
}
