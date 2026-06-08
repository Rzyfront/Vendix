import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { map } from 'rxjs';

import {
  AlertBannerComponent,
  CardComponent,
  InputsearchComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableColumn,
} from '../../../../../../shared/components/index';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';
import { IcaRate, IcaResolvedRate, OrgIcaService } from './services/org-ica.service';

/**
 * Organization-scoped ICA view.
 *
 * Mirrors the store ICA UX (stats + resolved-rate banner + municipal rates
 * table) but reads the shell-synced `?store_id` from the URL and fetches via
 * the org service so rates resolve per store or operate consolidated.
 */
@Component({
  selector: 'vendix-org-ica',
  standalone: true,
  imports: [
    AlertBannerComponent,
    CardComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Tarifa Resuelta"
          [value]="resolvedRate()?.rate_per_mil ? resolvedRate()!.rate_per_mil + '‰' : 'N/A'"
          smallText="Tarifa del alcance fiscal"
          iconName="percent"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading()"
        />
        <app-stats
          title="Municipio"
          [value]="resolvedRate()?.municipality_name || 'No configurado'"
          smallText="Municipio resuelto"
          iconName="map-pin"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading()"
        />
        <app-stats
          title="Tarifas Disponibles"
          [value]="rates().length"
          smallText="Municipios cargados"
          iconName="list"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading()"
        />
        <app-stats
          title="Departamentos"
          [value]="departmentsCount()"
          smallText="Cubiertos por las tarifas"
          iconName="globe"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading()"
        />
      </div>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudieron cargar las tarifas ICA">
          {{ msg }}
        </app-alert-banner>
      }

      @if (resolvedRate(); as rate) {
        <app-alert-banner variant="info" title="Tarifa ICA del alcance fiscal" class="mt-3 block">
          Municipio: <strong>{{ rate.municipality_name }}</strong>
          | Código: {{ rate.municipality_code }}
          | Tarifa: <strong>{{ rate.rate_per_mil }}‰</strong>
        </app-alert-banner>
      }

      <app-card [responsive]="true" [padding]="false" class="mt-3 block">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
            <div>
              <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
                Tarifas ICA por Municipio ({{ filteredRates().length }})
              </h2>
              <p class="hidden text-sm text-text-secondary md:block">
                Tarifas ICA municipales aplicables al alcance fiscal seleccionado.
              </p>
            </div>

            <div class="flex w-full items-center gap-2 md:w-auto">
              <app-inputsearch
                class="flex-1 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:w-72 md:shadow-none"
                size="sm"
                placeholder="Buscar municipio o CIIU..."
                [debounceTime]="300"
                (search)="onSearch($event)"
              />
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="filteredRates()"
            [columns]="tableColumns"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            [sortable]="true"
            emptyTitle="Sin tarifas"
            emptyMessage="Sin tarifas"
            emptyDescription="No hay tarifas ICA disponibles para el alcance fiscal seleccionado."
            emptyIcon="percent"
            [showEmptyAction]="false"
          />
        </div>
      </app-card>
    </div>
  `,
})
export class OrgIcaComponent {
  private readonly service = inject(OrgIcaService);
  private readonly errors = inject(ApiErrorService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  private readonly storeId = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('store_id'))),
    { initialValue: this.route.snapshot.queryParamMap.get('store_id') },
  );

  readonly loading = signal(true);
  readonly rates = signal<IcaRate[]>([]);
  readonly resolvedRate = signal<IcaResolvedRate | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly searchTerm = signal('');

  readonly departmentsCount = computed(
    () => new Set(this.rates().map((rate) => rate.department_name).filter(Boolean)).size,
  );

  readonly filteredRates = computed(() => {
    const search = this.searchTerm().trim().toLowerCase();
    if (!search) return this.rates();
    return this.rates().filter((rate) =>
      [rate.municipality_name, rate.municipality_code, rate.department_name, rate.ciiu_code]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search)),
    );
  });

  readonly tableColumns: TableColumn[] = [
    {
      key: 'municipality_name',
      label: 'Municipio',
      sortable: true,
      priority: 1,
      transform: (value, row) => `${value} (${row?.municipality_code ?? '—'})`,
    },
    { key: 'department_name', label: 'Departamento', priority: 3, defaultValue: '—' },
    {
      key: 'ciiu_code',
      label: 'CIIU',
      priority: 2,
      transform: (value) => (value ? String(value) : 'General'),
    },
    {
      key: 'rate_per_mil',
      label: 'Tarifa ‰',
      align: 'right',
      sortable: true,
      priority: 1,
      transform: (value) => `${value}‰`,
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'municipality_name',
    subtitleKey: 'municipality_code',
    avatarFallbackIcon: 'map-pin',
    avatarShape: 'square',
    detailKeys: [
      { key: 'department_name', label: 'Departamento', icon: 'globe', transform: (value) => String(value || '—') },
      { key: 'ciiu_code', label: 'CIIU', icon: 'hash', transform: (value) => (value ? String(value) : 'General') },
      { key: 'rate_per_mil', label: 'Tarifa', icon: 'percent', transform: (value) => `${value}‰` },
    ],
  };

  constructor() {
    this.route.queryParamMap
      .pipe(
        switchMap((params) => {
          this.loading.set(true);
          this.errorMessage.set(null);
          const storeId = params.get('store_id');
          this.resolveRate(storeId);
          return this.service.getRates({ limit: 50, ...(storeId ? { store_id: storeId } : {}) });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          this.rates.set(res?.data ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudieron cargar las tarifas ICA.'),
          );
          this.rates.set([]);
          this.loading.set(false);
        },
      });
  }

  private resolveRate(storeId: string | null): void {
    this.service
      .resolveRate(storeId ? { store_id: storeId } : undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.resolvedRate.set(res?.data ?? null),
        error: () => this.resolvedRate.set(null),
      });
  }

  onSearch(search: string): void {
    this.searchTerm.set(search);
  }
}
