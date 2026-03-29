import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  FiscalPeriod,
  TrialBalanceReport,
} from '../../../interfaces/accounting.interface';
import {
  selectTrialBalance,
  selectReportLoading,
  selectFiscalPeriods,
} from '../../../state/selectors/accounting.selectors';
import { loadTrialBalance } from '../../../state/actions/accounting.actions';
import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  SelectorComponent,
} from '../../../../../../../shared/components/index';

@Component({
  selector: 'vendix-trial-balance',
  standalone: true,
  imports: [
    CommonModule,
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
              Balance de Prueba
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
            <!-- Table Header (desktop) -->
            <div
              class="hidden md:grid md:grid-cols-12 gap-2 px-4 py-3 bg-gray-50 rounded-lg
                        text-xs font-semibold text-gray-500 uppercase mb-1"
            >
              <div class="col-span-2">Código</div>
              <div class="col-span-4">Cuenta</div>
              <div class="col-span-1">Tipo</div>
              <div class="col-span-2 text-right">Débito</div>
              <div class="col-span-2 text-right">Crédito</div>
              <div class="col-span-1 text-right">Saldo</div>
            </div>

            @if (report.rows.length === 0) {
              <div
                class="flex flex-col items-center justify-center py-16 text-gray-400"
              >
                <app-icon name="file-text" [size]="48"></app-icon>
                <p class="mt-4">No hay datos para este periodo</p>
              </div>
            } @else {
              <div class="divide-y divide-border">
                @for (row of report.rows; track row.account_id) {
                  <!-- Mobile -->
                  <div
                    class="md:hidden p-3 mx-0.5 my-1 bg-surface rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.07)]"
                  >
                    <div class="flex justify-between items-start">
                      <div>
                        <p class="text-xs font-mono text-gray-500">
                          {{ row.account_code }}
                        </p>
                        <p class="text-[15px] font-bold text-text-primary">
                          {{ row.account_name }}
                        </p>
                      </div>
                      <div class="text-right">
                        <p
                          class="text-[10px] font-bold uppercase text-gray-500"
                        >
                          D: {{ row.debit_total | number: '1.2-2' }}
                        </p>
                        <p
                          class="text-[10px] font-bold uppercase text-gray-500"
                        >
                          C: {{ row.credit_total | number: '1.2-2' }}
                        </p>
                        <p
                          class="text-sm font-bold font-mono"
                          [class]="
                            row.balance >= 0 ? 'text-blue-600' : 'text-red-600'
                          "
                        >
                          {{ row.balance | number: '1.2-2' }}
                        </p>
                      </div>
                    </div>
                  </div>
                  <!-- Desktop -->
                  <div
                    class="hidden md:grid md:grid-cols-12 gap-2 px-4 py-2 items-center hover:bg-gray-50 transition-colors"
                  >
                    <div class="col-span-2 text-sm font-mono text-gray-600">
                      {{ row.account_code }}
                    </div>
                    <div class="col-span-4 text-sm">{{ row.account_name }}</div>
                    <div class="col-span-1 text-xs text-gray-500 capitalize">
                      {{ row.account_type }}
                    </div>
                    <div class="col-span-2 text-right text-sm font-mono">
                      {{ row.debit_total | number: '1.2-2' }}
                    </div>
                    <div class="col-span-2 text-right text-sm font-mono">
                      {{ row.credit_total | number: '1.2-2' }}
                    </div>
                    <div
                      class="col-span-1 text-right text-sm font-mono font-bold"
                      [class]="
                        row.balance >= 0 ? 'text-blue-600' : 'text-red-600'
                      "
                    >
                      {{ row.balance | number: '1.2-2' }}
                    </div>
                  </div>
                }
              </div>

              <!-- Totals -->
              <div
                class="grid grid-cols-12 gap-2 px-4 py-3 bg-gray-50 rounded-lg mt-2"
              >
                <div class="col-span-7 text-sm font-bold text-text-primary">
                  TOTALES
                </div>
                <div class="col-span-2 text-right text-sm font-mono font-bold">
                  {{ report.total_debit | number: '1.2-2' }}
                </div>
                <div class="col-span-2 text-right text-sm font-mono font-bold">
                  {{ report.total_credit | number: '1.2-2' }}
                </div>
                <div class="col-span-1"></div>
              </div>
            }
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
export class TrialBalanceComponent implements OnInit {
  private store = inject(Store);

  report$: Observable<TrialBalanceReport | null> =
    this.store.select(selectTrialBalance);
  loading$: Observable<boolean> = this.store.select(selectReportLoading);
  periods$: Observable<FiscalPeriod[]> = this.store.select(selectFiscalPeriods);

  period_options: { value: any; label: string }[] = [];
  selected_period_id: number | null = null;

  ngOnInit(): void {
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
        loadTrialBalance({
          query: { fiscal_period_id: this.selected_period_id },
        }),
      );
    }
  }
}
