import { Component, DestroyRef, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, of, switchMap } from 'rxjs';
import { ContractsService, ContractApiError } from './services/contracts.service';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { Contract, CONTRACT_STATUS_LABELS } from './interfaces/contract.interface';
import { AlertBannerComponent } from '../../../../shared/components/alert-banner/alert-banner.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { InputsearchComponent } from '../../../../shared/components/inputsearch/inputsearch.component';
import { OptionsDropdownComponent } from '../../../../shared/components/options-dropdown/options-dropdown.component';
import { PaginationComponent } from '../../../../shared/components/pagination/pagination.component';
import { ResponsiveDataViewComponent } from '../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { SpinnerComponent } from '../../../../shared/components/spinner/spinner.component';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import type { ItemListCardConfig } from '../../../../shared/components/item-list/item-list.interfaces';
import type { DropdownAction, FilterConfig, FilterValues } from '../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import type { TableAction, TableColumn } from '../../../../shared/components/table/table.component';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';

@Component({
  selector: 'app-contracts',
  standalone: true,
  imports: [
    FormsModule,
    CardComponent,
    ButtonComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    EmptyStateComponent,
    AlertBannerComponent,
    SpinnerComponent,
    StatsComponent,
    PaginationComponent,
    InputsearchComponent,
  ],
  template: `
    <div class="w-full">
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total de contratos"
          [value]="totalItems()"
          smallText="Total global"
          iconName="file-text"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading()"
        ></app-stats>
        <app-stats
          title="Vigentes"
          [value]="activeCount()"
          smallText="En esta página"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading()"
        ></app-stats>
        <app-stats
          title="Borradores"
          [value]="draftCount()"
          smallText="En esta página"
          iconName="file-text"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading()"
        ></app-stats>
        <app-stats
          title="Facturados"
          [value]="invoicedCount()"
          smallText="En esta página"
          iconName="receipt"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading()"
        ></app-stats>
      </div>

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
            <h2 class="text-[13px] font-bold text-text-secondary tracking-wide md:text-lg md:font-semibold md:text-text-primary">
              Contratos ({{ totalItems() }})
            </h2>
            <div class="flex flex-wrap items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar contratos..."
                ariaLabel="Buscar contratos por número, objeto o notas"
                [ngModel]="search()"
                (searchChange)="onSearch($event)"
              />
              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [actions]="dropdownActions()"
                [filters]="filterConfigs"
                [filterValues]="filterValues()"
                [isLoading]="loading()"
                triggerIcon="more-horizontal"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="clearFilters()"
                (actionClick)="onActionClick($event)"
              />
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          @if (loading()) {
            <div class="flex items-center justify-center py-20">
              <app-spinner size="lg"></app-spinner>
            </div>
          } @else if (loadError()) {
            <app-alert-banner variant="danger" heading="No se pudieron cargar los contratos">
              {{ loadError() }}
              <div bannerActions class="mt-2">
                <app-button variant="outline" size="sm" (clicked)="reload()">Reintentar</app-button>
              </div>
            </app-alert-banner>
          } @else if (contracts().length === 0 && hasActiveFilters()) {
            <app-empty-state
              icon="search"
              title="Sin resultados"
              description="No hay contratos que coincidan con la búsqueda o el estado seleccionado."
              [showActionButton]="false"
            ></app-empty-state>
          } @else if (contracts().length === 0) {
            <app-empty-state
              icon="file-text"
              title="Sin contratos"
              description="Aún no hay contratos de obra. Se crean al aceptar una cotización con destino contrato."
              [showActionButton]="canCreateContractQuotation()"
              actionButtonText="Cotizar contrato"
              (actionClick)="startContractQuotation()"
            ></app-empty-state>
          } @else {
            <app-responsive-data-view
              [data]="contracts()"
              [columns]="columns"
              [actions]="rowActions"
              [cardConfig]="cardConfig"
              [loading]="loading()"
              [sortable]="false"
              rowLabelKey="contract_number"
              emptyTitle="Sin contratos"
              emptyDescription="Aún no hay contratos de obra. Se crean al aceptar una cotización con destino contrato."
              (rowClick)="openContract($event)"
            ></app-responsive-data-view>
          }
          <app-pagination
            [currentPage]="page()"
            [totalPages]="totalPages()"
            [total]="totalItems()"
            [limit]="limit()"
            infoStyle="range"
            (pageChange)="onPageChange($event)"
          ></app-pagination>
        </div>
      </app-card>
    </div>
  `,
  styles: [],
})
export class ContractsComponent {
  private readonly contractsService = inject(ContractsService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly authFacade = inject(AuthFacade);
  private readonly queryRequests = new Subject<{ page: number; limit: number; search?: string; status?: string }>();

  readonly contracts = signal<Contract[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly search = signal('');
  readonly statusFilter = signal('');
  readonly filterValues = signal<FilterValues>({ status: null });
  readonly page = signal(1);
  readonly limit = signal(10);
  readonly totalItems = signal(0);
  readonly totalPages = computed(() => Math.ceil(this.totalItems() / this.limit()));

  readonly activeCount = computed(() => this.contracts().filter((c) => c.status === 'active').length);
  readonly draftCount = computed(() => this.contracts().filter((c) => c.status === 'draft').length);
  readonly invoicedCount = computed(() => this.contracts().filter((c) => c.status === 'invoiced').length);
  readonly hasActiveFilters = computed(() => !!this.search().trim() || !!this.statusFilter());
  readonly canCreateContractQuotation = computed(() => {
    const permissions = this.authFacade.userPermissions();
    const roles = this.authFacade.userRoles();
    const isSuperAdmin = roles.includes('super_admin') || roles.includes('SUPER_ADMIN');
    return this.authFacade.storeIndustries().includes('construction') &&
      (isSuperAdmin || (permissions.includes('store:quotations:create') && permissions.includes('store:contracts:create')));
  });

  readonly filterConfigs: FilterConfig[] = [{
    key: 'status',
    label: 'Estado',
    type: 'select',
    options: [
      { value: '', label: 'Todos los estados' },
      { value: 'draft', label: 'Borrador' },
      { value: 'active', label: 'Vigente' },
      { value: 'invoiced', label: 'Facturado' },
      { value: 'cancelled', label: 'Cancelado' },
    ],
  }];

  readonly dropdownActions = computed<DropdownAction[]>(() => this.canCreateContractQuotation() ? [{
    label: 'Cotizar contrato',
    icon: 'file-text',
    action: 'contract-quotation',
    variant: 'primary',
  }] : []);

  readonly columns: TableColumn[] = [
    { key: 'contract_number', label: 'Contrato', priority: 0 },
    {
      key: 'contract_object', label: 'Objeto', priority: 2, defaultValue: 'No configurado',
      transform: (value: string | null | undefined) => value || 'No configurado',
    },
    {
      key: 'status', label: 'Estado', priority: 1, badge: true,
      badgeConfig: { type: 'status', size: 'sm' },
      badgeTransform: (value: Contract['status']) => CONTRACT_STATUS_LABELS[value] || value,
      transform: (value: Contract['status']) => CONTRACT_STATUS_LABELS[value] || value,
    },
    {
      key: 'grand_total', label: 'Total congelado', align: 'right', priority: 1, defaultValue: 'No configurado',
      transform: (value: number | null | undefined) => this.formatMoney(value),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'contract_number',
    subtitleKey: 'contract_object',
    badgeKey: 'status',
    badgeConfig: { type: 'status' as const, size: 'sm' as const },
    badgeTransform: (value: Contract['status']) => CONTRACT_STATUS_LABELS[value] || value,
    detailKeys: [
      { key: 'quotation_id', label: 'Cotización origen', transform: (value: number | null | undefined) => value == null ? 'No configurado' : `#${value}` },
    ],
    footerKey: 'grand_total',
    footerLabel: 'Total congelado',
    footerTransform: (value: number | null | undefined) => this.formatMoney(value),
  };

  readonly rowActions: TableAction[] = [{
    label: 'Ver contrato',
    icon: 'eye',
    variant: 'primary',
    action: (contract: Contract) => this.openContract(contract),
  }];

  constructor() {
    this.queryRequests.pipe(
      switchMap((query) => this.contractsService.getContracts(query).pipe(
        catchError((error: ContractApiError | Error) => of({ requestError: error })),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((result) => {
      this.loading.set(false);
      if ('requestError' in result) {
        this.contracts.set([]);
        this.totalItems.set(0);
        this.loadError.set(result.requestError?.message ?? 'Error al cargar los contratos');
        return;
      }
      this.contracts.set(result.data ?? []);
      this.totalItems.set(result.pagination?.total ?? 0);
      this.page.set(result.pagination?.page ?? this.page());
    });
    this.reload();
  }

  statusLabel(contract: Contract): string {
    return CONTRACT_STATUS_LABELS[contract.status] || contract.status;
  }

  onSearch(term: string): void {
    this.search.set(term ?? '');
    this.page.set(1);
    this.reload();
  }

  onStatusChange(event: Event): void {
    const status = (event.target as HTMLSelectElement).value;
    this.statusFilter.set(status);
    this.filterValues.set({ status: status || null });
    this.page.set(1);
    this.reload();
  }

  onFilterChange(values: FilterValues): void {
    const status = typeof values['status'] === 'string' ? values['status'] : '';
    this.statusFilter.set(status);
    this.filterValues.set({ status: status || null });
    this.page.set(1);
    this.reload();
  }

  clearFilters(): void {
    this.search.set('');
    this.statusFilter.set('');
    this.filterValues.set({ status: null });
    this.page.set(1);
    this.reload();
  }

  onActionClick(action: string): void {
    if (action === 'contract-quotation') this.startContractQuotation();
  }

  openContract(contract: Contract): void {
    void this.router.navigate(['/admin/orders/contracts', contract.id]);
  }

  formatMoney(value: number | null | undefined): string {
    return value === null || value === undefined ? 'No configurado' : this.currencyService.format(value);
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.reload();
  }

  startContractQuotation(): void {
    if (!this.canCreateContractQuotation()) return;
    void this.router.navigate(['/admin/orders/quotations'], { queryParams: { destination: 'contract' } });
  }

  reload(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.queryRequests.next({
      page: this.page(),
      limit: this.limit(),
      ...(this.search().trim() && { search: this.search().trim() }),
      ...(this.statusFilter() && { status: this.statusFilter() }),
    });
  }
}
