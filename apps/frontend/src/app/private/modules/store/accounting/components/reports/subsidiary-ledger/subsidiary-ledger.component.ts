import { Component, inject, signal, computed } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { DecimalPipe, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../../../../../environments/environment';
import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  SelectorComponent,
  ResponsiveDataViewComponent,
} from '../../../../../../../shared/components/index';
import type {
  TableColumn,
  ItemListCardConfig,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';

/**
 * Libro auxiliar (art. 48-55 C.Co): dos modos consumen el mismo endpoint
 * GET /store/accounting/reports/subsidiary-ledger — por rango de cuenta
 * (jerárquico padre+hijas) o por tercero (snapshot histórico third_party_*).
 * Ver AccountingReportsService.getSubsidiaryLedgerByAccountRange /
 * getSubsidiaryLedgerByThirdParty (C4, Ola 3).
 */
interface SubsidiaryLedgerLine {
  line_id: number;
  entry_id: number;
  entry_number: string;
  entry_date: string;
  entry_description: string | null;
  line_description: string | null;
  debit_amount: number;
  credit_amount: number;
  running_balance: number;
  third_party_id?: number | null;
  third_party_type?: string | null;
  third_party_name?: string | null;
  third_party_tax_id?: string | null;
  account_code?: string;
  account_name?: string;
}

interface SubsidiaryLedgerAccountGroup {
  account_id: number;
  account_code: string;
  account_name: string;
  nature: string;
  is_parent: boolean;
  lines: SubsidiaryLedgerLine[];
  total_debit: number;
  total_credit: number;
  closing_balance: number;
}

interface SubsidiaryLedgerByAccountResponse {
  parent_account: { id: number; code: string; name: string };
  accounts: SubsidiaryLedgerAccountGroup[];
  grand_total: { total_debit: number; total_credit: number; closing_balance: number };
}

interface SubsidiaryLedgerByThirdPartyResponse {
  third_party: {
    type: string;
    id: number;
    name: string | null;
    tax_id: string | null;
  };
  lines: SubsidiaryLedgerLine[];
  totals: { total_debit: number; total_credit: number; final_balance: number };
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

type LedgerMode = 'account' | 'third_party';

@Component({
  selector: 'vendix-subsidiary-ledger',
  standalone: true,
  imports: [
    DecimalPipe,
    NgClass,
    FormsModule,
    ButtonComponent,
    CardComponent,
    IconComponent,
    SelectorComponent,
    ResponsiveDataViewComponent,
  ],
  template: `
    <div class="w-full">
      <app-card [responsive]="true" [padding]="false" customClasses="md:min-h-[400px]">
        <!-- Header -->
        <div
          class="sticky top-0 z-10 bg-background px-2 py-1.5 -mt-[5px]
                    md:mt-0 md:static md:bg-transparent md:px-4 md:py-4 md:border-b md:border-border"
        >
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <h2
                class="text-[13px] font-bold text-gray-600 tracking-wide
                         md:text-lg md:font-semibold md:text-text-primary"
              >
                Libro Auxiliar
              </h2>
              <app-button variant="outline" size="sm" (clicked)="loadReport()">
                <app-icon name="refresh-cw" [size]="14" slot="icon"></app-icon>
              </app-button>
            </div>

            <!-- Mode tabs -->
            <div class="flex gap-2">
              <button
                type="button"
                class="px-3 py-1.5 text-xs rounded-lg font-medium transition-colors"
                [ngClass]="
                  mode() === 'account'
                    ? 'bg-primary text-[var(--color-text-on-primary)]'
                    : 'bg-[var(--color-surface-secondary)] text-gray-600'
                "
                (click)="setMode('account')"
              >
                Por cuenta
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-xs rounded-lg font-medium transition-colors"
                [ngClass]="
                  mode() === 'third_party'
                    ? 'bg-primary text-[var(--color-text-on-primary)]'
                    : 'bg-[var(--color-surface-secondary)] text-gray-600'
                "
                (click)="setMode('third_party')"
              >
                Por tercero
              </button>
            </div>

            <!-- Filters -->
            <div class="flex flex-col md:flex-row gap-2 md:items-end">
              @if (mode() === 'account') {
                <div class="flex-1">
                  <label class="text-xs text-text-secondary block mb-1">Código de cuenta (PUC)</label>
                  <input
                    type="text"
                    class="w-full px-3 py-2 text-sm border border-border rounded-lg"
                    placeholder="Ej. 1435"
                    [value]="accountCode()"
                    (input)="accountCode.set($any($event.target).value)"
                  />
                </div>
              } @else {
                <div class="flex-1">
                  <label class="text-xs text-text-secondary block mb-1">Tipo de tercero</label>
                  <app-selector
                    [options]="thirdPartyTypeOptions"
                    [ngModel]="thirdPartyType()"
                    placeholder="Seleccionar..."
                    (valueChange)="thirdPartyType.set($event ? String($event) : null)"
                  ></app-selector>
                </div>
                <div class="flex-1">
                  <label class="text-xs text-text-secondary block mb-1">ID del tercero</label>
                  <input
                    type="number"
                    class="w-full px-3 py-2 text-sm border border-border rounded-lg"
                    placeholder="Ej. 42"
                    [value]="thirdPartyId() ?? ''"
                    (input)="thirdPartyId.set($any($event.target).value ? Number($any($event.target).value) : null)"
                  />
                </div>
              }
              <div class="flex-1">
                <label class="text-xs text-text-secondary block mb-1">Desde</label>
                <input
                  type="date"
                  class="w-full px-3 py-2 text-sm border border-border rounded-lg"
                  [value]="dateFrom() ?? ''"
                  (input)="dateFrom.set($any($event.target).value || null)"
                />
              </div>
              <div class="flex-1">
                <label class="text-xs text-text-secondary block mb-1">Hasta</label>
                <input
                  type="date"
                  class="w-full px-3 py-2 text-sm border border-border rounded-lg"
                  [value]="dateTo() ?? ''"
                  (input)="dateTo.set($any($event.target).value || null)"
                />
              </div>
              <app-button variant="primary" size="sm" (clicked)="loadReport()" [disabled]="!canQuery()">
                Consultar
              </app-button>
            </div>
          </div>
        </div>

        <!-- Content -->
        <div class="relative p-2 md:p-4">
          @if (loading()) {
            <div class="absolute inset-0 bg-[color-mix(in_srgb,var(--color-surface)_50%,transparent)] z-10 flex items-center justify-center">
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary)]"></div>
            </div>
          }

          @if (errorMessage(); as err) {
            <div class="flex flex-col items-center justify-center py-10 text-error">
              <app-icon name="alert-triangle" [size]="32"></app-icon>
              <p class="mt-2 text-sm">{{ err }}</p>
            </div>
          } @else if (mode() === 'account' && accountReport(); as report) {
            <div class="mb-3 text-sm text-gray-600">
              Cuenta padre: <span class="font-mono font-bold">{{ report.parent_account.code }}</span>
              — {{ report.parent_account.name }}
            </div>
            <div class="space-y-4">
              @for (group of report.accounts; track group.account_id) {
                <div class="bg-[var(--color-surface)] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] border border-border overflow-hidden">
                  <div
                    class="px-4 py-3 bg-[var(--color-surface-secondary)] border-b border-border cursor-pointer"
                    (click)="toggleGroup(group.account_id)"
                  >
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        <app-icon
                          [name]="isGroupExpanded(group.account_id) ? 'chevron-down' : 'chevron-right'"
                          [size]="16"
                        ></app-icon>
                        <span class="text-sm font-mono text-text-secondary">{{ group.account_code }}</span>
                        <span class="text-sm font-bold text-text-primary">{{ group.account_name }}</span>
                        @if (group.is_parent) {
                          <span class="text-[10px] uppercase tracking-wide text-[var(--color-primary)] bg-[var(--color-primary-light)] px-1.5 py-0.5 rounded">
                            Padre
                          </span>
                        }
                      </div>
                      <span class="text-sm font-bold font-mono">
                        {{ group.closing_balance | number: '1.2-2' }}
                      </span>
                    </div>
                  </div>

                  @if (isGroupExpanded(group.account_id)) {
                    <app-responsive-data-view
                      [data]="group.lines"
                      [columns]="lineColumns"
                      [cardConfig]="lineCardConfig"
                      [loading]="false"
                      emptyMessage="Sin movimientos para esta cuenta"
                    ></app-responsive-data-view>
                  }
                </div>
              }
            </div>
          } @else if (mode() === 'third_party' && thirdPartyReport(); as report) {
            <div class="mb-3 text-sm text-gray-600">
              Tercero: <span class="font-bold">{{ report.third_party.name || '(sin nombre en snapshot)' }}</span>
              @if (report.third_party.tax_id) {
                <span class="font-mono text-text-secondary"> — {{ report.third_party.tax_id }}</span>
              }
            </div>
            <app-responsive-data-view
              [data]="report.lines"
              [columns]="thirdPartyLineColumns"
              [cardConfig]="lineCardConfig"
              [loading]="false"
              emptyMessage="Sin movimientos para este tercero"
            ></app-responsive-data-view>
            <div class="mt-3 flex justify-end gap-4 text-sm font-mono">
              <span>Débito: {{ report.totals.total_debit | number: '1.2-2' }}</span>
              <span>Crédito: {{ report.totals.total_credit | number: '1.2-2' }}</span>
              <span class="font-bold">Saldo: {{ report.totals.final_balance | number: '1.2-2' }}</span>
            </div>
          } @else {
            <div class="flex flex-col items-center justify-center py-16 text-text-secondary">
              <app-icon name="book-open" [size]="48"></app-icon>
              <p class="mt-4">Completa los filtros y presiona Consultar</p>
            </div>
          }
        </div>
      </app-card>
    </div>
  `,
})
export class SubsidiaryLedgerComponent {
  private readonly http = inject(HttpClient);
  private readonly currencyFormat = inject(CurrencyFormatService);

  protected readonly Number = Number;
  protected readonly String = String;

  readonly mode = signal<LedgerMode>('account');
  readonly accountCode = signal('');
  readonly thirdPartyType = signal<string | null>(null);
  readonly thirdPartyId = signal<number | null>(null);
  readonly dateFrom = signal<string | null>(null);
  readonly dateTo = signal<string | null>(null);

  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly accountReport = signal<SubsidiaryLedgerByAccountResponse | null>(null);
  readonly thirdPartyReport = signal<SubsidiaryLedgerByThirdPartyResponse | null>(null);
  readonly expandedAccountIds = signal(new Set<number>());

  readonly thirdPartyTypeOptions = [
    { value: 'customer', label: 'Cliente' },
    { value: 'supplier', label: 'Proveedor' },
    { value: 'employee', label: 'Empleado' },
  ];

  readonly canQuery = computed(() => {
    if (this.mode() === 'account') {
      return this.accountCode().trim().length > 0;
    }
    return !!this.thirdPartyType() && this.thirdPartyId() != null;
  });

  readonly lineColumns: TableColumn[] = [
    { key: 'entry_date', label: 'Fecha', transform: (v) => (v ? formatDateOnlyUTC(v) : '-') },
    { key: 'entry_number', label: 'Asiento #' },
    { key: 'line_description', label: 'Descripción', defaultValue: '-' },
    {
      key: 'debit_amount',
      label: 'Débito',
      align: 'right',
      transform: (v) => (Number(v) > 0 ? this.currencyFormat.format(Number(v)) : '-'),
    },
    {
      key: 'credit_amount',
      label: 'Crédito',
      align: 'right',
      transform: (v) => (Number(v) > 0 ? this.currencyFormat.format(Number(v)) : '-'),
    },
    {
      key: 'running_balance',
      label: 'Saldo',
      align: 'right',
      transform: (v) => this.currencyFormat.format(Number(v)),
    },
  ];

  readonly thirdPartyLineColumns: TableColumn[] = [
    { key: 'entry_date', label: 'Fecha', transform: (v) => (v ? formatDateOnlyUTC(v) : '-') },
    { key: 'account_code', label: 'Cuenta' },
    { key: 'account_name', label: 'Nombre cuenta' },
    { key: 'entry_number', label: 'Asiento #' },
    {
      key: 'debit_amount',
      label: 'Débito',
      align: 'right',
      transform: (v) => (Number(v) > 0 ? this.currencyFormat.format(Number(v)) : '-'),
    },
    {
      key: 'credit_amount',
      label: 'Crédito',
      align: 'right',
      transform: (v) => (Number(v) > 0 ? this.currencyFormat.format(Number(v)) : '-'),
    },
    {
      key: 'running_balance',
      label: 'Saldo',
      align: 'right',
      transform: (v) => this.currencyFormat.format(Number(v)),
    },
  ];

  readonly lineCardConfig: ItemListCardConfig = {
    titleKey: 'entry_number',
    subtitleKey: 'line_description',
    detailKeys: [
      { key: 'debit_amount', label: 'Débito', icon: 'arrow-down-circle' },
      { key: 'credit_amount', label: 'Crédito', icon: 'arrow-up-circle' },
    ],
    footerKey: 'running_balance',
    footerLabel: 'Saldo',
  };

  setMode(mode: LedgerMode): void {
    this.mode.set(mode);
    this.errorMessage.set(null);
    this.accountReport.set(null);
    this.thirdPartyReport.set(null);
  }

  toggleGroup(id: number): void {
    const expanded = new Set(this.expandedAccountIds());
    if (expanded.has(id)) {
      expanded.delete(id);
    } else {
      expanded.add(id);
    }
    this.expandedAccountIds.set(expanded);
  }

  isGroupExpanded(id: number): boolean {
    return this.expandedAccountIds().has(id);
  }

  async loadReport(): Promise<void> {
    if (!this.canQuery()) return;

    this.loading.set(true);
    this.errorMessage.set(null);

    let params = new HttpParams();
    if (this.dateFrom()) params = params.set('date_from', this.dateFrom()!);
    if (this.dateTo()) params = params.set('date_to', this.dateTo()!);

    try {
      if (this.mode() === 'account') {
        params = params.set('account_code', this.accountCode().trim());
        const response = await firstValueFrom(
          this.http.get<ApiResponse<SubsidiaryLedgerByAccountResponse>>(
            `${environment.apiUrl}/store/accounting/reports/subsidiary-ledger`,
            { params },
          ),
        );
        this.accountReport.set(response.data);
        this.expandedAccountIds.set(new Set([response.data.parent_account.id]));
      } else {
        params = params
          .set('third_party_type', this.thirdPartyType()!)
          .set('third_party_id', String(this.thirdPartyId()));
        const response = await firstValueFrom(
          this.http.get<ApiResponse<SubsidiaryLedgerByThirdPartyResponse>>(
            `${environment.apiUrl}/store/accounting/reports/subsidiary-ledger`,
            { params },
          ),
        );
        this.thirdPartyReport.set(response.data);
      }
    } catch (err: any) {
      this.errorMessage.set(
        err?.error?.message || 'No se pudo cargar el libro auxiliar',
      );
    } finally {
      this.loading.set(false);
    }
  }
}
