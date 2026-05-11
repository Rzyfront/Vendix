import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  AlertBannerComponent,
  CardComponent,
  FilterConfig,
  FilterValues,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableAction,
  TableColumn,
} from '../../../../../../shared/components/index';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import { OrgFiscalScopeSelectorComponent } from '../../../shared/components/org-fiscal-scope-selector.component';
import {
  OrgInvoiceRow,
  OrgInvoiceSummary,
  OrgInvoicingService,
} from '../../services/org-invoicing.service';

interface PageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Component({
  selector: 'vendix-org-invoice-list',
  standalone: true,
  imports: [
    AlertBannerComponent,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
    OrgFiscalScopeSelectorComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-org-fiscal-scope-selector
        [selectedStoreId]="selectedStoreId()"
        [showHeader]="false"
        (storeChange)="onFiscalStoreChange($event)"
      />

      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Facturas"
          [value]="summary()?.invoice_count || 0"
          smallText="Documentos fiscales"
          iconName="receipt"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading()"
        />
        <app-stats
          title="Facturado"
          [value]="formatMoney(summary()?.total_amount)"
          smallText="Total del alcance"
          iconName="dollar-sign"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading()"
        />
        <app-stats
          title="IVA"
          [value]="formatMoney(summary()?.tax_amount)"
          smallText="Impuesto generado"
          iconName="percent"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading()"
        />
        <app-stats
          title="Retenciones"
          [value]="formatMoney(summary()?.withholding_amount)"
          smallText="Retenciones aplicadas"
          iconName="landmark"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading()"
        />
      </div>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudo cargar facturación">
          {{ msg }}
        </app-alert-banner>
      }

      <app-card [responsive]="true" [padding]="false">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
            <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
              Facturas fiscales ({{ meta().total }})
            </h2>

            <div class="flex w-full items-center gap-2 md:w-auto">
              <app-inputsearch
                class="flex-1 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:w-72 md:shadow-none"
                size="sm"
                placeholder="Buscar número, cliente o NIT..."
                [debounceTime]="300"
                (search)="onSearch($event)"
              />

              <app-options-dropdown
                class="rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none"
                [filters]="filterConfigs"
                [filterValues]="filterValues()"
                [actions]="dropdownActions"
                [isLoading]="loading()"
                triggerLabel="Filtros"
                triggerIcon="filter"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="clearFilters()"
                (actionClick)="onActionClick($event)"
              />
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="invoices()"
            [columns]="tableColumns"
            [actions]="tableActions"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            [sortable]="true"
            emptyTitle="Sin facturas"
            emptyMessage="Sin facturas"
            emptyDescription="No hay facturas para el alcance fiscal seleccionado."
            emptyIcon="receipt"
            [showEmptyAction]="false"
            [showEmptyClearFilters]="hasActiveFilters()"
            (rowClick)="selectInvoice($event)"
            (emptyClearFiltersClick)="clearFilters()"
          />

          @if (meta().totalPages > 1) {
            <div class="mt-4 flex justify-center border-t border-border pt-3">
              <app-pagination
                [currentPage]="meta().page"
                [totalPages]="meta().totalPages"
                [total]="meta().total"
                [limit]="meta().limit"
                infoStyle="none"
                (pageChange)="changePage($event)"
              />
            </div>
          }
        </div>
      </app-card>

      @if (selectedInvoice(); as invoice) {
        <app-card customClasses="mt-3">
          <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 class="text-base font-semibold text-text-primary">
                {{ invoice.invoice_number }}
              </h3>
              <p class="text-sm text-text-secondary">
                {{ invoice.customer_name || 'Sin cliente' }}
                @if (invoice.customer_tax_id) {
                  · NIT {{ invoice.customer_tax_id }}
                }
              </p>
            </div>
            <div class="text-left md:text-right">
              <p class="text-xs text-text-secondary">Total</p>
              <p class="text-lg font-semibold text-text-primary">
                {{ formatMoney(invoice.total_amount) }}
              </p>
            </div>
          </div>
          <dl class="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
            <div>
              <dt class="text-text-secondary">Fecha</dt>
              <dd class="font-medium text-text-primary">{{ formatDate(invoice.issue_date) }}</dd>
            </div>
            <div>
              <dt class="text-text-secondary">Tienda</dt>
              <dd class="font-medium text-text-primary">{{ invoice.store?.name || 'Organización' }}</dd>
            </div>
            <div>
              <dt class="text-text-secondary">Tipo</dt>
              <dd class="font-medium text-text-primary">{{ invoiceTypeLabel(invoice.invoice_type) }}</dd>
            </div>
            <div>
              <dt class="text-text-secondary">Resolución</dt>
              <dd class="font-medium text-text-primary">
                {{ invoice.resolution?.prefix || '—' }} {{ invoice.resolution?.resolution_number || '' }}
              </dd>
            </div>
          </dl>
        </app-card>
      }
    </div>
  `,
})
export class OrgInvoiceListComponent {
  private readonly service = inject(OrgInvoicingService);
  private readonly auth = inject(AuthFacade);
  private readonly errors = inject(ApiErrorService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currency = inject(CurrencyFormatService);

  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly selectedStoreId = signal<number | null>(null);
  readonly searchTerm = signal('');
  readonly filterValues = signal<FilterValues>({});
  readonly page = signal(1);
  readonly limit = signal(25);
  readonly summary = signal<OrgInvoiceSummary | null>(null);
  readonly invoices = signal<OrgInvoiceRow[]>([]);
  readonly selectedInvoice = signal<OrgInvoiceRow | null>(null);
  readonly meta = signal<PageMeta>({ total: 0, page: 1, limit: 25, totalPages: 1 });

  readonly requiresStoreSelector = computed(() => this.auth.fiscalScope() === 'STORE');

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'draft', label: 'Borrador' },
        { value: 'validated', label: 'Validada' },
        { value: 'sent', label: 'Enviada' },
        { value: 'accepted', label: 'Aceptada' },
        { value: 'rejected', label: 'Rechazada' },
        { value: 'cancelled', label: 'Cancelada' },
        { value: 'voided', label: 'Anulada' },
      ],
    },
    {
      key: 'invoice_type',
      label: 'Tipo',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'sales_invoice', label: 'Venta' },
        { value: 'purchase_invoice', label: 'Compra' },
        { value: 'credit_note', label: 'Nota crédito' },
        { value: 'debit_note', label: 'Nota débito' },
        { value: 'export_invoice', label: 'Exportación' },
      ],
    },
  ];

  readonly dropdownActions = [
    { label: 'Resoluciones', icon: 'hash', action: 'resolutions', variant: 'outline' as const },
    { label: 'Configurar DIAN', icon: 'settings', action: 'dian-config', variant: 'outline' as const },
  ];

  readonly tableActions: TableAction[] = [
    {
      label: 'Ver detalle',
      icon: 'eye',
      variant: 'primary',
      action: (row: OrgInvoiceRow) => this.selectInvoice(row),
    },
  ];

  readonly tableColumns: TableColumn[] = [
    { key: 'invoice_number', label: 'Número', sortable: true, priority: 1 },
    {
      key: 'invoice_type',
      label: 'Tipo',
      priority: 2,
      transform: (value) => this.invoiceTypeLabel(String(value || '')),
    },
    {
      key: 'customer_name',
      label: 'Cliente',
      priority: 1,
      defaultValue: 'Sin cliente',
    },
    {
      key: 'store.name',
      label: 'Tienda',
      priority: 3,
      defaultValue: 'Organización',
    },
    {
      key: 'issue_date',
      label: 'Fecha',
      align: 'center',
      priority: 2,
      transform: (value) => this.formatDate(value),
    },
    {
      key: 'total_amount',
      label: 'Total',
      align: 'right',
      sortable: true,
      priority: 1,
      transform: (value) => this.formatMoney(value),
    },
    {
      key: 'status',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: {
          draft: 'default',
          validated: 'info',
          sent: 'info',
          accepted: 'success',
          rejected: 'danger',
          cancelled: 'warn',
          voided: 'default',
        },
      },
      transform: (value) => this.statusLabel(String(value || '')),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'invoice_number',
    subtitleTransform: (item) => item?.customer_name || 'Sin cliente',
    avatarFallbackIcon: 'receipt',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: {
      type: 'status',
      colorMap: {
        draft: 'default',
        validated: 'info',
        sent: 'info',
        accepted: 'success',
        rejected: 'danger',
        cancelled: 'warn',
        voided: 'default',
      },
    },
    badgeTransform: (value) => this.statusLabel(String(value || '')),
    footerKey: 'total_amount',
    footerLabel: 'Total',
    footerStyle: 'prominent',
    footerTransform: (value) => this.formatMoney(value),
    detailKeys: [
      { key: 'issue_date', label: 'Fecha', icon: 'calendar', transform: (value) => this.formatDate(value) },
      { key: 'store.name', label: 'Tienda', icon: 'store', transform: (value) => value || 'Organización' },
      { key: 'invoice_type', label: 'Tipo', icon: 'file-text', transform: (value) => this.invoiceTypeLabel(String(value || '')) },
    ],
  };

  constructor() {
    this.currency.loadCurrency();
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const storeId = params.get('store_id');
        const page = Number(params.get('page') || 1);
        const status = params.get('status') || '';
        const invoiceType = params.get('invoice_type') || '';
        const search = params.get('search') || '';

        this.selectedStoreId.set(storeId ? Number(storeId) : null);
        this.page.set(Number.isFinite(page) && page > 0 ? page : 1);
        this.searchTerm.set(search);
        this.filterValues.set({
          ...(status ? { status } : {}),
          ...(invoiceType ? { invoice_type: invoiceType } : {}),
        });
        this.loadData();
      });
  }

  onFiscalStoreChange(storeId: number | null): void {
    if (storeId === this.selectedStoreId()) return;
    this.updateQuery({ store_id: storeId || null, page: 1 });
  }

  onSearch(search: string): void {
    this.searchTerm.set(search);
    this.updateQuery({ search: search || null, page: 1 });
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set({ ...values });
    this.updateQuery({
      status: (values['status'] as string) || null,
      invoice_type: (values['invoice_type'] as string) || null,
      page: 1,
    });
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.filterValues.set({});
    this.updateQuery({ search: null, status: null, invoice_type: null, page: 1 });
  }

  changePage(page: number): void {
    this.updateQuery({ page });
  }

  onActionClick(action: string): void {
    this.router.navigate([`../${action}`], {
      relativeTo: this.route,
      queryParamsHandling: 'preserve',
    });
  }

  selectInvoice(invoice: OrgInvoiceRow): void {
    this.selectedInvoice.set(invoice);
  }

  hasActiveFilters(): boolean {
    return !!(
      this.searchTerm() ||
      this.filterValues()['status'] ||
      this.filterValues()['invoice_type']
    );
  }

  formatMoney(value: string | number | null | undefined): string {
    return this.currency.format(Number(value || 0));
  }

  formatDate(value: string | null | undefined): string {
    return value ? formatDateOnlyUTC(value) : '-';
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      validated: 'Validada',
      sent: 'Enviada',
      accepted: 'Aceptada',
      rejected: 'Rechazada',
      cancelled: 'Cancelada',
      voided: 'Anulada',
    };
    return labels[status] || status || '-';
  }

  invoiceTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      sales_invoice: 'Venta',
      purchase_invoice: 'Compra',
      credit_note: 'Nota crédito',
      debit_note: 'Nota débito',
      export_invoice: 'Exportación',
    };
    return labels[type] || type || '-';
  }

  private loadData(): void {
    if (this.requiresStoreSelector() && !this.selectedStoreId()) {
      this.loading.set(false);
      this.summary.set(null);
      this.invoices.set([]);
      this.meta.set({ total: 0, page: 1, limit: this.limit(), totalPages: 1 });
      return;
    }

    const query = this.buildQuery();
    this.loading.set(true);
    this.errorMessage.set(null);

    forkJoin({
      summary: this.service.getSummary(query),
      invoices: this.service.getInvoices(query),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ summary, invoices }) => {
          this.summary.set(summary.data ?? null);
          this.invoices.set(invoices.data ?? []);
          this.meta.set(this.normalizeMeta(invoices.meta));
          this.loading.set(false);
        },
        error: (err) => {
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudo cargar la información de facturación.'),
          );
          this.invoices.set([]);
          this.loading.set(false);
        },
      });
  }

  private buildQuery(): Record<string, string | number> {
    return {
      page: this.page(),
      limit: this.limit(),
      ...(this.selectedStoreId() ? { store_id: this.selectedStoreId()! } : {}),
      ...(this.searchTerm() ? { search: this.searchTerm() } : {}),
      ...(this.filterValues()['status'] ? { status: this.filterValues()['status'] as string } : {}),
      ...(this.filterValues()['invoice_type'] ? { invoice_type: this.filterValues()['invoice_type'] as string } : {}),
    };
  }

  private normalizeMeta(meta?: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
    total_pages?: number;
  }): PageMeta {
    const total = Number(meta?.total || 0);
    const limit = Number(meta?.limit || this.limit());
    const page = Number(meta?.page || this.page());
    const totalPages = Number(meta?.totalPages || meta?.total_pages || Math.max(1, Math.ceil(total / limit)));
    return { total, page, limit, totalPages };
  }

  private updateQuery(queryParams: Record<string, string | number | null>): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
