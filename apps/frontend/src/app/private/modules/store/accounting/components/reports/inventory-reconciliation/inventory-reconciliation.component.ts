import { Component, inject, signal, computed } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../../../../../environments/environment';
import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  ResponsiveDataViewComponent,
} from '../../../../../../../shared/components/index';
import type {
  TableColumn,
  ItemListCardConfig,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';

/**
 * Conciliación 1435 vs inventario (C5, Ola 3) — papel de trabajo de
 * auditoría READ-ONLY. Consume GET
 * /store/accounting/reports/inventory-reconciliation. No persiste nada, no
 * hay sesión de conciliación: compara el último snapshot de
 * inventory_valuation_snapshots (por location/product/variant, snapshot_at
 * <= period_end) contra el saldo de 1435 + descendientes agrupado por
 * accounting_entity_id, y ofrece drill-down de los asientos que tocan
 * 1435* en el período.
 */
interface InventorySnapshotLine {
  location_id: number;
  location_name: string | null;
  product_id: number;
  product_name: string | null;
  product_sku: string | null;
  product_variant_id: number | null;
  product_variant_name: string | null;
  snapshot_at: string;
  quantity_on_hand: number;
  unit_cost: number;
  total_value: number;
  costing_method: string;
}

interface AccountingSideAccount {
  account_id: number;
  account_code: string;
  account_name: string;
  total_debit: number;
  total_credit: number;
  balance: number;
}

interface EntryDetailLine {
  line_id: number;
  entry_id: number;
  entry_number: string;
  entry_date: string;
  entry_description: string | null;
  entry_type: string;
  source_type: string | null;
  source_id: number | null;
  store: { id: number; name: string } | null;
  account_code: string;
  account_name: string;
  line_description: string | null;
  debit_amount: number;
  credit_amount: number;
}

interface InventoryReconciliationResponse {
  fiscal_period: {
    id: number;
    name: string;
    start_date: string;
    end_date: string;
  };
  accounting_entity_id: number;
  period_end: string;
  inventory_side: {
    total_value: number;
    snapshot_count: number;
    snapshots: InventorySnapshotLine[];
  };
  accounting_side: {
    total_balance: number;
    accounts: AccountingSideAccount[];
  };
  difference: number;
  is_reconciled: boolean;
  entries_detail: EntryDetailLine[];
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

@Component({
  selector: 'vendix-inventory-reconciliation',
  standalone: true,
  imports: [
    DecimalPipe,
    FormsModule,
    ButtonComponent,
    CardComponent,
    IconComponent,
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
                Conciliación Inventario vs 1435
              </h2>
              <app-button variant="outline" size="sm" (clicked)="loadReport()">
                <app-icon name="refresh-cw" [size]="14" slot="icon"></app-icon>
              </app-button>
            </div>

            <p class="text-xs text-text-secondary">
              Papel de trabajo de auditoría (read-only): último snapshot de
              inventario por bodega/producto vs saldo contable de la cuenta
              1435 y sus subcuentas, a la fecha de cierre del período.
            </p>

            <!-- Filters -->
            <div class="flex flex-col md:flex-row gap-2 md:items-end">
              <div class="flex-1">
                <label class="text-xs text-text-secondary block mb-1">Período fiscal (ID)</label>
                <input
                  type="number"
                  class="w-full px-3 py-2 text-sm border border-border rounded-lg"
                  placeholder="Ej. 12"
                  [value]="fiscalPeriodId() ?? ''"
                  (input)="fiscalPeriodId.set($any($event.target).value ? Number($any($event.target).value) : null)"
                />
              </div>
              <div class="flex-1">
                <label class="text-xs text-text-secondary block mb-1">
                  Entidad contable (opcional — por defecto la del período)
                </label>
                <input
                  type="number"
                  class="w-full px-3 py-2 text-sm border border-border rounded-lg"
                  placeholder="Ej. 1"
                  [value]="accountingEntityId() ?? ''"
                  (input)="accountingEntityId.set($any($event.target).value ? Number($any($event.target).value) : null)"
                />
              </div>
              <app-button variant="primary" size="sm" (clicked)="loadReport()" [disabled]="!canQuery()">
                Conciliar
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
          } @else if (report(); as r) {
            <!-- Summary cards -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <div class="bg-[var(--color-surface)] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] border border-border p-4">
                <p class="text-xs text-text-secondary mb-1">Según snapshots de inventario</p>
                <p class="text-lg font-bold font-mono">{{ r.inventory_side.total_value | number: '1.2-2' }}</p>
                <p class="text-[11px] text-text-secondary mt-1">{{ r.inventory_side.snapshot_count }} combinación(es) bodega/producto</p>
              </div>
              <div class="bg-[var(--color-surface)] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] border border-border p-4">
                <p class="text-xs text-text-secondary mb-1">Según cuenta 1435 (mayor)</p>
                <p class="text-lg font-bold font-mono">{{ r.accounting_side.total_balance | number: '1.2-2' }}</p>
                <p class="text-[11px] text-text-secondary mt-1">{{ r.accounting_side.accounts.length }} cuenta(s)</p>
              </div>
              <div
                class="rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] border p-4"
                [class.bg-success-light]="r.is_reconciled"
                [class.border-success]="r.is_reconciled"
                [class.bg-error-light]="!r.is_reconciled"
                [class.border-error]="!r.is_reconciled"
              >
                <p class="text-xs text-text-secondary mb-1">Diferencia</p>
                <p
                  class="text-lg font-bold font-mono"
                  [class.text-success]="r.is_reconciled"
                  [class.text-error]="!r.is_reconciled"
                >
                  {{ r.difference | number: '1.2-2' }}
                </p>
                <p class="text-[11px] mt-1" [class.text-success]="r.is_reconciled" [class.text-error]="!r.is_reconciled">
                  {{ r.is_reconciled ? 'Conciliado' : 'Descuadre — revisar drill-down' }}
                </p>
              </div>
            </div>

            <div class="text-xs text-text-secondary mb-4 flex flex-wrap gap-x-4 gap-y-1">
              <span>Entidad contable: <span class="font-mono font-bold text-text-primary">{{ r.accounting_entity_id }}</span></span>
              <span>Corte (period_end): <span class="font-mono font-bold text-text-primary">{{ formatDate(r.period_end) }}</span></span>
              <span>Período: <span class="font-bold text-text-primary">{{ r.fiscal_period.name }}</span></span>
            </div>

            <!-- Inventory snapshots detail -->
            <div class="mb-6">
              <h3 class="text-sm font-bold text-text-primary mb-2">Snapshots usados (fecha de corte auditable)</h3>
              <app-responsive-data-view
                [data]="r.inventory_side.snapshots"
                [columns]="snapshotColumns"
                [cardConfig]="snapshotCardConfig"
                [loading]="false"
                emptyMessage="Sin snapshots de inventario para esta entidad/fecha"
              ></app-responsive-data-view>
            </div>

            <!-- Accounting accounts breakdown -->
            <div class="mb-6">
              <h3 class="text-sm font-bold text-text-primary mb-2">Cuentas 1435 y descendientes</h3>
              <app-responsive-data-view
                [data]="r.accounting_side.accounts"
                [columns]="accountColumns"
                [cardConfig]="accountCardConfig"
                [loading]="false"
                emptyMessage="Sin cuentas 1435 configuradas para esta entidad"
              ></app-responsive-data-view>
            </div>

            <!-- Journal entries drill-down -->
            <div>
              <h3 class="text-sm font-bold text-text-primary mb-2">
                Drill-down: asientos que tocan 1435* en el período ({{ r.entries_detail.length }})
              </h3>
              <app-responsive-data-view
                [data]="r.entries_detail"
                [columns]="entryColumns"
                [cardConfig]="entryCardConfig"
                [loading]="false"
                emptyMessage="Sin movimientos contables en 1435* para este período"
              ></app-responsive-data-view>
            </div>
          } @else {
            <div class="flex flex-col items-center justify-center py-16 text-text-secondary">
              <app-icon name="scale" [size]="48"></app-icon>
              <p class="mt-4">Ingresa un período fiscal y presiona Conciliar</p>
            </div>
          }
        </div>
      </app-card>
    </div>
  `,
})
export class InventoryReconciliationComponent {
  private readonly http = inject(HttpClient);
  private readonly currencyFormat = inject(CurrencyFormatService);

  protected readonly Number = Number;

  readonly fiscalPeriodId = signal<number | null>(null);
  readonly accountingEntityId = signal<number | null>(null);

  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly report = signal<InventoryReconciliationResponse | null>(null);

  readonly canQuery = computed(() => this.fiscalPeriodId() != null);

  readonly snapshotColumns: TableColumn[] = [
    { key: 'location_name', label: 'Bodega', defaultValue: '-' },
    { key: 'product_name', label: 'Producto', defaultValue: '-' },
    { key: 'product_variant_name', label: 'Variante', defaultValue: '-' },
    {
      key: 'snapshot_at',
      label: 'Snapshot usado',
      transform: (v) => (v ? new Date(v).toLocaleString() : '-'),
    },
    {
      key: 'quantity_on_hand',
      label: 'Cantidad',
      align: 'right',
      transform: (v) => Number(v).toFixed(2),
    },
    {
      key: 'unit_cost',
      label: 'Costo unitario',
      align: 'right',
      transform: (v) => this.currencyFormat.format(Number(v)),
    },
    {
      key: 'total_value',
      label: 'Valor total',
      align: 'right',
      transform: (v) => this.currencyFormat.format(Number(v)),
    },
  ];

  readonly snapshotCardConfig: ItemListCardConfig = {
    titleKey: 'product_name',
    subtitleKey: 'location_name',
    detailKeys: [
      { key: 'quantity_on_hand', label: 'Cantidad', icon: 'package' },
      { key: 'unit_cost', label: 'Costo unit.', icon: 'dollar-sign' },
    ],
    footerKey: 'total_value',
    footerLabel: 'Valor total',
  };

  readonly accountColumns: TableColumn[] = [
    { key: 'account_code', label: 'Código' },
    { key: 'account_name', label: 'Nombre cuenta' },
    {
      key: 'total_debit',
      label: 'Débito',
      align: 'right',
      transform: (v) => this.currencyFormat.format(Number(v)),
    },
    {
      key: 'total_credit',
      label: 'Crédito',
      align: 'right',
      transform: (v) => this.currencyFormat.format(Number(v)),
    },
    {
      key: 'balance',
      label: 'Saldo',
      align: 'right',
      transform: (v) => this.currencyFormat.format(Number(v)),
    },
  ];

  readonly accountCardConfig: ItemListCardConfig = {
    titleKey: 'account_code',
    subtitleKey: 'account_name',
    detailKeys: [
      { key: 'total_debit', label: 'Débito', icon: 'arrow-down-circle' },
      { key: 'total_credit', label: 'Crédito', icon: 'arrow-up-circle' },
    ],
    footerKey: 'balance',
    footerLabel: 'Saldo',
  };

  readonly entryColumns: TableColumn[] = [
    { key: 'entry_date', label: 'Fecha', transform: (v) => (v ? formatDateOnlyUTC(v) : '-') },
    { key: 'entry_number', label: 'Asiento #' },
    { key: 'account_code', label: 'Cuenta' },
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
  ];

  readonly entryCardConfig: ItemListCardConfig = {
    titleKey: 'entry_number',
    subtitleKey: 'line_description',
    detailKeys: [
      { key: 'debit_amount', label: 'Débito', icon: 'arrow-down-circle' },
      { key: 'credit_amount', label: 'Crédito', icon: 'arrow-up-circle' },
    ],
    footerKey: 'account_code',
    footerLabel: 'Cuenta',
  };

  formatDate(value: string): string {
    return value ? formatDateOnlyUTC(value) : '-';
  }

  async loadReport(): Promise<void> {
    if (!this.canQuery()) return;

    this.loading.set(true);
    this.errorMessage.set(null);

    let params = new HttpParams().set('fiscal_period_id', String(this.fiscalPeriodId()));
    if (this.accountingEntityId() != null) {
      params = params.set('accounting_entity_id', String(this.accountingEntityId()));
    }

    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<InventoryReconciliationResponse>>(
          `${environment.apiUrl}/store/accounting/reports/inventory-reconciliation`,
          { params },
        ),
      );
      this.report.set(response.data);
    } catch (err: any) {
      this.errorMessage.set(
        err?.error?.message || 'No se pudo cargar la conciliación de inventario',
      );
    } finally {
      this.loading.set(false);
    }
  }
}
