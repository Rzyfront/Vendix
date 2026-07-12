import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NgClass } from '@angular/common';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';

import { OrgCarteraService } from '../../services/org-cartera.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { AgingReport } from '../../../../store/accounting/interfaces/cartera.interface';
import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableColumn,
} from '../../../../../../shared/components/index';

type AgingTab = 'ar' | 'ap';

type AgingBreakdownRow = AgingReport['breakdown'][number];

@Component({
  selector: 'vendix-org-aging',
  standalone: true,
  imports: [
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    NgClass,
    ResponsiveDataViewComponent,
    StatsComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total"
          [value]="totalLabel()"
          smallText="Cartera del periodo"
          iconName="wallet"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading()"
        />
        <app-stats
          title="Al día"
          [value]="currentLabel()"
          smallText="Sin mora"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading()"
        />
        <app-stats
          title="En mora"
          [value]="overdueLabel()"
          smallText="1 día o más"
          iconName="alert-triangle"
          iconBgColor="bg-red-100"
          iconColor="text-red-500"
          [loading]="loading()"
        />
        <app-stats
          [title]="entityPluralLabel()"
          [value]="entityCount()"
          smallText="Con saldo"
          iconName="users"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading()"
        />
      </div>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudo cargar el reporte de antigüedad">
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
                Reporte de antigüedad ({{ breakdownRows().length }})
              </h2>
              <p class="hidden text-sm text-text-secondary md:block">
                Distribución de cartera por días de mora.
              </p>
            </div>

            <div class="flex w-full items-center gap-2 md:w-auto">
              <div class="flex flex-1 rounded-lg bg-[var(--color-surface-secondary)] p-0.5 md:flex-none">
                <button
                  class="flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors md:flex-none"
                  [ngClass]="active_tab() === 'ar' ? 'bg-[var(--color-surface)] text-success shadow-sm' : 'text-text-secondary hover:text-text-primary'"
                  (click)="switchTab('ar')"
                >
                  Por cobrar
                </button>
                <button
                  class="flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors md:flex-none"
                  [ngClass]="active_tab() === 'ap' ? 'bg-[var(--color-surface)] text-[var(--color-info)] shadow-sm' : 'text-text-secondary hover:text-text-primary'"
                  (click)="switchTab('ap')"
                >
                  Por pagar
                </button>
              </div>
              <app-button variant="outline" size="sm" (clicked)="reload()">
                <app-icon name="refresh-cw" [size]="14" slot="icon"></app-icon>
              </app-button>
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="breakdownRows()"
            [columns]="tableColumns()"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            [sortable]="true"
            emptyTitle="Sin datos de antigüedad"
            emptyMessage="Sin datos de antigüedad"
            emptyDescription="No hay cartera para el alcance fiscal seleccionado."
            emptyIcon="inbox"
            [showEmptyAction]="false"
          />
        </div>
      </app-card>
    </div>
  `,
})
export class OrgAgingComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly service = inject(OrgCarteraService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly route = inject(ActivatedRoute);

  private readonly storeId = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  private currentStoreId(): string | null {
    return this.storeId().get('store_id');
  }

  readonly active_tab = signal<AgingTab>('ar');
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly ar_aging = signal<AgingReport | null>(null);
  readonly ap_aging = signal<AgingReport | null>(null);

  readonly current_report = computed<AgingReport | null>(() =>
    this.active_tab() === 'ar' ? this.ar_aging() : this.ap_aging(),
  );

  readonly entity_label = computed(() =>
    this.active_tab() === 'ar' ? 'Cliente' : 'Proveedor',
  );

  readonly entityPluralLabel = computed(() =>
    this.active_tab() === 'ar' ? 'Clientes' : 'Proveedores',
  );

  // ── Read-only derived views over existing data ──────────────────
  readonly breakdownRows = computed<AgingBreakdownRow[]>(() => this.current_report()?.breakdown ?? []);

  readonly totalLabel = computed(() =>
    this.formatCurrency(this.current_report()?.totals?.grand_total),
  );

  readonly currentLabel = computed(() =>
    this.formatCurrency(this.current_report()?.totals?.current),
  );

  readonly overdueLabel = computed(() => {
    const totals = this.current_report()?.totals;
    if (!totals) return this.formatCurrency(0);
    const overdue =
      Number(totals.days_1_30 || 0) +
      Number(totals.days_31_60 || 0) +
      Number(totals.days_61_90 || 0) +
      Number(totals.days_91_120 || 0) +
      Number(totals.days_120_plus || 0);
    return this.formatCurrency(overdue);
  });

  readonly entityCount = computed(() => this.breakdownRows().length);

  // ── Table / card configuration ──────────────────────────────────
  readonly tableColumns = computed<TableColumn[]>(() => [
    {
      key: 'name',
      label: this.entity_label(),
      sortable: true,
      priority: 1,
      defaultValue: '—',
    },
    {
      key: 'current',
      label: 'Al día',
      align: 'right',
      sortable: true,
      priority: 2,
      transform: (value) => this.formatCurrency(value as number),
    },
    {
      key: 'days_1_30',
      label: '1-30d',
      align: 'right',
      sortable: true,
      priority: 3,
      transform: (value) => this.formatCurrency(value as number),
    },
    {
      key: 'days_31_60',
      label: '31-60d',
      align: 'right',
      sortable: true,
      priority: 3,
      transform: (value) => this.formatCurrency(value as number),
    },
    {
      key: 'days_61_90',
      label: '61-90d',
      align: 'right',
      sortable: true,
      priority: 3,
      transform: (value) => this.formatCurrency(value as number),
    },
    {
      key: 'days_91_120',
      label: '91-120d',
      align: 'right',
      sortable: true,
      priority: 3,
      transform: (value) => this.formatCurrency(value as number),
    },
    {
      key: 'days_120_plus',
      label: '120+d',
      align: 'right',
      sortable: true,
      priority: 3,
      transform: (value) => this.formatCurrency(value as number),
    },
    {
      key: 'total',
      label: 'Total',
      align: 'right',
      sortable: true,
      priority: 1,
      transform: (value) => this.formatCurrency(value as number),
    },
  ]);

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    titleTransform: (item) => (item as AgingBreakdownRow).name || '—',
    avatarFallbackIcon: 'users',
    avatarShape: 'circle',
    detailKeys: [
      { key: 'current', label: 'Al día', icon: 'check-circle', transform: (value) => this.formatCurrency(value as number) },
      { key: 'days_1_30', label: '1-30d', icon: 'clock', transform: (value) => this.formatCurrency(value as number) },
      { key: 'days_31_60', label: '31-60d', icon: 'clock', transform: (value) => this.formatCurrency(value as number) },
      { key: 'days_61_90', label: '61-90d', icon: 'alert-circle', transform: (value) => this.formatCurrency(value as number) },
      { key: 'days_91_120', label: '91-120d', icon: 'alert-triangle', transform: (value) => this.formatCurrency(value as number) },
      { key: 'days_120_plus', label: '120+d', icon: 'alert-triangle', transform: (value) => this.formatCurrency(value as number) },
    ],
    footerKey: 'total',
    footerLabel: 'Total',
    footerStyle: 'prominent',
    footerTransform: (value) => this.formatCurrency(value as number),
  };

  constructor() {
    let lastStoreId: string | null | undefined;
    effect(() => {
      const storeId = this.currentStoreId();
      if (storeId === lastStoreId) return;
      lastStoreId = storeId;
      untracked(() => this.loadData());
    });
  }

  loadData(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    const storeId = this.currentStoreId();

    this.service
      .getArAging(storeId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.ar_aging.set(res.data),
        error: () => {
          this.errorMessage.set('No se pudo cargar el reporte de antigüedad.');
          this.loading.set(false);
        },
      });

    this.service
      .getApAging(storeId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.ap_aging.set(res.data);
          this.loading.set(false);
        },
        error: () => {
          this.errorMessage.set('No se pudo cargar el reporte de antigüedad.');
          this.loading.set(false);
        },
      });
  }

  reload(): void {
    this.loadData();
  }

  switchTab(tab: AgingTab): void {
    this.active_tab.set(tab);
  }

  formatCurrency(val: number | undefined): string {
    return this.currency.format(Number(val) || 0);
  }
}
