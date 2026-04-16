import { Component, inject } from '@angular/core';
import { DecimalPipe, AsyncPipe } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  FiscalPeriod,
  BalanceSheetReport,
} from '../../../interfaces/accounting.interface';
import {
  selectBalanceSheet,
  selectReportLoading,
  selectFiscalPeriods,
} from '../../../state/selectors/accounting.selectors';
import { loadBalanceSheet } from '../../../state/actions/accounting.actions';
import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  SelectorComponent,
} from '../../../../../../../shared/components/index';

@Component({
  selector: 'vendix-balance-sheet',
  standalone: true,
  imports: [
    DecimalPipe,
    AsyncPipe,
    ButtonComponent,
    CardComponent,
    IconComponent,
    SelectorComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Unified Container -->
      <app-card [responsive]="true" [padding]="false" customClasses="md:min-h-[400px]">
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
              Balance General
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-selector
                [options]="period_options"
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
          @if (loading$ | async) {
            <div
              class="absolute inset-0 bg-surface/50 z-10 flex items-center justify-center"
            >
              <div
                class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
              ></div>
            </div>
          }

          @if (report$ | async; as report) {
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- Assets -->
              <div
                class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] border border-border overflow-hidden"
              >
                <div class="px-4 py-3 bg-blue-50 border-b border-border">
                  <h3 class="text-sm font-bold text-blue-800 uppercase">
                    Activos
                  </h3>
                </div>
                @if (report.assets.accounts.length) {
                  <div class="divide-y divide-border">
                    @for (row of report.assets.accounts; track row.account_id) {
                      <div class="px-4 py-2 flex justify-between items-center">
                        <div>
                          <span class="text-xs font-mono text-gray-500 mr-2">{{
                            row.account_code
                          }}</span>
                          <span class="text-sm">{{ row.account_name }}</span>
                        </div>
                        <span class="text-sm font-mono font-medium">{{
                          row.balance | number: '1.2-2'
                        }}</span>
                      </div>
                    }
                  </div>
                }
                <div
                  class="px-4 py-3 bg-blue-50 border-t border-border flex justify-between"
                >
                  <span class="text-sm font-bold text-blue-800"
                    >Total Activos</span
                  >
                  <span class="text-sm font-mono font-bold text-blue-800">{{
                    report.total_assets | number: '1.2-2'
                  }}</span>
                </div>
              </div>

              <!-- Liabilities + Equity -->
              <div class="space-y-4">
                <!-- Liabilities -->
                <div
                  class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] border border-border overflow-hidden"
                >
                  <div class="px-4 py-3 bg-amber-50 border-b border-border">
                    <h3 class="text-sm font-bold text-amber-800 uppercase">
                      Pasivos
                    </h3>
                  </div>
                  @if (report.liabilities.accounts.length) {
                    <div class="divide-y divide-border">
                      @for (
                        row of report.liabilities.accounts;
                        track row.account_id
                      ) {
                        <div
                          class="px-4 py-2 flex justify-between items-center"
                        >
                          <div>
                            <span
                              class="text-xs font-mono text-gray-500 mr-2"
                              >{{ row.account_code }}</span
                            >
                            <span class="text-sm">{{ row.account_name }}</span>
                          </div>
                          <span class="text-sm font-mono font-medium">{{
                            row.balance | number: '1.2-2'
                          }}</span>
                        </div>
                      }
                    </div>
                  }
                  <div
                    class="px-4 py-3 bg-amber-50 border-t border-border flex justify-between"
                  >
                    <span class="text-sm font-bold text-amber-800"
                      >Total Pasivos</span
                    >
                    <span class="text-sm font-mono font-bold text-amber-800">{{
                      report.liabilities.total | number: '1.2-2'
                    }}</span>
                  </div>
                </div>

                <!-- Equity -->
                <div
                  class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] border border-border overflow-hidden"
                >
                  <div class="px-4 py-3 bg-purple-50 border-b border-border">
                    <h3 class="text-sm font-bold text-purple-800 uppercase">
                      Patrimonio
                    </h3>
                  </div>
                  @if (report.equity.accounts.length) {
                    <div class="divide-y divide-border">
                      @for (
                        row of report.equity.accounts;
                        track row.account_id
                      ) {
                        <div
                          class="px-4 py-2 flex justify-between items-center"
                        >
                          <div>
                            <span
                              class="text-xs font-mono text-gray-500 mr-2"
                              >{{ row.account_code }}</span
                            >
                            <span class="text-sm">{{ row.account_name }}</span>
                          </div>
                          <span class="text-sm font-mono font-medium">{{
                            row.balance | number: '1.2-2'
                          }}</span>
                        </div>
                      }
                    </div>
                  }
                  <div
                    class="px-4 py-3 bg-purple-50 border-t border-border flex justify-between"
                  >
                    <span class="text-sm font-bold text-purple-800"
                      >Total Patrimonio</span
                    >
                    <span class="text-sm font-mono font-bold text-purple-800">{{
                      report.equity.total | number: '1.2-2'
                    }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Balance Check -->
            <div
              class="mt-4 p-4 rounded-lg border"
              [class]="
                isBalanced(report)
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-red-50 border-red-200'
              "
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <app-icon
                    [name]="
                      isBalanced(report) ? 'check-circle' : 'alert-circle'
                    "
                    [size]="20"
                    [class]="
                      isBalanced(report) ? 'text-emerald-600' : 'text-red-600'
                    "
                  ></app-icon>
                  <span
                    class="text-sm font-medium"
                    [class]="
                      isBalanced(report) ? 'text-emerald-700' : 'text-red-700'
                    "
                  >
                    {{
                      isBalanced(report)
                        ? 'El balance general está balanceado'
                        : 'El balance general NO está balanceado'
                    }}
                  </span>
                </div>
                <div class="text-right text-sm font-mono">
                  <span class="text-gray-500">P+P: </span>
                  <span class="font-bold">{{
                    report.total_liabilities_equity | number: '1.2-2'
                  }}</span>
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
export class BalanceSheetComponent {
  private store = inject(Store);

  report$: Observable<BalanceSheetReport | null> =
    this.store.select(selectBalanceSheet);
  loading$: Observable<boolean> = this.store.select(selectReportLoading);
  periods$: Observable<FiscalPeriod[]> = this.store.select(selectFiscalPeriods);

  period_options: { value: any; label: string }[] = [];
  selected_period_id: number | null = null;

  constructor() {
    this.periods$.subscribe((periods) => {
      this.period_options = periods.map((p) => ({
        value: p.id,
        label: p.name,
      }));
    });
  }

  onPeriodChange(value: any): void {
    this.selected_period_id = value;
    this.loadReport();
  }

  loadReport(): void {
    if (this.selected_period_id) {
      this.store.dispatch(
        loadBalanceSheet({
          query: { fiscal_period_id: this.selected_period_id },
        }),
      );
    }
  }

  isBalanced(report: BalanceSheetReport): boolean {
    return (
      Math.abs(report.total_assets - report.total_liabilities_equity) < 0.01
    );
  }
}
