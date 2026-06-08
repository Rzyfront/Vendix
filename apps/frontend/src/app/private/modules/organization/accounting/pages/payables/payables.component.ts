import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  Validators,
} from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { OrgCarteraService } from '../../services/org-cartera.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  AccountPayable,
  ApQueryParams,
  CarteraDashboard,
} from '../../../../store/accounting/interfaces/cartera.interface';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import {
  CardComponent,
  StatsComponent,
  InputsearchComponent,
  ResponsiveDataViewComponent,
  OptionsDropdownComponent,
  PaginationComponent,
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  TextareaComponent,
  IconComponent,
  DialogService,
  ToastService,
} from '../../../../../../shared/components/index';
import type {
  TableColumn,
  TableAction,
  ItemListCardConfig,
  FilterConfig,
  FilterValues,
  DropdownAction,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'vendix-org-payables',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    ReactiveFormsModule,
    CardComponent,
    StatsComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    IconComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total Pendiente"
          [value]="formatted_total_pending()"
          smallText="Saldo por pagar"
          iconName="wallet"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="is_loading()"
        ></app-stats>
        <app-stats
          title="Vencido"
          [value]="formatted_total_overdue()"
          smallText="Requiere atencion"
          iconName="alert-triangle"
          iconBgColor="bg-red-100"
          iconColor="text-red-500"
          [loading]="is_loading()"
        ></app-stats>
        <app-stats
          title="Programado"
          [value]="formatted_scheduled()"
          smallText="Proximo a vencer"
          iconName="calendar-clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="is_loading()"
        ></app-stats>
        <app-stats
          title="Pagado este Mes"
          [value]="formatted_paid_this_month()"
          smallText="Total pagado"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="is_loading()"
        ></app-stats>
      </div>

      <app-card [responsive]="true" [padding]="false">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
            <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
              Cuentas por Pagar ({{ meta().total }})
            </h2>

            <div class="flex w-full items-center gap-2 md:w-auto">
              <app-inputsearch
                class="flex-1 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:w-72 md:shadow-none"
                size="sm"
                placeholder="Buscar por documento o proveedor..."
                [debounceTime]="300"
                [ngModel]="search_term()"
                (ngModelChange)="onSearchChange($event)"
              ></app-inputsearch>

              <app-options-dropdown
                class="rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none"
                [filters]="filter_configs"
                [filterValues]="filter_values()"
                [actions]="dropdown_actions"
                [isLoading]="is_loading()"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="onClearFilters()"
              ></app-options-dropdown>
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="payables()"
            [columns]="columns"
            [cardConfig]="card_config"
            [actions]="table_actions"
            [loading]="is_loading()"
            [sortable]="true"
            emptyTitle="No se encontraron cuentas por pagar"
            emptyMessage="No se encontraron cuentas por pagar"
            [emptyDescription]="hasFilters() ? 'Intente ajustar sus términos de búsqueda o filtros.' : 'Las cuentas por pagar se generan automáticamente.'"
            emptyIcon="receipt"
            [showEmptyAction]="false"
            [showEmptyRefresh]="true"
            [showEmptyClearFilters]="hasFilters()"
            (rowClick)="onRowClick($event)"
            (emptyRefreshClick)="reload()"
            (emptyClearFiltersClick)="onClearFilters()"
          ></app-responsive-data-view>

          @if (meta().totalPages > 1) {
            <div class="mt-4 flex justify-center border-t border-border pt-3">
              <app-pagination
                [currentPage]="meta().page"
                [totalPages]="meta().totalPages"
                [total]="meta().total"
                [limit]="meta().limit"
                (pageChange)="onPageChange($event)"
              ></app-pagination>
            </div>
          }
        </div>
      </app-card>
    </div>

    <!-- ══════ DETAIL MODAL ══════ -->
    @defer (when is_detail_modal_open()) {
      <app-modal
        [isOpen]="is_detail_modal_open()"
        (isOpenChange)="is_detail_modal_open.set($event)"
        (cancel)="is_detail_modal_open.set(false)"
        [title]="detail()?.document_number || 'Detalle Cuenta por Pagar'"
        size="xl"
      >
        @if (detail(); as d) {
          <div class="p-4 space-y-6 max-h-[70vh] overflow-y-auto">
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p class="text-xs text-gray-500">Proveedor</p>
                <p class="text-sm font-semibold">{{ d.supplier?.name || '—' }}</p>
              </div>
              <div>
                <p class="text-xs text-gray-500">Email</p>
                <p class="text-sm">{{ d.supplier?.email || '—' }}</p>
              </div>
              <div>
                <p class="text-xs text-gray-500">Telefono</p>
                <p class="text-sm">{{ d.supplier?.phone || '—' }}</p>
              </div>
              <div>
                <p class="text-xs text-gray-500">Origen</p>
                <p class="text-sm">{{ d.source_type }} #{{ d.source_id }}</p>
              </div>
            </div>

            <div class="flex items-center gap-3">
              <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" [class]="getStatusClass(d.status)">
                {{ getStatusLabel(d.status) }}
              </span>
              <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" [class]="getPriorityClass(d.priority)">
                {{ getPriorityLabel(d.priority) }}
              </span>
              @if (d.days_overdue > 0) {
                <span class="text-xs text-red-500 font-medium">{{ d.days_overdue }} dias vencido</span>
              }
            </div>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg">
              <div>
                <p class="text-xs text-gray-500">Monto Original</p>
                <p class="text-sm font-semibold font-mono">{{ format(d.original_amount) }}</p>
              </div>
              <div>
                <p class="text-xs text-gray-500">Pagado</p>
                <p class="text-sm font-semibold font-mono text-emerald-600">{{ format(d.paid_amount) }}</p>
              </div>
              <div>
                <p class="text-xs text-gray-500">Saldo</p>
                <p class="text-sm font-bold font-mono text-primary">{{ format(d.balance) }}</p>
              </div>
              <div>
                <p class="text-xs text-gray-500">Vencimiento</p>
                <p class="text-sm font-medium">{{ d.due_date | date: 'dd/MM/yyyy' }}</p>
              </div>
            </div>

            <div>
              <h4 class="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                <app-icon name="history" [size]="16"></app-icon>
                Historial de Pagos
              </h4>
              @if (d.ap_payments && d.ap_payments.length > 0) {
                <div class="space-y-2">
                  @for (payment of d.ap_payments; track payment.id) {
                    <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div class="flex items-center gap-3 min-w-0">
                        <div class="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                          <app-icon name="banknote" [size]="14" class="text-emerald-600"></app-icon>
                        </div>
                        <div class="min-w-0">
                          <p class="text-sm font-medium">{{ format(payment.amount) }}</p>
                          <p class="text-xs text-gray-500">
                            {{ payment.payment_date | date: 'dd/MM/yyyy' }}
                            @if (payment.payment_method) { · {{ getPaymentMethodLabel(payment.payment_method) }} }
                            @if (payment.reference) { · Ref: {{ payment.reference }} }
                          </p>
                        </div>
                      </div>
                      @if (payment.bank_export_ref) {
                        <span class="text-xs text-gray-400 font-mono">{{ payment.bank_export_ref }}</span>
                      }
                    </div>
                  }
                </div>
              } @else {
                <p class="text-sm text-gray-400 text-center py-4">No hay pagos registrados</p>
              }
            </div>

            <div>
              <h4 class="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                <app-icon name="calendar-clock" [size]="16"></app-icon>
                Programacion de Pagos
              </h4>
              @if (d.ap_payment_schedules && d.ap_payment_schedules.length > 0) {
                <div class="space-y-2">
                  @for (schedule of d.ap_payment_schedules; track schedule.id) {
                    <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0" [class]="getScheduleIconClass(schedule.status)">
                          <app-icon [name]="getScheduleIcon(schedule.status)" [size]="14"></app-icon>
                        </div>
                        <div>
                          <p class="text-sm font-medium">{{ format(schedule.amount) }}</p>
                          <p class="text-xs text-gray-500">
                            Programado: {{ schedule.scheduled_date | date: 'dd/MM/yyyy' }}
                            @if (schedule.processed_at) { · Procesado: {{ schedule.processed_at | date: 'dd/MM/yyyy' }} }
                          </p>
                        </div>
                      </div>
                      <div class="flex items-center gap-2">
                        <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" [class]="getScheduleStatusClass(schedule.status)">
                          {{ getScheduleStatusLabel(schedule.status) }}
                        </span>
                        @if (schedule.status === 'scheduled') {
                          <app-button variant="ghost" size="sm" (clicked)="cancelSchedule(schedule.id)">
                            <app-icon name="x" [size]="12" slot="icon"></app-icon>
                          </app-button>
                        }
                      </div>
                    </div>
                  }
                </div>
              } @else {
                <p class="text-sm text-gray-400 text-center py-4">No hay pagos programados</p>
              }
            </div>

            @if (d.status !== 'paid' && d.status !== 'written_off') {
              <div class="flex justify-end gap-3 pt-4 border-t border-border">
                <app-button variant="outline" size="sm" (clicked)="confirmWriteOff(d)">
                  <app-icon name="x-circle" [size]="14" slot="icon"></app-icon>
                  Castigar
                </app-button>
                <app-button variant="primary" size="sm" (clicked)="openPaymentModal(d)">
                  <app-icon name="banknote" [size]="14" slot="icon"></app-icon>
                  Registrar Pago
                </app-button>
              </div>
            }
          </div>
        } @else {
          <div class="p-8 text-center text-gray-400">
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p class="mt-2">Cargando detalle...</p>
          </div>
        }
      </app-modal>
    }

    <!-- ══════ PAYMENT MODAL ══════ -->
    @defer (when is_payment_modal_open()) {
      <app-modal
        [isOpen]="is_payment_modal_open()"
        (isOpenChange)="is_payment_modal_open.set($event)"
        (cancel)="is_payment_modal_open.set(false)"
        title="Registrar Pago"
        size="md"
      >
        @if (selected_payable(); as payableData) {
          <div class="p-4 space-y-4">
            <div class="p-3 bg-gray-50 rounded-lg space-y-1">
              <div class="flex justify-between text-sm">
                <span class="text-gray-500">Proveedor</span>
                <span class="font-medium">{{ payableData.supplier?.name || '—' }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gray-500">Documento</span>
                <span class="font-mono">{{ payableData.document_number || '—' }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gray-500">Saldo Pendiente</span>
                <span class="font-semibold text-primary font-mono">{{ format(payableData.balance) }}</span>
              </div>
            </div>

            <form [formGroup]="payment_form" class="space-y-4">
              <app-input
                label="Monto del Pago"
                formControlName="amount"
                [control]="payment_form.get('amount')"
                [required]="true"
                [currency]="true"
                placeholder="0"
              ></app-input>

              <app-selector
                label="Metodo de Pago"
                formControlName="payment_method"
                [options]="payment_method_options"
                placeholder="Seleccionar metodo"
                [required]="true"
                (valueChange)="payment_form.get('payment_method')!.setValue('' + $event)"
              ></app-selector>

              <app-input
                label="Referencia"
                formControlName="reference"
                [control]="payment_form.get('reference')"
                placeholder="Numero de transaccion, cheque, etc."
              ></app-input>

              <app-input
                label="Ref. Exportacion Bancaria"
                formControlName="bank_export_ref"
                [control]="payment_form.get('bank_export_ref')"
                placeholder="Referencia para exportacion bancaria"
              ></app-input>

              <app-textarea
                label="Notas"
                formControlName="notes"
                [control]="payment_form.get('notes')"
                placeholder="Notas adicionales del pago..."
                [rows]="3"
              ></app-textarea>
            </form>

            <div class="flex justify-end gap-3 pt-2 border-t border-border">
              <app-button variant="outline" (clicked)="is_payment_modal_open.set(false)">Cancelar</app-button>
              <app-button
                variant="primary"
                (clicked)="submitPayment()"
                [loading]="is_submitting()"
                [disabled]="payment_form_invalid() || is_submitting()"
              >
                Registrar Pago
              </app-button>
            </div>
          </div>
        }
      </app-modal>
    }
  `,
})
export class OrgPayablesComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly service = inject(OrgCarteraService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);

  private readonly storeId = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  private currentStoreId(): string | null {
    return this.storeId().get('store_id');
  }

  // Data
  readonly payables = signal<AccountPayable[]>([]);
  readonly is_loading = signal(false);
  readonly dashboard = signal<CarteraDashboard | null>(null);

  readonly meta = signal({ total: 0, page: 1, limit: 20, totalPages: 0 });

  readonly search_term = signal('');
  readonly filter_values = signal<FilterValues>({});
  readonly query_params = signal<ApQueryParams>({ page: 1, limit: 20 });

  // Modals
  readonly is_payment_modal_open = signal(false);
  readonly is_detail_modal_open = signal(false);
  readonly selected_payable = signal<AccountPayable | null>(null);
  readonly detail = signal<AccountPayable | null>(null);
  readonly is_submitting = signal(false);

  payment_method_options = [
    { value: 'cash', label: 'Efectivo' },
    { value: 'bank_transfer', label: 'Transferencia Bancaria' },
    { value: 'check', label: 'Cheque' },
  ];

  payment_form = this.fb.group({
    amount: [null as number | null, [Validators.required, Validators.min(1)]],
    payment_method: ['', [Validators.required]],
    reference: [''],
    bank_export_ref: [''],
    notes: [''],
  });

  private readonly payment_status = toSignal(this.payment_form.statusChanges, {
    initialValue: this.payment_form.status,
  });
  readonly payment_form_invalid = computed(() => this.payment_status() !== 'VALID');

  filter_configs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Estados' },
        { value: 'open', label: 'Abierta' },
        { value: 'partial', label: 'Parcial' },
        { value: 'overdue', label: 'Vencida' },
        { value: 'paid', label: 'Pagada' },
        { value: 'written_off', label: 'Castigada' },
      ],
    },
    {
      key: 'priority',
      label: 'Prioridad',
      type: 'select',
      options: [
        { value: '', label: 'Todas las Prioridades' },
        { value: 'urgent', label: 'Urgente' },
        { value: 'high', label: 'Alta' },
        { value: 'normal', label: 'Normal' },
        { value: 'low', label: 'Baja' },
      ],
    },
  ];

  dropdown_actions: DropdownAction[] = [];

  columns: TableColumn[] = [
    { key: 'document_number', label: 'Documento', sortable: true, priority: 1, transform: (val: any) => val || '—' },
    { key: 'supplier_name', label: 'Proveedor', priority: 1, transform: (_val: any, row: any) => row?.supplier?.name || '—' },
    { key: 'original_amount', label: 'Monto Original', sortable: true, align: 'right', priority: 2, transform: (val: any) => this.currencyService.format(Number(val) || 0) },
    { key: 'balance', label: 'Saldo', sortable: true, align: 'right', priority: 1, transform: (val: any) => this.currencyService.format(Number(val) || 0) },
    { key: 'due_date', label: 'Vencimiento', sortable: true, align: 'center', priority: 2, transform: (val: any) => (val ? formatDateOnlyUTC(val) : '—') },
    {
      key: 'priority',
      label: 'Prioridad',
      align: 'center',
      priority: 2,
      badge: true,
      badgeConfig: {
        type: 'status',
        colorMap: { urgent: 'danger', high: 'warn', normal: 'info', low: 'default' },
      },
      transform: (val: string) => this.getPriorityLabel(val),
    },
    {
      key: 'status',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: { open: 'info', partial: 'warn', overdue: 'danger', paid: 'success', written_off: 'default' },
      },
      transform: (val: string) => this.getStatusLabel(val),
    },
  ];

  card_config: ItemListCardConfig = {
    titleKey: 'document_number',
    subtitleTransform: (item: any) => item?.supplier?.name || '—',
    badgeKey: 'status',
    badgeConfig: {
      type: 'status',
      size: 'sm',
      colorMap: { open: 'info', partial: 'warn', overdue: 'danger', paid: 'success', written_off: 'default' },
    },
    badgeTransform: (val: string) => this.getStatusLabel(val),
    detailKeys: [
      { key: 'due_date', label: 'Vencimiento', icon: 'calendar', transform: (val: any) => (val ? formatDateOnlyUTC(val) : '—') },
      { key: 'priority', label: 'Prioridad', icon: 'alert-circle', transform: (val: any) => this.getPriorityLabel(val) },
    ],
    footerKey: 'balance',
    footerLabel: 'Saldo',
    footerStyle: 'prominent' as const,
    footerTransform: (val: any) => this.currencyService.format(Number(val) || 0),
  };

  table_actions: TableAction[] = [
    { label: 'Ver Detalle', icon: 'eye', variant: 'secondary', action: (row: AccountPayable) => this.openDetailModal(row) },
    {
      label: 'Registrar Pago',
      icon: 'banknote',
      variant: 'primary',
      action: (row: AccountPayable) => this.openPaymentModal(row),
      show: (row: AccountPayable) => row.status !== 'paid' && row.status !== 'written_off',
    },
    {
      label: 'Castigar',
      icon: 'x-circle',
      variant: 'danger',
      action: (row: AccountPayable) => this.confirmWriteOff(row),
      show: (row: AccountPayable) => row.status !== 'paid' && row.status !== 'written_off',
    },
  ];

  constructor() {
    let lastStoreId: string | null | undefined;
    effect(() => {
      const storeId = this.currentStoreId();
      if (storeId === lastStoreId) return;
      lastStoreId = storeId;
      untracked(() => {
        this.query_params.set({ page: 1, limit: 20 });
        this.search_term.set('');
        this.filter_values.set({});
        this.loadPayables();
        this.loadDashboard();
      });
    });
  }

  loadPayables(): void {
    this.is_loading.set(true);
    this.service
      .getPayables(this.query_params(), this.currentStoreId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.payables.set(response.data);
          this.meta.set(response.meta);
          this.is_loading.set(false);
        },
        error: () => {
          this.is_loading.set(false);
        },
      });
  }

  loadDashboard(): void {
    this.service
      .getApDashboard(this.currentStoreId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.dashboard.set(response.data),
      });
  }

  reload(): void {
    this.loadPayables();
    this.loadDashboard();
  }

  // ── Filter handlers ──────────────────────────────────

  onSearchChange(term: string): void {
    this.search_term.set(term);
    this.query_params.set({ ...this.query_params(), search: term, page: 1 });
    this.loadPayables();
  }

  onFilterChange(values: FilterValues): void {
    this.filter_values.set({ ...values });
    this.query_params.set({
      ...this.query_params(),
      status: (values['status'] as string) || undefined,
      priority: (values['priority'] as string) || undefined,
      page: 1,
    });
    this.loadPayables();
  }

  onClearFilters(): void {
    this.search_term.set('');
    this.filter_values.set({});
    this.query_params.set({ page: 1, limit: 20 });
    this.loadPayables();
  }

  onPageChange(page: number): void {
    this.query_params.set({ ...this.query_params(), page });
    this.loadPayables();
  }

  onRowClick(payable: AccountPayable): void {
    this.openDetailModal(payable);
  }

  // ── Modal management ──────────────────────────────────

  async openDetailModal(payable: AccountPayable): Promise<void> {
    this.selected_payable.set(payable);
    this.detail.set(null);
    this.is_detail_modal_open.set(true);
    try {
      const response = await firstValueFrom(
        this.service.getPayable(payable.id, this.currentStoreId()),
      );
      this.detail.set(response.data);
    } catch {
      this.detail.set(payable);
    }
  }

  openPaymentModal(payable: AccountPayable): void {
    this.selected_payable.set(payable);
    this.payment_form.reset({ payment_method: '' });
    this.payment_form.patchValue({ amount: payable.balance });
    this.is_detail_modal_open.set(false);
    this.is_payment_modal_open.set(true);
  }

  async submitPayment(): Promise<void> {
    const current = this.selected_payable();
    if (this.payment_form.invalid || !current) return;
    const val = this.payment_form.value;
    this.is_submitting.set(true);
    try {
      await firstValueFrom(
        this.service.registerApPayment(
          current.id,
          {
            amount: Number(val.amount),
            payment_method: val.payment_method!,
            reference: val.reference || undefined,
            bank_export_ref: val.bank_export_ref || undefined,
            notes: val.notes || undefined,
          },
          this.currentStoreId(),
        ),
      );
      this.is_submitting.set(false);
      this.toastService.success('Pago registrado exitosamente');
      this.is_payment_modal_open.set(false);
      this.reload();
    } catch {
      this.is_submitting.set(false);
      this.toastService.error('Error al registrar el pago');
    }
  }

  cancelSchedule(scheduleId: number): void {
    this.service
      .cancelApSchedule(scheduleId, this.currentStoreId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Programacion cancelada');
          const current = this.selected_payable();
          if (current) this.openDetailModal(current);
          this.reload();
        },
        error: () => this.toastService.error('Error al cancelar la programacion'),
      });
  }

  async confirmWriteOff(payable: AccountPayable): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Castigar Cuenta por Pagar',
      message: `Esta seguro que desea castigar la cuenta ${payable.document_number || '#' + payable.id}? Esta accion no se puede deshacer.`,
      confirmText: 'Castigar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.service
      .writeOffAp(payable.id, this.currentStoreId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Cuenta castigada exitosamente');
          this.is_detail_modal_open.set(false);
          this.reload();
        },
        error: () => this.toastService.error('Error al castigar la cuenta'),
      });
  }

  // ── Helpers ──────────────────────────────────────────

  format(value: number): string {
    return this.currencyService.format(Number(value) || 0);
  }

  readonly formatted_total_pending = computed(() => this.currencyService.format(this.dashboard()?.total_pending || 0));
  readonly formatted_total_overdue = computed(() => this.currencyService.format(this.dashboard()?.total_overdue || 0));
  readonly formatted_scheduled = computed(() => this.currencyService.format(this.dashboard()?.due_soon || 0));
  readonly formatted_paid_this_month = computed(() => this.currencyService.format(this.dashboard()?.paid_this_month || 0));

  hasFilters(): boolean {
    const fv = this.filter_values();
    return !!(this.search_term() || fv['status'] || fv['priority']);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      open: 'Abierta',
      partial: 'Parcial',
      overdue: 'Vencida',
      paid: 'Pagada',
      written_off: 'Castigada',
    };
    return labels[status] || status;
  }

  getStatusClass(status: string): string {
    const classes: Record<string, string> = {
      open: 'bg-blue-50 text-blue-600',
      partial: 'bg-amber-50 text-amber-600',
      overdue: 'bg-red-50 text-red-600',
      paid: 'bg-emerald-50 text-emerald-600',
      written_off: 'bg-gray-100 text-gray-500',
    };
    return classes[status] || 'bg-gray-100 text-gray-500';
  }

  getPriorityLabel(priority: string): string {
    const labels: Record<string, string> = {
      urgent: 'Urgente',
      high: 'Alta',
      normal: 'Normal',
      low: 'Baja',
    };
    return labels[priority] || priority;
  }

  getPriorityClass(priority: string): string {
    const classes: Record<string, string> = {
      urgent: 'bg-red-50 text-red-600',
      high: 'bg-orange-50 text-orange-600',
      normal: 'bg-blue-50 text-blue-600',
      low: 'bg-gray-100 text-gray-500',
    };
    return classes[priority] || 'bg-gray-100 text-gray-500';
  }

  getPaymentMethodLabel(method: string): string {
    const labels: Record<string, string> = {
      cash: 'Efectivo',
      bank_transfer: 'Transferencia',
      check: 'Cheque',
    };
    return labels[method] || method;
  }

  getScheduleStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      scheduled: 'Programado',
      processed: 'Procesado',
      cancelled: 'Cancelado',
    };
    return labels[status] || status;
  }

  getScheduleStatusClass(status: string): string {
    const classes: Record<string, string> = {
      scheduled: 'bg-blue-50 text-blue-600',
      processed: 'bg-emerald-50 text-emerald-600',
      cancelled: 'bg-gray-100 text-gray-500',
    };
    return classes[status] || 'bg-gray-100 text-gray-500';
  }

  getScheduleIcon(status: string): string {
    const icons: Record<string, string> = {
      scheduled: 'clock',
      processed: 'check',
      cancelled: 'x',
    };
    return icons[status] || 'clock';
  }

  getScheduleIconClass(status: string): string {
    const classes: Record<string, string> = {
      scheduled: 'bg-blue-100 text-blue-600',
      processed: 'bg-emerald-100 text-emerald-600',
      cancelled: 'bg-gray-100 text-gray-500',
    };
    return classes[status] || 'bg-gray-100 text-gray-500';
  }
}
