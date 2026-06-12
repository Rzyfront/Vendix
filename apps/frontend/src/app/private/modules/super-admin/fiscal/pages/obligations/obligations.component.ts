import { DatePipe, UpperCasePipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import {
  BadgeComponent,
  BadgeVariant,
  CardComponent,
  EmptyStateComponent,
  ItemListCardConfig,
  ModalComponent,
  ResponsiveDataViewComponent,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
  StickyHeaderComponent,
  TableAction,
  TableColumn,
} from '../../../../../../shared/components';
import { CurrencyFormatService, CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { Obligation, ObligationStatus } from '../../interfaces/superadmin-fiscal.interface';
import { SuperadminFiscalService } from '../../services/superadmin-fiscal.service';

const STATUS_VARIANTS: Record<ObligationStatus, BadgeVariant> = {
  pending: 'neutral',
  due_soon: 'warning',
  filed: 'success',
  submitted: 'success',
  overdue: 'error',
  not_applicable: 'neutral',
};

const STATUS_LABELS: Record<ObligationStatus, string> = {
  pending: 'Pendiente',
  due_soon: 'Por vencer',
  filed: 'Presentada',
  submitted: 'Enviada',
  overdue: 'Vencida',
  not_applicable: 'N/A',
};

@Component({
  selector: 'app-fiscal-obligations',
  standalone: true,
  imports: [
    DatePipe,
    UpperCasePipe,
    FormsModule,
    CurrencyPipe,
    StickyHeaderComponent,
    BadgeComponent,
    CardComponent,
    EmptyStateComponent,
    ModalComponent,
    ResponsiveDataViewComponent,
    SelectorComponent,
    SpinnerComponent,
  ],
  template: `
    <div class="w-full">
      <app-sticky-header
        title="Obligaciones Fiscales"
        subtitle="IVA, retefuente, ICA, exógena y otras obligaciones tributarias"
        icon="alert-circle"
      />

      <div class="px-2 md:px-4 pt-2 pb-4 space-y-4">
        <app-card [responsive]="true" [padding]="false" customClasses="!p-0">
          <div class="px-2 py-2 md:px-4 md:py-3 border-b border-border">
            <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
              <h2 class="text-[13px] font-semibold text-text-secondary tracking-wide md:text-lg md:font-semibold md:text-text-primary md:tracking-normal">
                Periodo
                <span class="font-normal text-text-secondary/50 md:font-semibold md:text-text-primary">
                  {{ period() }}
                </span>
              </h2>
              <div class="w-full md:w-56">
                <app-selector
                  size="sm"
                  variant="outline"
                  label="Periodo (YYYY-MM)"
                  [options]="periodOptions()"
                  [ngModel]="period()"
                  (ngModelChange)="onPeriodChange($any($event))"
                />
              </div>
            </div>
          </div>

          @if (loading()) {
            <div class="p-4 md:p-6 text-center">
              <app-spinner size="md" label="Cargando obligaciones…"></app-spinner>
            </div>
          }

          @if (!loading() && obligations().length === 0) {
            <app-empty-state
              icon="alert-circle"
              title="Sin obligaciones"
              description="No hay obligaciones fiscales registradas para el periodo seleccionado."
              [showActionButton]="false"
            />
          }

          @if (!loading() && obligations().length > 0) {
            <div class="px-2 pb-2 pt-2 md:p-4">
              <app-responsive-data-view
                [data]="obligations()"
                [columns]="columns"
                [cardConfig]="cardConfig"
                [actions]="actions"
                [loading]="loading()"
                [sortable]="true"
                (rowClick)="onRowClick($any($event))"
                (actionClick)="onActionClick($any($event))"
              />
            </div>
          }
        </app-card>
      </div>
    </div>

    <!-- Detail modal (V1: payload read-only) -->
    <app-modal
      [isOpen]="modalOpen()"
      [title]="selected()?.name ?? 'Detalle de obligación'"
      [subtitle]="selected()?.period ?? ''"
      size="md"
      (closed)="closeModal()"
    >
      @if (selected(); as item) {
        <dl class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div>
            <dt class="text-text-secondary text-xs uppercase tracking-wide">Tipo</dt>
            <dd class="font-mono">{{ item.form_type | uppercase }}</dd>
          </div>
          <div>
            <dt class="text-text-secondary text-xs uppercase tracking-wide">Periodo</dt>
            <dd class="font-mono">{{ item.period }}</dd>
          </div>
          <div>
            <dt class="text-text-secondary text-xs uppercase tracking-wide">Vencimiento</dt>
            <dd class="font-mono">{{ item.due_date | date: 'dd MMM yyyy' : 'UTC' }}</dd>
          </div>
          <div>
            <dt class="text-text-secondary text-xs uppercase tracking-wide">Monto</dt>
            <dd class="font-mono">{{ toNumber(item.amount) | currency }}</dd>
          </div>
          <div class="md:col-span-2">
            <dt class="text-text-secondary text-xs uppercase tracking-wide">Estado</dt>
            <dd>
              <app-badge [variant]="statusVariant(item.status)">
                {{ statusLabel(item.status) }}
              </app-badge>
            </dd>
          </div>
          @if (item.notes) {
            <div class="md:col-span-2">
              <dt class="text-text-secondary text-xs uppercase tracking-wide">Notas</dt>
              <dd class="text-text-primary">{{ item.notes }}</dd>
            </div>
          }
        </dl>
      }
    </app-modal>
  `,
})
export class ObligationsComponent {
  private readonly api = inject(SuperadminFiscalService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currencyFormat = inject(CurrencyFormatService);

  readonly obligations = signal<Obligation[]>([]);
  readonly loading = signal<boolean>(false);
  readonly modalOpen = signal<boolean>(false);
  readonly selected = signal<Obligation | null>(null);
  readonly period = signal<string>(this.currentPeriod());

  readonly periodOptions = computed<SelectorOption[]>(() => {
    const list: SelectorOption[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getUTCFullYear(), now.getUTCMonth() - i, 1);
      const value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      list.push({ value, label: value });
    }
    return list;
  });

  readonly columns: TableColumn[] = [
    { key: 'name', label: 'Obligación', sortable: true, priority: 1 },
    {
      key: 'form_type',
      label: 'Tipo',
      sortable: true,
      width: '120px',
      priority: 2,
      transform: (v: string) => (v ?? '').toString().toUpperCase(),
    },
    {
      key: 'period',
      label: 'Periodo',
      width: '110px',
      priority: 1,
    },
    {
      key: 'due_date',
      label: 'Vencimiento',
      sortable: true,
      width: '130px',
      priority: 1,
    },
    {
      key: 'status',
      label: 'Estado',
      width: '140px',
      align: 'center',
      priority: 1,
      transform: (v: ObligationStatus) => this.statusLabel(v),
    },
    {
      key: 'amount',
      label: 'Monto',
      width: '140px',
      align: 'right',
      priority: 1,
      transform: (v: string | number) => this.currencyFormat.format(Number(v ?? 0)),
    },
  ];

  readonly actions: TableAction[] = [
    {
      label: 'Ver detalle',
      icon: 'eye',
      variant: 'info',
      action: (item: Obligation) => this.openModal(item),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'period',
    avatarFallbackIcon: 'alert-circle',
    badgeKey: 'status',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (v: ObligationStatus) => this.statusLabel(v),
    detailKeys: [
      { key: 'form_type', label: 'Tipo' },
      { key: 'due_date', label: 'Vencimiento' },
    ],
  };

  constructor() {
    this.load();
  }

  // ─── Helpers ────────────────────────────────────────────────────────────
  private currentPeriod(): string {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  toNumber(v: string | number | null | undefined): number {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  statusLabel(status: ObligationStatus): string {
    return STATUS_LABELS[status] ?? status;
  }

  statusVariant(status: ObligationStatus): BadgeVariant {
    return STATUS_VARIANTS[status] ?? 'neutral';
  }

  // ─── Loaders ────────────────────────────────────────────────────────────
  private load(): void {
    this.loading.set(true);
    this.api
      .getObligations(this.period())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.obligations.set(list);
          this.loading.set(false);
        },
        error: () => {
          this.obligations.set([]);
          this.loading.set(false);
        },
      });
  }

  // ─── Handlers ───────────────────────────────────────────────────────────
  onPeriodChange(value: string): void {
    this.period.set(value);
    this.load();
  }

  onRowClick(item: Obligation): void {
    this.openModal(item);
  }

  onActionClick(payload: { action: TableAction; item: Obligation }): void {
    this.openModal(payload.item);
  }

  // ─── Modal ──────────────────────────────────────────────────────────────
  openModal(item: Obligation): void {
    this.selected.set(item);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.selected.set(null);
  }
}
