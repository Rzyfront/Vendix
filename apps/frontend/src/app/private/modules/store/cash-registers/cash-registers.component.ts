import { Component, OnInit, OnDestroy, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormsModule,
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { CardComponent } from '../../../../shared/components/card/card.component';
import {
  ToastService,
  StatsComponent,
  DialogService,
  ButtonComponent,
  IconComponent,
  InputsearchComponent,
  ResponsiveDataViewComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  ModalComponent,
  InputComponent,
} from '../../../../shared/components/index';
import {
  ScrollableTabsComponent,
  ScrollableTab,
} from '../../../../shared/components/index';
import {
  PosCashRegisterService,
  CashRegister,
  CashRegisterSession,
} from '../pos/services/pos-cash-register.service';
import { PosSessionDetailModalComponent } from '../pos/components/pos-session-detail-modal.component';
import { CurrencyFormatService } from '../../../../shared/pipes/currency';

@Component({
  selector: 'app-cash-registers',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    CardComponent,
    StatsComponent,
    ButtonComponent,
    IconComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    ScrollableTabsComponent,
    ModalComponent,
    InputComponent,
    PosSessionDetailModalComponent,
  ],
  template: `
    <div class="w-full md:space-y-4">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Cajas Activas"
          [value]="active_registers_count()"
          iconName="monitor"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Sesiones Abiertas"
          [value]="open_sessions_count()"
          iconName="unlock"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Cierres Hoy"
          [value]="closed_today_count()"
          iconName="lock"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
        <app-stats
          title="Diferencia Total"
          [value]="total_difference_display()"
          iconName="trending-up"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

      <!-- Tabs -->
      <app-scrollable-tabs
        [tabs]="tabs"
        [activeTab]="active_tab()"
        (tabChange)="onTabChange($event)"
      />

      <!-- Tab: Cajas -->
      @if (active_tab() === 'registers') {
        <app-card [responsive]="true" [padding]="false">
          <!-- Sticky search header -->
          <div
            class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                      md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
          >
            <div
              class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
            >
              <h2
                class="text-[13px] font-bold text-gray-600 tracking-wide
                         md:text-lg md:font-semibold md:text-text-primary"
              >
                Cajas Registradoras ({{ filtered_registers().length }})
              </h2>
              <div class="flex items-center gap-2 w-full md:w-auto">
                <app-inputsearch
                  class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                  size="sm"
                  placeholder="Buscar cajas..."
                  [debounceTime]="300"
                  [ngModel]="registers_search_term()"
                  (ngModelChange)="onRegistersSearchChange($event)"
                ></app-inputsearch>
                <app-button
                  variant="outline"
                  size="sm"
                  (clicked)="openRegisterModal()"
                  customClasses="w-9 h-9 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
                  title="Nueva Caja"
                >
                  <app-icon slot="icon" name="plus" [size]="18"></app-icon>
                </app-button>
              </div>
            </div>
          </div>

          <!-- Data View -->
          @if (!is_loading_registers() && filtered_registers().length > 0) {
            <div class="px-2 pb-2 pt-3 md:p-4">
              <app-responsive-data-view
                [data]="filtered_registers()"
                [columns]="registers_table_columns"
                [cardConfig]="registers_card_config"
                [actions]="registers_table_actions"
                [loading]="is_loading_registers()"
                emptyMessage="No hay cajas registradas"
                emptyIcon="monitor"
              ></app-responsive-data-view>
            </div>
          }

          <!-- Loading State -->
          @if (is_loading_registers()) {
            <div class="p-4 md:p-6 text-center">
              <div
                class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
              ></div>
              <p class="mt-2 text-text-secondary">Cargando cajas...</p>
            </div>
          }

          <!-- Empty State -->
          @if (!is_loading_registers() && filtered_registers().length === 0) {
            <div class="p-8 text-center">
              <div
                class="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center"
              >
                <app-icon
                  name="monitor"
                  [size]="24"
                  class="text-gray-400"
                ></app-icon>
              </div>
              @if (registers_search_term()) {
                <p class="text-sm text-text-secondary">
                  No se encontraron cajas con ese criterio
                </p>
              } @else {
                <p class="text-sm text-text-secondary">
                  No hay cajas registradas
                </p>
                <p class="text-xs text-gray-400 mt-1">
                  Crea tu primera caja registradora
                </p>
              }
            </div>
          }
        </app-card>
      }

      <!-- Tab: Sesiones -->
      @if (active_tab() === 'sessions') {
        <app-card [responsive]="true" [padding]="false">
          <!-- Sticky search header -->
          <div
            class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                      md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
          >
            <div
              class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
            >
              <h2
                class="text-[13px] font-bold text-gray-600 tracking-wide
                         md:text-lg md:font-semibold md:text-text-primary"
              >
                Historial de Sesiones ({{ filtered_sessions().length }})
              </h2>
              <div class="flex items-center gap-2 w-full md:w-auto">
                <app-inputsearch
                  class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                  size="sm"
                  placeholder="Buscar sesiones..."
                  [debounceTime]="300"
                  [ngModel]="sessions_search_term()"
                  (ngModelChange)="onSessionsSearchChange($event)"
                ></app-inputsearch>
              </div>
            </div>
          </div>

          <!-- Data View -->
          @if (!is_loading_sessions() && filtered_sessions().length > 0) {
            <div class="px-2 pb-2 pt-3 md:p-4">
              <app-responsive-data-view
                [data]="filtered_sessions()"
                [columns]="sessions_table_columns"
                [cardConfig]="sessions_card_config"
                [actions]="sessions_table_actions"
                [loading]="is_loading_sessions()"
                emptyMessage="No hay sesiones registradas"
                emptyIcon="clock"
              ></app-responsive-data-view>
            </div>
          }

          <!-- Loading State -->
          @if (is_loading_sessions()) {
            <div class="p-4 md:p-6 text-center">
              <div
                class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
              ></div>
              <p class="mt-2 text-text-secondary">Cargando sesiones...</p>
            </div>
          }

          <!-- Empty State -->
          @if (!is_loading_sessions() && filtered_sessions().length === 0) {
            <div class="p-8 text-center">
              <div
                class="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center"
              >
                <app-icon
                  name="clock"
                  [size]="24"
                  class="text-gray-400"
                ></app-icon>
              </div>
              @if (sessions_search_term()) {
                <p class="text-sm text-text-secondary">
                  No se encontraron sesiones con ese criterio
                </p>
              } @else {
                <p class="text-sm text-text-secondary">
                  No hay sesiones registradas
                </p>
                <p class="text-xs text-gray-400 mt-1">
                  Las sesiones aparecen al abrir una caja desde el POS
                </p>
              }
            </div>
          }
        </app-card>
      }

      <!-- Register CRUD Modal -->
      <app-modal
        [isOpen]="show_register_modal()"
        [title]="editing_register() ? 'Editar Caja' : 'Nueva Caja'"
        [subtitle]="
          editing_register()
            ? 'Modifica los datos de la caja'
            : 'Configura una nueva caja registradora'
        "
        size="md"
        (closed)="closeRegisterModal()"
      >
        <div slot="header">
          <div
            class="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center border border-blue-100"
          >
            <app-icon
              name="monitor"
              [size]="20"
              class="text-blue-600"
            ></app-icon>
          </div>
        </div>

        <form [formGroup]="register_form" class="space-y-4">
          <app-input
            formControlName="name"
            label="Nombre"
            placeholder="Ej: Caja Principal"
            type="text"
            [size]="'md'"
            [required]="true"
            [error]="getFieldError('name')"
          ></app-input>

          <app-input
            formControlName="code"
            label="Código"
            placeholder="Ej: CAJA-01"
            type="text"
            [size]="'md'"
            [required]="true"
            helperText="Identificador único para esta caja"
            [error]="getFieldError('code')"
          ></app-input>

          <app-input
            formControlName="description"
            label="Descripción"
            placeholder="Ej: Caja del mostrador principal"
            type="text"
            [size]="'md'"
          ></app-input>

          <app-input
            formControlName="default_opening_amount"
            label="Monto de Apertura por Defecto"
            placeholder="0"
            [currency]="true"
            [size]="'md'"
            helperText="Monto sugerido al abrir esta caja"
          ></app-input>
        </form>

        <div slot="footer" class="flex justify-end gap-3">
          <app-button variant="ghost" (clicked)="closeRegisterModal()">
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            size="md"
            (clicked)="onSaveRegister()"
            [disabled]="!register_form.valid || is_saving_register()"
          >
            <app-icon name="save" [size]="16" slot="icon"></app-icon>
            @if (is_saving_register()) {
              Guardando...
            } @else {
              {{ editing_register() ? 'Guardar Cambios' : 'Crear Caja' }}
            }
          </app-button>
        </div>
      </app-modal>

      <!-- Session Detail Modal -->
      <app-pos-session-detail-modal
        [isOpen]="show_detail_modal()"
        [session]="selected_session"
        (isOpenChange)="show_detail_modal.set($event)"
      ></app-pos-session-detail-modal>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class CashRegistersComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private currencyService = inject(CurrencyFormatService);

  // Tabs configuration
  readonly tabs: ScrollableTab[] = [
    { id: 'registers', label: 'Cajas', icon: 'monitor' },
    { id: 'sessions', label: 'Sesiones', icon: 'clock' },
  ];

  readonly active_tab = signal<'registers' | 'sessions'>('registers');

  // Registers state (signals)
  readonly registers = signal<CashRegister[]>([]);
  readonly is_loading_registers = signal(false);

  // Sessions state (signals)
  readonly sessions = signal<CashRegisterSession[]>([]);
  readonly is_loading_sessions = signal(false);

  // Search
  readonly registers_search_term = signal('');
  readonly sessions_search_term = signal('');

  readonly filtered_registers = computed(() => {
    const term = this.registers_search_term().toLowerCase();
    const data = this.registers();
    if (!term) return data;
    return data.filter(
      (r) =>
        r.name?.toLowerCase().includes(term) ||
        r.code?.toLowerCase().includes(term) ||
        r.description?.toLowerCase().includes(term),
    );
  });

  readonly filtered_sessions = computed(() => {
    const term = this.sessions_search_term().toLowerCase();
    const data = this.sessions();
    if (!term) return data;
    return data.filter(
      (s) =>
        s.register?.name?.toLowerCase().includes(term) ||
        s.opened_by_user?.first_name?.toLowerCase().includes(term) ||
        s.opened_by_user?.last_name?.toLowerCase().includes(term) ||
        s.status?.toLowerCase().includes(term),
    );
  });

  // Stats (computed)
  readonly active_registers_count = computed(
    () => this.registers().filter((r) => r.is_active).length,
  );

  readonly open_sessions_count = computed(
    () => this.sessions().filter((s) => s.status === 'open').length,
  );

  readonly closed_today_count = computed(
    () =>
      this.sessions().filter(
        (s) => s.status === 'closed' && this.isToday(s.closed_at),
      ).length,
  );

  readonly total_difference = computed(() =>
    this.sessions()
      .filter((s) => s.difference != null)
      .reduce((sum, s) => sum + Number(s.difference), 0),
  );

  readonly total_difference_display = computed(() => {
    const diff = this.total_difference();
    return this.currencyService.format(Math.abs(diff));
  });

  // Modal state (signals)
  readonly show_register_modal = signal(false);
  readonly show_detail_modal = signal(false);
  readonly editing_register = signal<CashRegister | null>(null);
  readonly is_saving_register = signal(false);

  // Session detail
  selected_session: CashRegisterSession | null = null;

  // Register form
  register_form: FormGroup;

  // ========== TABLE CONFIG: Registers ==========

  registers_table_columns: TableColumn[] = [
    {
      key: 'name',
      label: 'Nombre',
      sortable: true,
      priority: 1,
      transform: (value: string) => value || 'Sin nombre',
    },
    {
      key: 'code',
      label: 'Código',
      sortable: true,
      priority: 2,
      transform: (value: string) => value || '-',
    },
    {
      key: 'default_opening_amount',
      label: 'Monto Apertura Default',
      sortable: true,
      priority: 3,
      transform: (value: number) =>
        value != null
          ? this.currencyService.format(value)
          : '-',
    },
    {
      key: 'is_active',
      label: 'Estado',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        colorMap: { true: '#22c55e', false: '#f59e0b' },
      },
      transform: (value: boolean) => (value ? 'Activa' : 'Inactiva'),
    },
    {
      key: 'sessions',
      label: 'Sesión Activa',
      priority: 2,
      transform: (value: CashRegisterSession[]) => {
        if (value && value.length > 0) {
          const user = value[0].opened_by_user;
          return user ? `${user.first_name} ${user.last_name}` : 'En uso';
        }
        return 'Libre';
      },
    },
  ];

  registers_card_config: ItemListCardConfig = {
    titleKey: 'name',
    titleTransform: (item: CashRegister) => item.name || 'Sin nombre',
    subtitleKey: 'code',
    subtitleTransform: (item: CashRegister) => item.code,
    avatarFallbackIcon: 'monitor',
    avatarShape: 'square',
    badgeKey: 'is_active',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: { true: '#22c55e', false: '#f59e0b' },
    },
    badgeTransform: (val: boolean) => (val ? 'Activa' : 'Inactiva'),
    detailKeys: [
      {
        key: 'default_opening_amount',
        label: 'Monto Apertura',
        transform: (val: number) =>
          val != null
            ? this.currencyService.format(val)
            : '-',
      },
      {
        key: 'sessions',
        label: 'Sesión',
        transform: (val: CashRegisterSession[]) => {
          if (val && val.length > 0) {
            const user = val[0].opened_by_user;
            return user ? `En uso - ${user.first_name}` : 'En uso';
          }
          return 'Libre';
        },
      },
    ],
  };

  registers_table_actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'ghost',
      action: (row: CashRegister) => this.openEditRegisterModal(row),
    },
    {
      label: 'Desactivar',
      icon: 'x',
      variant: 'danger',
      action: (row: CashRegister) => this.confirmDeactivateRegister(row),
      show: (row: CashRegister) => row.is_active,
    },
  ];

  // ========== TABLE CONFIG: Sessions ==========

  sessions_table_columns: TableColumn[] = [
    {
      key: 'register.name',
      label: 'Caja',
      sortable: true,
      priority: 1,
      transform: (_value: any, item: CashRegisterSession) =>
        item.register?.name || '-',
    },
    {
      key: 'opened_by_user',
      label: 'Cajero',
      priority: 1,
      transform: (_value: any, item: CashRegisterSession) => {
        const user = item.opened_by_user;
        return user ? `${user.first_name} ${user.last_name}` : '-';
      },
    },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          open: '#22c55e',
          closed: '#64748b',
          suspended: '#f59e0b',
        },
      },
      transform: (value: string) => this.getStatusLabel(value),
    },
    {
      key: 'opening_amount',
      label: 'Apertura',
      sortable: true,
      priority: 2,
      transform: (value: number) =>
        value != null
          ? this.currencyService.format(value)
          : '-',
    },
    {
      key: 'actual_closing_amount',
      label: 'Cierre',
      sortable: true,
      priority: 3,
      transform: (value: number) =>
        value != null
          ? this.currencyService.format(value)
          : '-',
    },
    {
      key: 'difference',
      label: 'Diferencia',
      sortable: true,
      priority: 3,
      transform: (value: number) => {
        if (value == null) return '-';
        const sign = value >= 0 ? '+' : '';
        return `${sign}${this.currencyService.format(Math.abs(value))}`;
      },
    },
    {
      key: 'opened_at',
      label: 'Fecha',
      sortable: true,
      priority: 2,
      transform: (value: string) =>
        value ? new Date(value).toLocaleDateString() : '-',
    },
  ];

  sessions_card_config: ItemListCardConfig = {
    titleKey: 'register',
    titleTransform: (item: CashRegisterSession) =>
      item.register?.name || 'Sin caja',
    subtitleKey: 'opened_by_user',
    subtitleTransform: (item: CashRegisterSession) => {
      const user = item.opened_by_user;
      return user ? `${user.first_name} ${user.last_name}` : '-';
    },
    avatarFallbackIcon: 'clock',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        open: '#22c55e',
        closed: '#64748b',
        suspended: '#f59e0b',
      },
    },
    badgeTransform: (val: string) => this.getStatusLabel(val),
    detailKeys: [
      {
        key: 'opening_amount',
        label: 'Apertura',
        transform: (val: number) =>
          val != null
            ? this.currencyService.format(val)
            : '-',
      },
      {
        key: 'difference',
        label: 'Diferencia',
        transform: (val: number) => {
          if (val == null) return '-';
          const sign = val >= 0 ? '+' : '';
          return `${sign}${this.currencyService.format(Math.abs(val))}`;
        },
      },
    ],
    footerKey: 'opened_at',
    footerLabel: 'Fecha',
    footerTransform: (val: string) =>
      val ? new Date(val).toLocaleDateString() : '-',
  };

  sessions_table_actions: TableAction[] = [
    {
      label: 'Ver',
      icon: 'eye',
      variant: 'primary',
      action: (row: CashRegisterSession) => this.onViewDetail(row),
    },
  ];

  constructor(
    private fb: FormBuilder,
    private cash_register_service: PosCashRegisterService,
    private toast_service: ToastService,
    private dialog_service: DialogService,
  ) {
    this.register_form = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(100)]],
      code: ['', [Validators.required, Validators.maxLength(50)]],
      description: [''],
      default_opening_amount: [0, [Validators.min(0)]],
    });
  }

  ngOnInit(): void {
    this.loadRegisters();
    this.loadSessions();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Tab change handler
  onTabChange(tabId: string): void {
    this.active_tab.set(tabId as 'registers' | 'sessions');
  }

  // Search handlers
  onRegistersSearchChange(term: string): void {
    this.registers_search_term.set(term);
  }

  onSessionsSearchChange(term: string): void {
    this.sessions_search_term.set(term);
  }

  // ========== DATA LOADING ==========

  loadRegisters(): void {
    this.is_loading_registers.set(true);
    this.cash_register_service
      .getCashRegisters()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.registers.set(data);
          this.is_loading_registers.set(false);
        },
        error: (error: any) => {
          this.toast_service.error('Error al cargar cajas: ' + error.message);
          this.registers.set([]);
          this.is_loading_registers.set(false);
        },
      });
  }

  loadSessions(): void {
    this.is_loading_sessions.set(true);
    this.cash_register_service
      .getSessionHistory({ limit: 50 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          this.sessions.set(result.data);
          this.is_loading_sessions.set(false);
        },
        error: (error: any) => {
          this.toast_service.error(
            'Error al cargar sesiones: ' + error.message,
          );
          this.sessions.set([]);
          this.is_loading_sessions.set(false);
        },
      });
  }

  // ========== REGISTER MODAL METHODS ==========

  openRegisterModal(): void {
    this.editing_register.set(null);
    this.register_form.reset({
      name: '',
      code: '',
      description: '',
      default_opening_amount: 0,
    });
    this.show_register_modal.set(true);
  }

  openEditRegisterModal(register: CashRegister): void {
    this.editing_register.set(register);
    this.register_form.patchValue({
      name: register.name,
      code: register.code,
      description: register.description || '',
      default_opening_amount: register.default_opening_amount || 0,
    });
    this.show_register_modal.set(true);
  }

  closeRegisterModal(): void {
    this.show_register_modal.set(false);
    this.editing_register.set(null);
  }

  onSaveRegister(): void {
    if (!this.register_form.valid) return;
    this.is_saving_register.set(true);

    const data = this.register_form.value;
    const editing = this.editing_register();

    const obs$ = editing
      ? this.cash_register_service.updateRegister(editing.id, data)
      : this.cash_register_service.createRegister(data);

    obs$.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.is_saving_register.set(false);
        this.closeRegisterModal();
        this.toast_service.success(
          editing
            ? 'Caja actualizada correctamente'
            : 'Caja creada correctamente',
        );
        this.loadRegisters();
      },
      error: (err: any) => {
        this.is_saving_register.set(false);
        this.toast_service.error(
          err.error?.message || 'Error al guardar la caja',
        );
      },
    });
  }

  confirmDeactivateRegister(register: CashRegister): void {
    this.dialog_service
      .confirm({
        title: 'Desactivar Caja',
        message: `¿Estás seguro de desactivar la caja "${register.name}"? No podrá usarse hasta que sea reactivada.`,
        confirmText: 'Desactivar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.cash_register_service
            .deleteRegister(register.id)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: () => {
                this.toast_service.success('Caja desactivada correctamente');
                this.loadRegisters();
              },
              error: (err: any) => {
                this.toast_service.error(
                  err.error?.message || 'Error al desactivar la caja',
                );
              },
            });
        }
      });
  }

  getFieldError(fieldName: string): string | undefined {
    const field = this.register_form.get(fieldName);
    if (field && field.errors && field.touched) {
      if (field.errors['required']) return 'Este campo es requerido';
      if (field.errors['maxlength'])
        return `Máximo ${field.errors['maxlength'].requiredLength} caracteres`;
    }
    return undefined;
  }

  // ========== SESSION DETAIL ==========

  onViewDetail(session: CashRegisterSession): void {
    this.selected_session = session;
    this.show_detail_modal.set(true);
  }

  // ========== HELPERS ==========

  private getStatusLabel(status: string): string {
    const label_map: Record<string, string> = {
      open: 'Abierta',
      closed: 'Cerrada',
      suspended: 'Suspendida',
    };
    return label_map[status] || status;
  }

  private isToday(dateStr?: string): boolean {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const today = new Date();
    return date.toDateString() === today.toDateString();
  }
}
