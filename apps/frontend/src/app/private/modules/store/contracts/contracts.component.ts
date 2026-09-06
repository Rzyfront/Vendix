import { Component, DestroyRef, inject, signal, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { ContractsService, ContractApiError } from './services/contracts.service';
import {
  Contract,
  CONTRACT_STATUS_LABELS,
} from './interfaces/contract.interface';
import {
  CardComponent,
  ButtonComponent,
  IconComponent,
  SpinnerComponent,
  EmptyStateComponent,
  AlertBannerComponent,
  StatsComponent,
} from '../../../../shared/components';
import { InputsearchComponent } from '../../../../shared/components/inputsearch/inputsearch.component';
import { CurrencyPipe } from '../../../../shared/pipes';

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
    InputsearchComponent,
    CurrencyPipe,
  ],
  template: `
    <div class="w-full">
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Contratos"
          [value]="contracts().length"
          smallText="Contratos de obra"
          iconName="file-text"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading()"
        ></app-stats>
        <app-stats
          title="Vigentes"
          [value]="activeCount()"
          smallText="En ejecución"
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
              Contratos ({{ filteredContracts().length }})
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                placeholder="Buscar por número u objeto..."
                (searchChange)="onSearch($event)"
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
          } @else if (filteredContracts().length === 0) {
            <app-empty-state
              icon="file-text"
              title="Sin contratos"
              description="Aún no hay contratos de obra. Se crean al aceptar una cotización con destino contrato."
              [showActionButton]="false"
            ></app-empty-state>
          } @else {
            <div class="flex flex-col gap-2">
              @for (contract of filteredContracts(); track contract.id) {
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
                    <span class="font-bold text-gray-900 text-sm sm:text-base font-mono flex-shrink-0">
                      {{ contract.grand_total || 0 | currency }}
                    </span>
                    <app-icon name="arrow-right" [size]="16" class="text-gray-300 flex-shrink-0"></app-icon>
                  </div>
                </a>
              }
            </div>
          }
        </div>
      </app-card>
    </div>
  `,
  styles: [],
})
export class ContractsComponent {
  private readonly contractsService = inject(ContractsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly contracts = signal<Contract[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly search = signal('');

  readonly activeCount = computed(() => this.contracts().filter((c) => c.status === 'active').length);

  readonly filteredContracts = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) return this.contracts();
    return this.contracts().filter(
      (c) =>
        c.contract_number.toLowerCase().includes(term) ||
        (c.contract_object ?? '').toLowerCase().includes(term),
    );
  });

  constructor() {
    this.reload();
  }

  statusLabel(contract: Contract): string {
    return CONTRACT_STATUS_LABELS[contract.status] || contract.status;
  }

  onSearch(term: string): void {
    this.search.set(term ?? '');
  }

  reload(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.contractsService
      .getContracts({ limit: 50 })
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => this.contracts.set(res?.data ?? []),
        error: (err: ContractApiError | Error) => this.loadError.set(err?.message ?? 'Error al cargar los contratos'),
      });
  }
}
