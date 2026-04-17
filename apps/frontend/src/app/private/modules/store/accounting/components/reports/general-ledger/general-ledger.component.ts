import { Component, inject, effect } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable, first } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';

import {
  FiscalPeriod,
  GeneralLedgerReport,
} from '../../../interfaces/accounting.interface';
import {
  selectGeneralLedger,
  selectReportLoading,
  selectFiscalPeriods,
} from '../../../state/selectors/accounting.selectors';
import { loadGeneralLedger } from '../../../state/actions/accounting.actions';
import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  SelectorComponent,
} from '../../../../../../../shared/components/index';

@Component({
  selector: 'vendix-general-ledger',
  standalone: true,
  imports: [
    DatePipe,
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
              Libro Mayor
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
            @if (report.accounts.length === 0) {
              <div
                class="flex flex-col items-center justify-center py-16 text-gray-400"
              >
                <app-icon name="book" [size]="48"></app-icon>
                <p class="mt-4">No hay movimientos para este periodo</p>
              </div>
            } @else {
              <div class="space-y-4">
                @for (account of report.accounts; track account.account_id) {
                  <div
                    class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)]
                              border border-border overflow-hidden"
                  >
                    <!-- Account Header -->
                    <div
                      class="px-4 py-3 bg-gray-50 border-b border-border cursor-pointer"
                      (click)="toggleAccount(account.account_id)"
                    >
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                          <app-icon
                            [name]="
                              isAccountExpanded(account.account_id)
                                ? 'chevron-down'
                                : 'chevron-right'
                            "
                            [size]="16"
                          ></app-icon>
                          <span class="text-sm font-mono text-gray-500">{{
                            account.account_code
                          }}</span>
                          <span class="text-sm font-bold text-text-primary">{{
                            account.account_name
                          }}</span>
                        </div>
                        <div
                          class="flex items-center gap-4 text-xs text-gray-500"
                        >
                          <span
                            >Saldo Inicial:
                            {{
                              account.opening_balance | number: '1.2-2'
                            }}</span
                          >
                          <span class="font-bold text-text-primary">
                            Saldo Final:
                            {{ account.closing_balance | number: '1.2-2' }}
                          </span>
                        </div>
                      </div>
                    </div>

                    <!-- Account Entries (collapsible) -->
                    @if (isAccountExpanded(account.account_id)) {
                      <!-- Table Header -->
                      <div
                        class="hidden md:grid md:grid-cols-12 gap-2 px-4 py-2 bg-gray-50/50
                                  text-xs font-semibold text-gray-500 uppercase border-b border-border"
                      >
                        <div class="col-span-2">Fecha</div>
                        <div class="col-span-2">Asiento #</div>
                        <div class="col-span-3">Descripción</div>
                        <div class="col-span-2 text-right">Débito</div>
                        <div class="col-span-2 text-right">Crédito</div>
                        <div class="col-span-1 text-right">Saldo</div>
                      </div>

                      <div class="divide-y divide-border">
                        @for (entry of account.entries; track $index) {
                          <!-- Mobile -->
                          <div class="md:hidden p-3">
                            <div class="flex justify-between items-start">
                              <div>
                                <p class="text-xs text-gray-500">
                                  {{ entry.entry_date | date: 'shortDate' }} -
                                  {{ entry.entry_number }}
                                </p>
                                <p class="text-sm">{{ entry.description }}</p>
                              </div>
                              <div class="text-right">
                                @if (entry.debit_amount > 0) {
                                  <p class="text-xs text-blue-600">
                                    D:
                                    {{ entry.debit_amount | number: '1.2-2' }}
                                  </p>
                                }
                                @if (entry.credit_amount > 0) {
                                  <p class="text-xs text-green-600">
                                    C:
                                    {{ entry.credit_amount | number: '1.2-2' }}
                                  </p>
                                }
                                <p class="text-sm font-bold font-mono">
                                  {{ entry.running_balance | number: '1.2-2' }}
                                </p>
                              </div>
                            </div>
                          </div>
                          <!-- Desktop -->
                          <div
                            class="hidden md:grid md:grid-cols-12 gap-2 px-4 py-2 items-center hover:bg-gray-50 transition-colors"
                          >
                            <div class="col-span-2 text-sm text-gray-600">
                              {{ entry.entry_date | date: 'shortDate' }}
                            </div>
                            <div
                              class="col-span-2 text-sm font-mono text-gray-500"
                            >
                              {{ entry.entry_number }}
                            </div>
                            <div class="col-span-3 text-sm truncate">
                              {{ entry.description }}
                            </div>
                            <div
                              class="col-span-2 text-right text-sm font-mono"
                            >
                              {{
                                entry.debit_amount > 0
                                  ? (entry.debit_amount | number: '1.2-2')
                                  : '-'
                              }}
                            </div>
                            <div
                              class="col-span-2 text-right text-sm font-mono"
                            >
                              {{
                                entry.credit_amount > 0
                                  ? (entry.credit_amount | number: '1.2-2')
                                  : '-'
                              }}
                            </div>
                            <div
                              class="col-span-1 text-right text-sm font-mono font-bold"
                            >
                              {{ entry.running_balance | number: '1.2-2' }}
                            </div>
                          </div>
                        }
                      </div>
                    }
                  </div>
                }
              </div>
            }
          } @else {
            <div
              class="flex flex-col items-center justify-center py-16 text-gray-400"
            >
              <app-icon name="book" [size]="48"></app-icon>
              <p class="mt-4">Selecciona un periodo para generar el reporte</p>
            </div>
          }
        </div>
      </app-card>
    </div>
  `,
})
export class GeneralLedgerComponent {
  private store = inject(Store);

  // Signal-based state
  readonly report = toSignal(this.store.select(selectGeneralLedger), {
    initialValue: null as GeneralLedgerReport | null,
  });
  readonly loading = toSignal(this.store.select(selectReportLoading), {
    initialValue: false,
  });
  readonly periods = toSignal(this.store.select(selectFiscalPeriods), {
    initialValue: [] as FiscalPeriod[],
  });

  period_options: { value: any; label: string }[] = [];
  selected_period_id: number | null = null;
  expanded_account_ids = new Set<number>();

  constructor() {
    // Initialize period options when periods are loaded
    effect(() => {
      const periods = this.periods();
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
        loadGeneralLedger({
          query: { fiscal_period_id: this.selected_period_id },
        }),
      );
    }
  }

  toggleAccount(id: number): void {
    if (this.expanded_account_ids.has(id)) {
      this.expanded_account_ids.delete(id);
    } else {
      this.expanded_account_ids.add(id);
    }
  }

  isAccountExpanded(id: number): boolean {
    return this.expanded_account_ids.has(id);
  }
}
