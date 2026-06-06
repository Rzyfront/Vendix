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
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  WithholdingConcept,
  WithholdingStats,
} from '../../../../store/withholding-tax/interfaces/withholding.interface';
import { OrgWithholdingTaxService } from './services/org-withholding-tax.service';

/**
 * Organization-scoped withholding-tax view.
 *
 * Mirrors the store withholding-tax UX (stats + concepts table) but reads the
 * shell-synced `?store_id` from the URL and fetches through the org service so
 * the org accounting module reaches consolidated or per-store data.
 */
@Component({
  selector: 'vendix-org-withholding-tax',
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
          title="Conceptos Activos"
          [value]="stats()?.active_concepts ?? activeConceptsCount()"
          smallText="Conceptos de retención"
          iconName="file-text"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading()"
        />
        <app-stats
          title="UVT Vigente"
          [value]="formatCurrency(stats()?.current_uvt || 0)"
          smallText="Valor unidad tributaria"
          iconName="calculator"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading()"
        />
        <app-stats
          title="Ret. del Mes"
          [value]="formatCurrency(stats()?.month_withholdings || 0)"
          smallText="Practicadas este mes"
          iconName="trending-down"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading()"
        />
        <app-stats
          title="Ret. del Año"
          [value]="formatCurrency(stats()?.year_withholdings || 0)"
          smallText="Acumulado anual"
          iconName="calendar"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading()"
        />
      </div>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudo cargar la retención en la fuente">
          {{ msg }}
        </app-alert-banner>
      }

      <app-card [responsive]="true" [padding]="false">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
            <div>
              <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
                Conceptos de Retención ({{ filteredConcepts().length }})
              </h2>
              <p class="hidden text-sm text-text-secondary md:block">
                Conceptos de retención en la fuente del alcance fiscal seleccionado.
              </p>
            </div>

            <div class="flex w-full items-center gap-2 md:w-auto">
              <app-inputsearch
                class="flex-1 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:w-72 md:shadow-none"
                size="sm"
                placeholder="Buscar código o nombre..."
                [debounceTime]="300"
                (search)="onSearch($event)"
              />
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="filteredConcepts()"
            [columns]="tableColumns"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            [sortable]="true"
            emptyTitle="Sin conceptos"
            emptyMessage="Sin conceptos"
            emptyDescription="No hay conceptos de retención para el alcance fiscal seleccionado."
            emptyIcon="file-text"
            [showEmptyAction]="false"
          />
        </div>
      </app-card>
    </div>
  `,
})
export class OrgWithholdingTaxComponent {
  private readonly service = inject(OrgWithholdingTaxService);
  private readonly errors = inject(ApiErrorService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  private readonly storeId = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('store_id'))),
    { initialValue: this.route.snapshot.queryParamMap.get('store_id') },
  );

  readonly loading = signal(true);
  readonly concepts = signal<WithholdingConcept[]>([]);
  readonly stats = signal<WithholdingStats | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly searchTerm = signal('');

  readonly activeConceptsCount = computed(
    () => this.concepts().filter((concept) => concept.is_active).length,
  );

  readonly filteredConcepts = computed(() => {
    const search = this.searchTerm().trim().toLowerCase();
    if (!search) return this.concepts();
    return this.concepts().filter((concept) =>
      [concept.code, concept.name, concept.applies_to]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search)),
    );
  });

  readonly tableColumns: TableColumn[] = [
    { key: 'code', label: 'Código', sortable: true, priority: 1, cellClass: () => 'font-mono' },
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    {
      key: 'rate',
      label: 'Tasa %',
      align: 'right',
      sortable: true,
      priority: 1,
      transform: (value) => `${(Number(value) * 100).toFixed(1)}%`,
    },
    {
      key: 'min_uvt_threshold',
      label: 'Umbral UVT',
      align: 'right',
      priority: 3,
      defaultValue: '0',
    },
    {
      key: 'applies_to',
      label: 'Aplica a',
      priority: 2,
      cellClass: () => 'capitalize',
      defaultValue: '—',
    },
    {
      key: 'is_active',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: { true: 'success', false: 'default' },
      },
      transform: (value) => (value ? 'Activo' : 'Inactivo'),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'code',
    avatarFallbackIcon: 'file-text',
    avatarShape: 'square',
    badgeKey: 'is_active',
    badgeConfig: {
      type: 'status',
      colorMap: { true: 'success', false: 'default' },
    },
    badgeTransform: (value) => (value ? 'Activo' : 'Inactivo'),
    detailKeys: [
      { key: 'rate', label: 'Tasa', icon: 'percent', transform: (value) => `${(Number(value) * 100).toFixed(1)}%` },
      { key: 'min_uvt_threshold', label: 'Umbral UVT', icon: 'calculator', transform: (value) => String(value ?? 0) },
      { key: 'applies_to', label: 'Aplica a', icon: 'tag', transform: (value) => String(value || '—') },
    ],
  };

  constructor() {
    this.route.queryParamMap
      .pipe(
        switchMap((params) => {
          this.loading.set(true);
          this.errorMessage.set(null);
          const storeId = params.get('store_id');
          const query = storeId ? { store_id: storeId } : undefined;
          this.loadStats(query);
          return this.service.getConcepts(query);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          this.concepts.set(res?.data ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudieron cargar los conceptos de retención.'),
          );
          this.concepts.set([]);
          this.loading.set(false);
        },
      });
  }

  private loadStats(query?: Record<string, any>): void {
    this.service
      .getStats(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.stats.set(res?.data ?? null),
        error: () => this.stats.set(null),
      });
  }

  onSearch(search: string): void {
    this.searchTerm.set(search);
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(Number(value) || 0, 0);
  }
}
