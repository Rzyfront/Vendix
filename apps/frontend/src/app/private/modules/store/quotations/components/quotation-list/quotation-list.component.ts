import { Component, input, output, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
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
} from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { Quotation } from '../../interfaces/quotation.interface';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';

@Component({
  selector: 'app-quotation-list',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    IconComponent,
    ButtonComponent,
  ],
  template: `
    <app-card [responsive]="true" [padding]="false">
      <!-- Search Section (inside card) -->
      <div
        class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
               md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
      >
        <div
          class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
        >
          <h2
            class="text-[13px] font-bold text-gray-600 tracking-wide
                   md:text-lg md:font-semibold md:text-text-primary"
          >
            Cotizaciones ({{ quotations().length }})
          </h2>

          <div class="flex items-center gap-2 w-full md:w-auto">
            <app-inputsearch
              class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              placeholder="Buscar cotización..."
              [debounceTime]="300"
              (searchChange)="search.emit($event)"
            />

            <app-button
              variant="outline"
              size="md"
              customClasses="w-10 sm:w-11 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
              (clicked)="create.emit()"
              title="Nueva Cotización"
            >
              <app-icon slot="icon" name="plus" [size]="18"></app-icon>
            </app-button>

            <app-options-dropdown
              class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              [filters]="filterOptions"
              (filterChange)="filterChange.emit($event)"
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
      @if (!loading()) {
        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="quotations()"
            [columns]="columns"
            [cardConfig]="cardConfig"
            [actions]="actions"
            [loading]="loading()"
            emptyMessage="No se encontraron cotizaciones"
            emptyIcon="file-text"
            (rowClick)="viewDetail.emit($event)"
          ></app-responsive-data-view>
        </div>
      }
    </app-card>
  `,
})
export class QuotationListComponent {
  private currencyService = inject(CurrencyFormatService);

  quotations = input.required<Quotation[]>();
  loading = input<boolean>(false);

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
  search = output<string>();
  filterChange = output<FilterValues>();

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
        { label: 'Cancelada', value: 'cancelled' },
      ],
    },
  ];

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
      badgeConfig: {
        type: 'custom',
        colorMap: {
          draft: '#94a3b8',
          sent: '#3b82f6',
          accepted: '#10b981',
          rejected: '#ef4444',
          expired: '#f59e0b',
          converted: '#8b5cf6',
          cancelled: '#6b7280',
        },
      },
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
      show: (item: Quotation) => item.status === 'draft',
    },
    {
      label: 'Aceptar',
      icon: 'check-circle',
      variant: 'success',
      action: (item: Quotation) => this.accept.emit(item),
      show: (item: Quotation) => item.status === 'sent',
    },
    {
      label: 'Rechazar',
      icon: 'x-circle',
      variant: 'danger',
      action: (item: Quotation) => this.reject.emit(item),
      show: (item: Quotation) => item.status === 'sent',
    },
    {
      label: 'Convertir a Orden',
      icon: 'arrow-right-circle',
      variant: 'success',
      action: (item: Quotation) => this.convert.emit(item),
      show: (item: Quotation) =>
        ['draft', 'sent', 'accepted'].includes(item.status),
    },
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'info',
      action: (item: Quotation) => this.edit.emit(item),
      show: (item: Quotation) => item.status === 'draft',
    },
    {
      label: 'Duplicar',
      icon: 'copy',
      variant: 'ghost',
      action: (item: Quotation) => this.duplicate.emit(item),
    },
    {
      label: 'Cancelar',
      icon: 'ban',
      variant: 'danger',
      action: (item: Quotation) => this.cancel.emit(item),
      show: (item: Quotation) =>
        ['draft', 'sent', 'accepted'].includes(item.status),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: Quotation) => this.deleteQuotation.emit(item),
      show: (item: Quotation) => item.status === 'draft',
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
      cancelled: 'Cancelada',
    };
    return labels[status] || status;
  }
}
