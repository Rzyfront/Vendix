import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';

import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { OptionsDropdownComponent } from '../../../../../../../shared/components/options-dropdown/options-dropdown.component';
import { StickyHeaderComponent } from '../../../../../../../shared/components/sticky-header/sticky-header.component';
import type {
  DropdownAction,
  FilterConfig,
  FilterValues,
} from '../../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';

import {
  OverviewStatCardComponent,
  OverviewStatState,
  OverviewStatTrend,
  OverviewStatFormat,
} from '../../../components/overview-stat-card/overview-stat-card.component';
import { ReportsCatalogComponent } from '../../../components/reports-catalog/reports-catalog.component';
import { ReportsDataService } from '../../../services/reports-data.service';

import { REPORT_DEFINITIONS } from '../../../config/report-registry';

import { DateRangeFilter } from '../../../../../../../shared/interfaces/date-range-filter.interface';
import { OverviewSummary } from '../../../../analytics/interfaces/overview-analytics.interface';

// ----------------------------------------------------------------------------
// Local view-model for a single stat card. The helper `buildStatCards()`
// produces one of these per metric; the template renders them via
// `<app-overview-stat-card>`. `formattedValue` is a pre-formatted string
// (used for the `—` no-data state and inspected by tests) while `value`
// is the raw number that drives the card's own auto-formatting.
// ----------------------------------------------------------------------------

interface OverviewStatCard {
  key: string;
  title: string;
  icon: string;
  state: OverviewStatState;
  trend: OverviewStatTrend | undefined;
  growth: number | null | undefined;
  formatType: OverviewStatFormat;
  value: number | null;
  formattedValue: string;
}

// ----------------------------------------------------------------------------
// Pre-resolved ReportDefinition for the overview summary. We need a real
// definition because `ReportsDataService.fetchReportData` uses `report.id`
// for cache invalidation and because the response adapter switches on
// `report.id` to choose a transformer (none matches here, so the adapter
// falls through to the default `summary` path which is exactly what we
// want — `result.data[0]` is the raw `OverviewSummary`).
// ----------------------------------------------------------------------------

const OVERVIEW_REPORT =
  REPORT_DEFINITIONS.find((r) => r.id === 'overview-summary') ??
  REPORT_DEFINITIONS[0];

const PLACEHOLDER_VALUE = '—';

/**
 * OverviewSummaryReportComponent
 *
 * Refactored entrypoint for `/admin/reports/overview/overview-summary`.
 * Replaces the previous `<app-report-viewer>` shell with a custom layout
 * composed of:
 *
 *   1. A sticky header.
 *   2. A date-range filter exposed via `<app-options-dropdown>` (Fase B1
 *      migration — period used to live in a standalone `<vendix-date-range-filter>`
 *      and now travels inside the unified Filtros trigger).
 *   3. A 4×2 grid of color-coded stat cards driven by `OverviewSummary`.
 *   4. The full reports catalog (chips + search + grouped grid).
 *
 * Loads data directly via `ReportsDataService.fetchReportData` (no NgRx)
 * and reacts to `dateRange` changes through an `effect()` that triggers
 * a refetch while keeping writes untracked to avoid feedback loops.
 *
 * Skills applied:
 *   - `vendix-zoneless-signals` (signal inputs/outputs, OnPush, no legacy)
 *   - `vendix-currency-formatting` (CurrencyFormatService for ad-hoc formats)
 *   - `vendix-frontend-stats-cards` (responsive 4×2 → 2×4 → horizontal scroll)
 *   - `vendix-frontend-sticky-header` (page-level header)
 *   - `vendix-analytics-metrics` (threshold definitions)
 */
@Component({
  selector: 'app-overview-summary-report',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    OverviewStatCardComponent,
    ReportsCatalogComponent,
    OptionsDropdownComponent,
    StickyHeaderComponent,
    IconComponent,
  ],
  styleUrls: ['./overview-summary-report.component.scss'],
  template: `
    <div class="overview-summary-page">
      <app-sticky-header
        title="Resumen General"
        subtitle="Vista ejecutiva del estado del negocio"
        icon="bar-chart-3"
      />

      <div class="overview-summary-content">
        <div class="overview-summary-toolbar">
          <app-options-dropdown
            [filters]="filterConfigs()"
            [filterValues]="dropdownFilterValues()"
            [actions]="[]"
            [showActions]="false"
            triggerLabel="Filtros"
            triggerIcon="filter"
            [debounceMs]="350"
            (filterChange)="onFiltersDropdownChange($event)"
            (clearAllFilters)="onFiltersDropdownClearAll()"
          ></app-options-dropdown>
        </div>

        @if (statCards().length > 0) {
          <div class="overview-stats-grid">
            @for (card of statCards(); track card.key) {
              <app-overview-stat-card
                [title]="card.title"
                [value]="card.formattedValue"
                [icon]="card.icon"
                [state]="card.state"
                [trend]="card.trend"
                [growth]="card.growth"
                [formatType]="card.formatType"
                [loading]="loading()"
              />
            }
          </div>
        }

        <app-reports-catalog />

        @if (error(); as err) {
          <div class="overview-error-banner" role="alert">
            <app-icon name="alert-circle" [size]="20" />
            <span>{{ err }}</span>
          </div>
        }
      </div>
    </div>
  `,
})
export class OverviewSummaryReportComponent {
  private readonly reportsData = inject(ReportsDataService);
  private readonly currencyService = inject(CurrencyFormatService);

  // ---------------------------------------------------------------------------
  // State signals
  // ---------------------------------------------------------------------------

  readonly summary = signal<OverviewSummary | null>(null);
  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly dateRange = signal<DateRangeFilter | null>(null);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  /**
   * 8 cards derived from the current summary. Recomputes whenever
   * `summary()` changes (zoneless-friendly: only the cards re-render).
   */
  readonly statCards = computed<OverviewStatCard[]>(() =>
    this.buildStatCards(this.summary()),
  );

  // ---------------------------------------------------------------------------
  // Dropdown filter shape (`app-options-dropdown` integration)
  // ---------------------------------------------------------------------------

  /**
   * Filter shape consumed by `<app-options-dropdown>` for the "Filtros"
   * trigger in the toolbar. The page has only the date-range filter; the
   * action side stays empty because `overview-summary` does NOT expose
   * an `exportEndpoint` in the report registry, so no XLSX action is
   * declared.
   *
   * Mirrors the three-key decomposition done by `OptionsDropdownComponent`:
   * the dropdown manages `date_range_start`/`date_range_end`/`date_range_preset`
   * internally and we receive them all together on `(filterChange)`.
   */
  readonly filterConfigs = computed<FilterConfig[]>(() => [
    {
      key: 'date_range',
      label: 'Período',
      type: 'date-range',
    },
  ]);

  /**
   * Snapshot of the date-range filter that the dropdown displays.
   * The parent owns the truth (`dateRange` signal); this computed just
   * aplanates the three fields for the dropdown's flat `FilterValues` map.
   *
   * Returns an empty `FilterValues` when no range is set yet so the
   * dropdown renders the preset default (Este Mes). The literal
   * `as FilterValues` cast is needed because TS otherwise narrows the
   * empty object to `{ k?: undefined }` which isn't assignable.
   */
  readonly dropdownFilterValues = computed<FilterValues>(() => {
    const range = this.dateRange();
    if (!range) return {} as FilterValues;
    return {
      date_range_start: range.start_date,
      date_range_end: range.end_date,
      date_range_preset: range.preset ?? null,
    };
  });

  /**
   * No actions for the overview summary — the report registry does not
   * declare `exportEndpoint` for `overview-summary`. Returning `[]` keeps
   * the action trigger hidden (`[showActions]="false"` in the template).
   */
  readonly dropdownActions = computed<DropdownAction[]>(() => []);

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  constructor() {
    // React to date range changes by refetching the overview summary.
    // `untracked()` wraps the write so the effect doesn't re-trigger
    // when `loading()` / `error()` / `summary()` change inside `loadOverview`.
    effect(() => {
      const range = this.dateRange();
      untracked(() => this.loadOverview(range));
    });
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  /**
   * `(filterChange)` from `<app-options-dropdown>`. The dropdown debounces
   * three keys (`date_range_start/_end/_preset`); we recompose them into the
   * `DateRangeFilter` that `ReportsDataService.fetchReportData` consumes.
   *
   * A partial range (start XOR end, both required) is ignored — the same
   * guard the `ReportViewerComponent` uses, so the two surfaces stay
   * consistent.
   */
  onFiltersDropdownChange(values: FilterValues): void {
    const start = values['date_range_start'];
    const end = values['date_range_end'];
    const preset = values['date_range_preset'];

    if (typeof start !== 'string' || typeof end !== 'string' || !start || !end) {
      return;
    }

    this.dateRange.set({
      start_date: start,
      end_date: end,
      preset: (typeof preset === 'string' && preset
        ? preset
        : 'custom') as DateRangeFilter['preset'],
    });
  }

  /**
   * `(clearAllFilters)` from `<app-options-dropdown>`. The page does not
   * pin a default period the way the NgRx reports do, so we simply drop
   * the range: the loading effect refetches with `dateRange === null`,
   * which `ReportsDataService` interprets as "no range constraint".
   */
  onFiltersDropdownClearAll(): void {
    this.dateRange.set(null);
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  private loadOverview(dateRange: DateRangeFilter | null): void {
    this.loading.set(true);
    this.error.set(null);

    const options = dateRange
      ? { dateRange }
      : { dateRange: undefined };

    this.reportsData
      .fetchReportData(OVERVIEW_REPORT.dataEndpoint, OVERVIEW_REPORT, options)
      .subscribe({
        next: (result) => {
          // `result.data[0]` is the raw `OverviewSummary` object (the
          // adapter's `summary` path keeps the original row; nested objects
          // like `cost_coverage` stay nested, unlike `summaryData` which
          // flattens them).
          const first = Array.isArray(result.data) ? result.data[0] : null;
          this.summary.set((first as OverviewSummary | undefined) ?? null);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          const message =
            (err as { error?: { message?: string }; message?: string })
              ?.error?.message ??
            (err as { message?: string })?.message ??
            'No se pudo cargar el resumen general. Inténtalo de nuevo.';
          this.error.set(message);
          this.loading.set(false);
        },
      });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Maps a raw `OverviewSummary` (or `null` for the initial / no-data state)
   * to the 8 cards displayed in the grid. Each card's `state` is derived
   * from the metric and the surrounding context (e.g. expense ratio uses
   * income as the denominator).
   */
  private buildStatCards(summary: OverviewSummary | null): OverviewStatCard[] {
    const noData = !summary;

    // Common neutral card used for any field that is `null`/`undefined`.
    const neutral = (overrides: Partial<OverviewStatCard>): OverviewStatCard => ({
      key: '',
      title: '',
      icon: 'info',
      state: 'neutral',
      trend: undefined,
      growth: undefined,
      formatType: 'number',
      value: null,
      formattedValue: PLACEHOLDER_VALUE,
      ...overrides,
    });

    if (noData) {
      return [
        neutral({
          key: 'total_income',
          title: 'Ingresos Totales',
          icon: 'dollar-sign',
          formatType: 'currency',
        }),
        neutral({
          key: 'total_expenses',
          title: 'Gastos Totales',
          icon: 'trending-down',
          formatType: 'currency',
        }),
        neutral({
          key: 'gross_profit',
          title: 'Ganancia Bruta',
          icon: 'wallet',
          formatType: 'currency',
        }),
        neutral({
          key: 'net_profit',
          title: 'Ganancia Neta',
          icon: 'circle-dollar-sign',
          formatType: 'currency',
        }),
        neutral({
          key: 'gross_margin',
          title: 'Margen Bruto %',
          icon: 'percent',
          formatType: 'percentage',
        }),
        neutral({
          key: 'net_margin',
          title: 'Margen Neto %',
          icon: 'percent',
          formatType: 'percentage',
        }),
        neutral({
          key: 'breakeven_ratio',
          title: 'Punto de Equilibrio %',
          icon: 'gauge',
          formatType: 'percentage',
        }),
        // Growth has a specific null-treatment (trend = flat, growth = null).
        neutral({
          key: 'income_growth',
          title: 'Crecimiento Ingresos',
          icon: 'minus',
          formatType: 'percentage',
          trend: 'flat',
          growth: null,
        }),
      ];
    }

    const income = this.numberOrNull(summary.total_income);
    const expenses = this.numberOrNull(summary.total_expenses);
    const grossProfit = this.numberOrNull(summary.gross_profit);
    const netProfit = this.numberOrNull(summary.net_profit);
    const grossMargin = this.numberOrNull(summary.gross_margin);
    const netMargin = this.numberOrNull(summary.net_margin);
    const breakeven = this.numberOrNull(summary.breakeven_ratio);
    const incomeGrowth = summary.income_growth; // already number | null

    const hasIncome = income !== null && income > 0;

    const expenseRatio = hasIncome && expenses !== null
      ? expenses / income
      : null;

    const computedNetMargin = hasIncome && netProfit !== null
      ? netProfit / income
      : null;

    return [
      {
        key: 'total_income',
        title: 'Ingresos Totales',
        icon: 'dollar-sign',
        state: this.incomeState(income),
        trend: undefined,
        growth: undefined,
        formatType: 'currency',
        value: income,
        formattedValue: this.formatCurrency(income),
      },
      {
        key: 'total_expenses',
        title: 'Gastos Totales',
        icon: 'trending-down',
        state: this.expenseState(expenseRatio),
        trend: undefined,
        growth: undefined,
        formatType: 'currency',
        value: expenses,
        formattedValue: this.formatCurrency(expenses),
      },
      {
        key: 'gross_profit',
        title: 'Ganancia Bruta',
        icon: 'wallet',
        state: this.grossProfitState(grossProfit),
        trend: undefined,
        growth: undefined,
        formatType: 'currency',
        value: grossProfit,
        formattedValue: this.formatCurrency(grossProfit),
      },
      {
        key: 'net_profit',
        title: 'Ganancia Neta',
        icon: 'circle-dollar-sign',
        state: this.netProfitState(computedNetMargin, hasIncome),
        trend: undefined,
        growth: undefined,
        formatType: 'currency',
        value: netProfit,
        formattedValue: this.formatCurrency(netProfit),
      },
      {
        key: 'gross_margin',
        title: 'Margen Bruto %',
        icon: 'percent',
        state: this.marginPercentState(grossMargin, { positive: 30, warning: 15 }),
        trend: undefined,
        growth: undefined,
        formatType: 'percentage',
        value: grossMargin,
        formattedValue: this.formatPercentage(grossMargin),
      },
      {
        key: 'net_margin',
        title: 'Margen Neto %',
        icon: 'percent',
        state: this.marginPercentState(netMargin, { positive: 15, warning: 0 }),
        trend: undefined,
        growth: undefined,
        formatType: 'percentage',
        value: netMargin,
        formattedValue: this.formatPercentage(netMargin),
      },
      {
        key: 'breakeven_ratio',
        title: 'Punto de Equilibrio %',
        icon: 'gauge',
        state: this.breakevenState(breakeven),
        trend: undefined,
        growth: undefined,
        formatType: 'percentage',
        value: breakeven,
        formattedValue: this.formatPercentage(breakeven),
      },
      this.growthCard(incomeGrowth),
    ];
  }

  // -- State resolvers --------------------------------------------------------

  private incomeState(income: number | null): OverviewStatState {
    if (income === null) return 'neutral';
    return income > 0 ? 'positive' : 'neutral';
  }

  private expenseState(ratio: number | null): OverviewStatState {
    if (ratio === null) return 'neutral';
    if (ratio > 0.7) return 'critical';
    if (ratio > 0.4) return 'warning';
    return 'positive';
  }

  private grossProfitState(grossProfit: number | null): OverviewStatState {
    if (grossProfit === null) return 'neutral';
    return grossProfit > 0 ? 'positive' : 'critical';
  }

  private netProfitState(
    netMarginRatio: number | null,
    hasIncome: boolean,
  ): OverviewStatState {
    if (!hasIncome || netMarginRatio === null) return 'neutral';
    if (netMarginRatio >= 0.15) return 'positive';
    if (netMarginRatio >= 0) return 'warning';
    return 'critical';
  }

  private marginPercentState(
    value: number | null,
    thresholds: { positive: number; warning: number },
  ): OverviewStatState {
    if (value === null) return 'neutral';
    if (value >= thresholds.positive) return 'positive';
    if (value >= thresholds.warning) return 'warning';
    return 'critical';
  }

  private breakevenState(ratio: number | null): OverviewStatState {
    if (ratio === null) return 'neutral';
    if (ratio >= 100) return 'positive';
    if (ratio >= 70) return 'warning';
    return 'critical';
  }

  private growthCard(value: number | null): OverviewStatCard {
    if (value === null) {
      return {
        key: 'income_growth',
        title: 'Crecimiento Ingresos',
        icon: 'minus',
        state: 'neutral',
        trend: 'flat',
        growth: null,
        formatType: 'percentage',
        value: null,
        formattedValue: PLACEHOLDER_VALUE,
      };
    }

    if (value > 0) {
      return {
        key: 'income_growth',
        title: 'Crecimiento Ingresos',
        icon: 'trending-up',
        state: 'positive',
        trend: 'up',
        growth: value,
        formatType: 'percentage',
        value,
        formattedValue: this.formatPercentage(value),
      };
    }

    if (value < 0) {
      return {
        key: 'income_growth',
        title: 'Crecimiento Ingresos',
        icon: 'trending-down',
        state: 'critical',
        trend: 'down',
        growth: value,
        formatType: 'percentage',
        value,
        formattedValue: this.formatPercentage(value),
      };
    }

    return {
      key: 'income_growth',
      title: 'Crecimiento Ingresos',
      icon: 'minus',
      state: 'neutral',
      trend: 'flat',
      growth: 0,
      formatType: 'percentage',
      value: 0,
      formattedValue: this.formatPercentage(0),
    };
  }

  // -- Formatters -------------------------------------------------------------

  private formatCurrency(value: number | null): string {
    if (value === null) return PLACEHOLDER_VALUE;
    // `format()` honors tenant currency settings; falls back to `$` while
    // the tenant config loads. We pass 0 decimals so stat cards match
    // the integer-style formatting used by the analytics overview.
    return this.currencyService.format(value, 0);
  }

  private formatPercentage(value: number | null): string {
    if (value === null) return PLACEHOLDER_VALUE;
    return `${value}%`;
  }

  private numberOrNull(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
}