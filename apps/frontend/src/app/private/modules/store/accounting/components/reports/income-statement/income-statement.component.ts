import { Component, inject, computed, effect, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  FiscalPeriod,
  IncomeStatementReport,
} from '../../../interfaces/accounting.interface';
import {
  selectIncomeStatement,
  selectReportLoading,
  selectFiscalPeriods,
} from '../../../state/selectors/accounting.selectors';
import { loadIncomeStatement } from '../../../state/actions/accounting.actions';
import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  SelectorComponent,
} from '../../../../../../../shared/components/index';

@Component({
  selector: 'vendix-income-statement',
  standalone: true,
  imports: [
    DecimalPipe,
    ButtonComponent,
    CardComponent,
    IconComponent,
    SelectorComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Unified Container -->
      <app-card
        [responsive]="true"
        [padding]="false"
        customClasses="md:min-h-[400px]"
      >
        <!-- Header -->
        <div
          class="sticky top-0 z-10 bg-background px-2 py-1.5 -mt-[5px]
                    md:mt-0 md:static md:bg-transparent md:px-4 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide
                       md:text-lg md:font-semibold md:text-text-primary"
            >
              Estado de Resultados
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-selector
                [options]="periodOptions()"
                placeholder="Seleccionar periodo..."
                (selectionChange)="onPeriodChange($event)"
                class="flex-1 md:w-48"
              ></app-selector>
              <app-button variant="outline" size="sm" (clicked)="loadReport()">
                <app-icon name="refresh-cw" [size]="14" slot="icon"></app-icon>
              </app-button>
            </div>
          </div>
        </div>

        <!-- Data Content -->
        <div class="relative p-2 md:p-4">
          @if (loading()) {
            <div
              class="absolute inset-0 bg-surface/50 z-10 flex items-center justify-center"
            >
              <div
                class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
              ></div>
            </div>
          }

          @if (report(); as report) {
            <div class="space-y-4">
              <!-- Revenue Section -->
              <div
                class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] border border-border overflow-hidden"
              >
                <div class="px-4 py-3 bg-emerald-50 border-b border-border">
                  <h3 class="text-sm font-bold text-emerald-800 uppercase">
                    Ingresos
                  </h3>
                </div>
                @if (report.revenue.accounts.length) {
                  <div class="divide-y divide-border">
                    @for (
                      row of report.revenue.accounts;
                      track row.account_id
                    ) {
                      <div class="px-4 py-2 flex justify-between items-center">
                        <div>
                          <span class="text-xs font-mono text-gray-500 mr-2">{{
                            row.account_code
                          }}</span>
                          <span class="text-sm">{{ row.account_name }}</span>
                        </div>
                        <span
                          class="text-sm font-mono font-medium text-emerald-600"
                        >
                          {{ row.balance | number: '1.2-2' }}
                        </span>
                      </div>
                    }
                  </div>
                }
                <div
                  class="px-4 py-3 bg-emerald-50 border-t border-border flex justify-between"
                >
                  <span class="text-sm font-bold text-emerald-800"
                    >Total Ingresos</span
                  >
                  <span class="text-sm font-mono font-bold text-emerald-800">
                    {{ report.total_revenue | number: '1.2-2' }}
                  </span>
                </div>
              </div>

              <!-- Expenses Section -->
              <div
                class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] border border-border overflow-hidden"
              >
                <div class="px-4 py-3 bg-red-50 border-b border-border">
                  <h3 class="text-sm font-bold text-red-800 uppercase">
                    Gastos
                  </h3>
                </div>
                @if (report.expenses.accounts.length) {
                  <div class="divide-y divide-border">
                    @for (
                      row of report.expenses.accounts;
                      track row.account_id
                    ) {
                      <div class="px-4 py-2 flex justify-between items-center">
                        <div>
                          <span class="text-xs font-mono text-gray-500 mr-2">{{
                            row.account_code
                          }}</span>
                          <span class="text-sm">{{ row.account_name }}</span>
                        </div>
                        <span
                          class="text-sm font-mono font-medium text-red-600"
                        >
                          {{ row.balance | number: '1.2-2' }}
                        </span>
                      </div>
                    }
                  </div>
                }
                <div
                  class="px-4 py-3 bg-red-50 border-t border-border flex justify-between"
                >
                  <span class="text-sm font-bold text-red-800"
                    >Total Gastos</span
                  >
                  <span class="text-sm font-mono font-bold text-red-800">
                    {{ report.total_expenses | number: '1.2-2' }}
                  </span>
                </div>
              </div>

              <!-- Net Income -->
              <div
                class="p-4 rounded-xl border-2"
                [class]="
                  report.net_income >= 0
                    ? 'bg-emerald-50 border-emerald-300'
                    : 'bg-red-50 border-red-300'
                "
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <app-icon
                      [name]="
                        report.net_income >= 0 ? 'trending-up' : 'trending-down'
                      "
                      [size]="24"
                      [class]="
                        report.net_income >= 0
                          ? 'text-emerald-600'
                          : 'text-red-600'
                      "
                    ></app-icon>
                    <span
                      class="text-lg font-bold"
                      [class]="
                        report.net_income >= 0
                          ? 'text-emerald-800'
                          : 'text-red-800'
                      "
                    >
                      {{
                        report.net_income >= 0
                          ? 'Ganancia Neta'
                          : 'Pérdida Neta'
                      }}
                    </span>
                  </div>
                  <span
                    class="text-xl font-mono font-bold"
                    [class]="
                      report.net_income >= 0
                        ? 'text-emerald-800'
                        : 'text-red-800'
                    "
                  >
                    {{ report.net_income | number: '1.2-2' }}
                  </span>
                </div>
              </div>
            </div>
          } @else {
            <div
              class="flex flex-col items-center justify-center py-16 text-gray-400"
            >
              <app-icon name="bar-chart-2" [size]="48"></app-icon>
              <p class="mt-4">Selecciona un periodo para generar el reporte</p>
            </div>
          }
        </div>
      </app-card>
    </div>
  `,
})
export class IncomeStatementComponent {
  private store = inject(Store);

  // State via toSignal
  readonly report = toSignal(this.store.select(selectIncomeStatement), {
    initialValue: null,
  });
  readonly loading = toSignal(this.store.select(selectReportLoading), {
    initialValue: false,
  });
  readonly periods = toSignal(this.store.select(selectFiscalPeriods), {
    initialValue: [] as FiscalPeriod[],
  });

  // ✅ Signals properly configured (already migrated, cleanup unused effect)
  readonly periodOptions = computed(() =>
    this.periods().map((p) => ({
      value: p.id,
      label: p.name,
    })),
  );
  readonly selectedPeriodId = signal<number | null>(null);

  constructor() {
    // ✅ Removed unused effect — computed handles reactivity automatically
  }

  onPeriodChange(value: any): void {
    this.selectedPeriodId.set(value);
    this.loadReport();
  }

  loadReport(): void {
    const periodId = this.selectedPeriodId();
    if (periodId) {
      this.store.dispatch(
        loadIncomeStatement({
          query: { fiscal_period_id: periodId },
        }),
      );
    }
  }
}
