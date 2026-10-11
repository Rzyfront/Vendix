import { Component, DestroyRef, inject, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, of, switchMap } from 'rxjs';
import { ContractsService, ContractApiError } from './services/contracts.service';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import {
  Contract,
  CONTRACT_STATUS_LABELS,
} from './interfaces/contract.interface';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { SpinnerComponent } from '../../../../shared/components/spinner/spinner.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { AlertBannerComponent } from '../../../../shared/components/alert-banner/alert-banner.component';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import { PaginationComponent } from '../../../../shared/components/pagination/pagination.component';
import { InputsearchComponent } from '../../../../shared/components/inputsearch/inputsearch.component';
import { CurrencyPipe } from '../../../../shared/pipes/currency/currency.pipe';

@Component({
  selector: 'app-contracts',
  standalone: true,
  imports: [
    RouterLink,
    CardComponent,
    ButtonComponent,
    IconComponent,
    SpinnerComponent,
    EmptyStateComponent,
    AlertBannerComponent,
    StatsComponent,
    PaginationComponent,
    InputsearchComponent,
    CurrencyPipe,
  ],
  template: `
    <div class="w-full">
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Contratos"
          [value]="contracts().length"
          smallText="En esta página"
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
      </div>

      <app-card [responsive]="true" [padding]="false">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                 md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
            <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
              Contratos ({{ totalItems() }})
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                placeholder="Buscar por número o notas..."
                (searchChange)="onSearch($event)"
              />
              @if (canCreateContractQuotation()) {
                <app-button variant="primary" size="sm" (clicked)="startContractQuotation()">
                  Cotizar contrato
                </app-button>
              }
            </div>
            <label class="sr-only" for="contract-status-filter">Filtrar por estado</label>
            <select
              id="contract-status-filter"
              class="w-full md:w-44 rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary"
              [value]="statusFilter()"
              (change)="onStatusChange($event)"
            >
              <option value="">Todos los estados</option>
              <option value="draft">Borrador</option>
              <option value="active">Vigente</option>
              <option value="invoiced">Facturado</option>
              <option value="cancelled">Cancelado</option>
            </select>
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
            <div class="flex flex-col gap-2">
              @for (contract of contracts(); track contract.id) {
                <a
                  [routerLink]="['/admin/orders/contracts', contract.id]"
                  class="p-3 sm:p-4 bg-[var(--color-surface)] rounded-xl border border-border hover:border-gray-300 transition-colors block"
                  [attr.aria-label]="'Ver contrato ' + contract.contract_number"
                >
                  <div class="flex items-center gap-3">
                    <div class="flex-1 min-w-0">
                      <p class="text-sm sm:text-base font-semibold text-gray-900 truncate">
                        {{ contract.contract_number }}
                      </p>
                      @if (contract.contract_object) {
                        <p class="text-xs text-gray-500 truncate mt-0.5">{{ contract.contract_object }}</p>
                      }
                    </div>
                    <span class="text-[11px] font-semibold px-2 py-1 rounded-full bg-blue-100 text-blue-700 flex-shrink-0">
                      {{ statusLabel(contract) }}
                    </span>
                    @if (contract.grand_total !== null && contract.grand_total !== undefined) {
                      <span class="font-bold text-gray-900 text-sm sm:text-base font-mono flex-shrink-0">
                        {{ contract.grand_total | currency }}
                      </span>
                    }
                    <app-icon name="arrow-right" [size]="16" class="text-gray-300 flex-shrink-0"></app-icon>
                  </div>
                </a>
              }
            </div>
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
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly authFacade = inject(AuthFacade);
  private readonly queryRequests = new Subject<{ page: number; limit: number; search?: string; status?: string }>();

  readonly contracts = signal<Contract[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly search = signal('');
  readonly statusFilter = signal('');
  readonly page = signal(1);
  readonly limit = signal(10);
  readonly totalItems = signal(0);
  readonly totalPages = computed(() => Math.ceil(this.totalItems() / this.limit()));

  readonly activeCount = computed(() => this.contracts().filter((c) => c.status === 'active').length);
  readonly hasActiveFilters = computed(() => !!this.search().trim() || !!this.statusFilter());
  readonly canCreateContractQuotation = computed(() => {
    const permissions = this.authFacade.userPermissions();
    const roles = this.authFacade.userRoles();
    const isSuperAdmin = roles.includes('super_admin') || roles.includes('SUPER_ADMIN');
    return this.authFacade.storeIndustries().includes('construction') &&
      (isSuperAdmin || (permissions.includes('store:quotations:create') && permissions.includes('store:contracts:create')));
  });

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
    this.statusFilter.set((event.target as HTMLSelectElement).value);
    this.page.set(1);
    this.reload();
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
