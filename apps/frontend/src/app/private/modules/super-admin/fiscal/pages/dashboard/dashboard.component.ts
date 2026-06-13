import { DatePipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import {
  CardComponent,
  EmptyStateComponent,
  SelectorComponent,
  StatsComponent,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { SuperadminFiscalService } from '../../services/superadmin-fiscal.service';
import { DashboardKpis } from '../../interfaces/superadmin-fiscal.interface';

type PeriodPreset = 30 | 90 | 365;

@Component({
  selector: 'app-fiscal-dashboard',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    StatsComponent,
    CardComponent,
    SelectorComponent,
    EmptyStateComponent,
    CurrencyPipe,
  ],
  template: `
    <div class="w-full">
      <!-- Period filter -->
      <div
        class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-4 px-2 md:px-0"
      >
        <h2 class="text-base md:text-lg font-semibold text-text-primary">
          Panel Fiscal Unificado
          <span class="text-text-secondary font-normal text-sm">
            · {{ periodLabel() }}
          </span>
        </h2>
        <div class="w-full md:w-56">
          <app-selector
            [options]="periodOptions"
            [ngModel]="selectedPeriod()"
            (ngModelChange)="onPeriodChange($any($event))"
            size="sm"
            variant="outline"
          ></app-selector>
        </div>
      </div>

      <!-- KPI cards -->
      <div class="stats-container !mb-4 md:!mb-8">
        <app-stats
          title="Ingresos del mes"
          [value]="revenueValue() | currency"
          [smallText]="'Fuente: journal entries saas_revenue'"
          iconName="trending-up"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-600"
          [loading]="loading()"
        ></app-stats>

        <app-stats
          title="Comisiones Pagadas"
          [value]="payoutsValue() | currency"
          [smallText]="'Payouts liquidados en el periodo'"
          iconName="banknote"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
          [loading]="loading()"
        ></app-stats>

        <app-stats
          title="Refunds del mes"
          [value]="refundsValue() | currency"
          [smallText]="'Reversos contabilizados'"
          iconName="rotate-ccw"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
          [loading]="loading()"
        ></app-stats>

        <app-stats
          title="Asientos Manuales"
          [value]="manualEntriesCount()"
          [smallText]="'source_type = manual_journal_entry'"
          iconName="edit-3"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
          [loading]="loading()"
        ></app-stats>

        <app-stats
          title="Obligaciones Pendientes"
          [value]="pendingObligations()"
          [smallText]="'Periodo actual (no filed/submitted)'"
          iconName="alert-circle"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
          [loading]="loading()"
        ></app-stats>

        <app-stats
          title="Período Fiscal"
          [value]="periodKpiValue()"
          [smallText]="periodKpiSubLabel()"
          iconName="calendar"
          iconBgColor="bg-gray-100"
          iconColor="text-gray-600"
          [loading]="loading()"
        ></app-stats>
      </div>

      @if (errorMessage()) {
        <app-empty-state
          icon="alert-triangle"
          title="No se pudieron cargar los KPIs"
          [description]="errorMessage()!"
          [showActionButton]="false"
        ></app-empty-state>
      } @else if (kpis()) {
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <app-card [padding]="false" customClasses="!p-4 lg:col-span-2">
            <h3 class="text-sm font-semibold text-text-primary mb-3">
              Resumen del periodo
            </h3>
            <ul class="space-y-2 text-sm">
              <li class="flex items-center justify-between">
                <span class="text-text-secondary">Ingresos brutos</span>
                <span class="font-mono text-text-primary">
                  {{ revenueValue() | currency }}
                </span>
              </li>
              <li class="flex items-center justify-between">
                <span class="text-text-secondary">(–) Refunds</span>
                <span class="font-mono text-text-primary">
                  {{ refundsValue() | currency }}
                </span>
              </li>
              <li class="flex items-center justify-between">
                <span class="text-text-secondary">(–) Comisiones pagadas</span>
                <span class="font-mono text-text-primary">
                  {{ payoutsValue() | currency }}
                </span>
              </li>
              <li class="flex items-center justify-between border-t border-border pt-2 mt-2">
                <span class="text-text-primary font-semibold">Neto estimado</span>
                <span class="font-mono text-text-primary font-semibold">
                  {{ netValue() | currency }}
                </span>
              </li>
            </ul>
          </app-card>

          <app-card [padding]="false" customClasses="!p-4">
            <h3 class="text-sm font-semibold text-text-primary mb-3">
              Periodo fiscal abierto
            </h3>
            @if (kpis()?.current_period; as period) {
              <div class="space-y-2 text-sm">
                <div>
                  <div class="text-text-secondary text-xs uppercase tracking-wide">
                    Nombre
                  </div>
                  <div class="text-text-primary font-semibold">{{ period.name }}</div>
                </div>
                <div>
                  <div class="text-text-secondary text-xs uppercase tracking-wide">
                    Cierre
                  </div>
                  <div class="text-text-primary font-mono">
                    {{ period.closes_at | date: 'dd MMM yyyy' : 'UTC' }}
                  </div>
                </div>
                <div>
                  <div class="text-text-secondary text-xs uppercase tracking-wide">
                    Días restantes
                  </div>
                  <div class="text-text-primary font-mono text-2xl">
                    {{ period.days_remaining }}
                  </div>
                </div>
              </div>
            } @else {
              <p class="text-sm text-text-secondary py-4">
                No hay un período fiscal abierto.
              </p>
            }
          </app-card>
        </div>
      }
    </div>
  `,
})
export class DashboardComponent {
  private readonly api = inject(SuperadminFiscalService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly kpis = signal<DashboardKpis | null>(null);
  readonly selectedPeriod = signal<PeriodPreset>(30);

  readonly periodOptions: { value: PeriodPreset; label: string }[] = [
    { value: 30, label: 'Últimos 30 días' },
    { value: 90, label: 'Últimos 90 días' },
    { value: 365, label: 'Últimos 365 días' },
  ];

  readonly revenueValue = computed(() =>
    Number(this.kpis()?.revenue_month ?? 0),
  );
  readonly payoutsValue = computed(() =>
    Number(this.kpis()?.partner_payouts_month ?? 0),
  );
  readonly refundsValue = computed(() =>
    Number(this.kpis()?.refunds_month ?? 0),
  );
  readonly manualEntriesCount = computed(
    () => this.kpis()?.manual_entries_count ?? 0,
  );
  readonly pendingObligations = computed(
    () => this.kpis()?.pending_obligations ?? 0,
  );
  readonly netValue = computed(
    () =>
      this.revenueValue() - this.refundsValue() - this.payoutsValue(),
  );

  readonly periodKpiValue = computed(() => {
    const cp = this.kpis()?.current_period;
    if (!cp) return '—';
    return `${cp.days_remaining}d`;
  });
  readonly periodKpiSubLabel = computed(() => {
    const cp = this.kpis()?.current_period;
    if (!cp) return 'Sin período abierto';
    return cp.name;
  });

  readonly periodLabel = computed(() => {
    const m = this.periodOptions.find((o) => o.value === this.selectedPeriod());
    return m?.label ?? '—';
  });

  constructor() {
    effect(() => {
      const period = this.selectedPeriod();
      this.fetch(period);
    });
  }

  onPeriodChange(value: PeriodPreset): void {
    this.selectedPeriod.set(value);
  }

  private fetch(period: PeriodPreset): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.api
      .getDashboardKpis(period)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (kpis) => {
          this.kpis.set(kpis);
          this.loading.set(false);
        },
        error: (err) => {
          this.errorMessage.set(
            err?.error?.message ?? 'Error inesperado al cargar los KPIs',
          );
          this.loading.set(false);
        },
      });
  }
}
