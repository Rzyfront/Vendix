import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormBuilder, FormGroup } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { PaymentMethodsService } from './services/payment-methods.service';
import {
  PaymentMethodStats,
  StorePaymentMethod,
  SystemPaymentMethod,
  CombinedPaymentMethod,
} from './interfaces/payment-methods.interface';
import {
  ToastService,
  StatsComponent,
  DialogService,
  ButtonComponent,
  ModalComponent,
  InputsearchComponent,
  IconComponent,
  ResponsiveDataViewComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  CardComponent,
} from '../../../../../../app/shared/components/index';

@Component({
  selector: 'app-payments-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    StatsComponent,
    ButtonComponent,
    ModalComponent,
    InputsearchComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    CardComponent,
  ],
  template: `
    <div class="w-full md:space-y-4">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total Métodos"
          [value]="payment_method_stats()?.total_methods || 0"
          smallText="Métodos en plataforma"
          iconName="credit-card"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Activos"
          [value]="payment_method_stats()?.enabled_methods || 0"
          smallText="Listos para usar"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Requieren Config"
          [value]="payment_method_stats()?.requires_config || 0"
          smallText="Acción requerida"
          iconName="settings"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
        <app-stats
          title="Transacciones"
          [value]="payment_method_stats()?.successful_transactions || 0"
          smallText="Pagos completados"
          iconName="check"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <!-- Content Container: Transparent on mobile, surface on desktop -->
      <app-card [responsive]="true" [padding]="false">
        <!-- Search Section: Sticky on mobile, static on desktop -->
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
              Métodos de Pago ({{ filtered_methods().length }})
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar métodos..."
                [debounceTime]="300"
                [ngModel]="search_term()"
                (ngModelChange)="onSearchChange($event)"
              ></app-inputsearch>
              <app-button
                variant="outline"
                size="sm"
                (clicked)="openAddModal()"
                customClasses="w-9 h-9 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
                title="Agregar Método"
              >
                <app-icon slot="icon" name="plus" [size]="18"></app-icon>
              </app-button>
            </div>
          </div>
        </div>

        <!-- Data View -->
        @if (!is_loading() && filtered_methods().length > 0) {
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="filtered_methods()"
              [columns]="table_columns"
              [cardConfig]="card_config"
              [actions]="table_actions"
              [loading]="is_loading()"
              emptyMessage="No hay métodos de pago"
              emptyIcon="credit-card"
            ></app-responsive-data-view>
          </div>
        }

        <!-- Loading State -->
        @if (is_loading()) {
          <div class="p-4 md:p-6 text-center">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
            <p class="mt-2 text-text-secondary">Cargando métodos de pago...</p>
          </div>
        }

        <!-- Empty State -->
        @if (!is_loading() && filtered_methods().length === 0) {
          <div class="p-8 text-center">
            <div
              class="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center"
            >
              <app-icon
                name="credit-card"
                [size]="24"
                class="text-gray-400"
              ></app-icon>
            </div>
            @if (search_term()) {
              <p class="text-sm text-text-secondary">
                No se encontraron métodos con ese criterio
              </p>
            } @else {
              <p class="text-sm text-text-secondary">
                No hay métodos de pago configurados
              </p>
              <p class="text-xs text-gray-400 mt-1">
                Agrega tu primer método de pago
              </p>
            }
          </div>
        }
      </app-card>
    </div>

    <!-- Add Payment Method Modal -->
    <app-modal
      [isOpen]="show_add_modal()"
      title="Agregar Método de Pago"
      subtitle="Selecciona los métodos disponibles para tu tienda"
      size="lg"
      (closed)="closeAddModal()"
    >
      <div slot="header">
        <div
          class="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center border border-blue-100"
        >
          <app-icon
            name="credit-card"
            [size]="20"
            class="text-blue-600"
          ></app-icon>
        </div>
      </div>

      <div class="mb-4">
        <app-inputsearch
          class="w-full"
          size="sm"
          placeholder="Buscar métodos disponibles..."
          [debounceTime]="300"
          [ngModel]="modal_search_term()"
          (ngModelChange)="onModalSearchChange($event)"
        ></app-inputsearch>
      </div>

      @if (is_loading_available()) {
        <div class="p-4 text-center">
          <div
            class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary"
          ></div>
          <p class="mt-2 text-sm text-text-secondary">
            Cargando métodos disponibles...
          </p>
        </div>
      }

      @if (!is_loading_available() && filtered_available_methods().length > 0) {
        <app-responsive-data-view
          [data]="filtered_available_methods()"
          [columns]="modal_columns"
          [cardConfig]="modal_card_config"
          [actions]="modal_actions"
          [loading]="is_loading_available()"
          emptyMessage="No hay métodos disponibles"
          emptyIcon="credit-card"
        ></app-responsive-data-view>
      }

      @if (
        !is_loading_available() && filtered_available_methods().length === 0
      ) {
        <div class="p-6 text-center">
          <div
            class="w-12 h-12 mx-auto mb-3 rounded-full bg-green-50 flex items-center justify-center"
          >
            <app-icon
              name="check-circle"
              [size]="24"
              class="text-green-500"
            ></app-icon>
          </div>
          <p class="text-sm text-text-secondary">
            @if (modal_search_term()) {
              No hay métodos disponibles con ese criterio
            } @else {
              ¡Todos los métodos están activados!
            }
          </p>
        </div>
      }

      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="ghost" (clicked)="closeAddModal()">
          Cerrar
        </app-button>
      </div>
    </app-modal>

    <!-- Configure Payment Method Modal -->
    <app-modal
      [isOpen]="show_config_modal()"
      [title]="'Configurar ' + (config_method?.display_name || '')"
      subtitle="Ingresa las credenciales para este método de pago"
      size="md"
      (closed)="closeConfigModal()"
    >
      <div slot="header">
        <div class="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center border border-purple-100">
          <app-icon name="settings" [size]="20" class="text-purple-600"></app-icon>
        </div>
      </div>

      <form [formGroup]="config_form" (ngSubmit)="saveConfigAndEnable()">
        <div class="space-y-4">
          @for (field of config_fields; track field.key) {
            <div>
              <label class="block text-sm font-medium mb-1" style="color: var(--color-text-primary)">
                {{ field.title }}
                @if (field.required) { <span class="text-red-500">*</span> }
              </label>
              @if (field.description) {
                <p class="text-xs mb-1" style="color: var(--color-text-muted)">{{ field.description }}</p>
              }
              @if (field.enum_values) {
                <select [formControlName]="field.key"
                        class="w-full px-3 py-2 rounded-lg border text-sm"
                        style="border-color: var(--color-border); background: var(--color-surface); color: var(--color-text-primary)">
                  @for (opt of field.enum_values; track opt) {
                    <option [value]="opt">{{ opt }}</option>
                  }
                </select>
              } @else {
                <input [formControlName]="field.key"
                       [type]="field.type === 'password' ? 'password' : 'text'"
                       [placeholder]="field.description || field.title"
                       class="w-full px-3 py-2 rounded-lg border text-sm"
                       style="border-color: var(--color-border); background: var(--color-surface); color: var(--color-text-primary)"
                />
              }
              @if (isWompiConfig() && wompiFieldHelp[field.key]) {
                <span class="field-help">{{ wompiFieldHelp[field.key] }}</span>
              }
            </div>
          }
        </div>

        @if (getWompiKeyWarning()) {
          <div class="wompi-warning">
            <app-icon name="alert-triangle" [size]="16"></app-icon>
            <span>{{ getWompiKeyWarning() }}</span>
          </div>
        }

        @if (isWompiConfig()) {
          <div class="wompi-test-section">
            <app-button
              label="Probar Conexión"
              variant="outline"
              size="sm"
              [loading]="wompiTestLoading"
              (clicked)="testWompiConnection()">
            </app-button>
            @if (wompiTestResult) {
              <div class="wompi-test-result" [class.success]="wompiTestResult.success" [class.error]="!wompiTestResult.success">
                <app-icon [name]="wompiTestResult.success ? 'check-circle' : 'x-circle'" [size]="16"></app-icon>
                <span>{{ wompiTestResult.message }}</span>
              </div>
            }
          </div>
        }
      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="ghost" (clicked)="closeConfigModal()">Cancelar</app-button>
        <app-button variant="primary" [loading]="config_saving()" (clicked)="saveConfigAndEnable()">
          Configurar y Agregar
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }

      .field-help {
        display: block;
        font-size: 0.75rem;
        color: var(--text-tertiary);
        margin-top: 0.25rem;
        line-height: 1.4;
      }

      .wompi-warning {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem;
        background: color-mix(in srgb, var(--warning) 10%, transparent);
        border: 1px solid var(--warning);
        border-radius: 0.5rem;
        font-size: 0.8125rem;
        color: var(--warning);
        margin-top: 0.75rem;
      }

      .wompi-test-section {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-top: 1rem;
        flex-wrap: wrap;
      }

      .wompi-test-result {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.8125rem;
      }

      .wompi-test-result.success {
        color: var(--success);
      }

      .wompi-test-result.error {
        color: var(--danger);
      }
    `,
  ],
})
export class PaymentsSettingsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Signals
  payment_methods = signal<StorePaymentMethod[]>([]);
  available_payment_methods = signal<SystemPaymentMethod[]>([]);
  payment_method_stats = signal<PaymentMethodStats | null>(null);
  store_payment_method_ids = signal<Set<string>>(new Set());

  is_loading = signal(false);
  is_loading_stats = signal(false);
  is_loading_available = signal(false);
  is_enabling = signal(false);
  enabling_method_id = signal<string | null>(null);

  // Config modal state
  show_config_modal = signal(false);
  config_method: SystemPaymentMethod | null = null;
  config_form: FormGroup = new FormGroup({});
  config_fields: Array<{ key: string; title: string; type: string; required: boolean; description: string; enum_values?: string[]; default_value?: any }> = [];
  config_saving = signal(false);

  // Wompi UX enhancements
  readonly wompiFieldHelp: Record<string, string> = {
    public_key: 'Se encuentra en tu dashboard de Wompi > Desarrolladores > Llaves del API',
    private_key: 'Se encuentra en tu dashboard de Wompi > Desarrolladores > Llaves del API. Nunca se comparte con el frontend.',
    events_secret: 'Se encuentra en tu dashboard de Wompi > Desarrolladores > Secretos para integración técnica > Eventos',
    integrity_secret: 'Se encuentra en tu dashboard de Wompi > Desarrolladores > Secretos para integración técnica > Integridad',
    environment: 'Usa SANDBOX para pruebas con llaves pub_test_/prv_test_. Usa PRODUCTION para pagos reales con llaves pub_prod_/prv_prod_.',
  };
  wompiTestLoading = false;
  wompiTestResult: { success: boolean; message: string } | null = null;

  // UI State
  search_term = signal('');
  modal_search_term = signal('');
  show_add_modal = signal(false);

  // Main table columns (desktop)
  table_columns: TableColumn[] = [
    { key: 'display_name', label: 'Método', sortable: true, priority: 1 },
    {
      key: 'type',
      label: 'Tipo',
      badge: true,
      priority: 2,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          cash: '#64748b',
          card: '#3b82f6',
          paypal: '#7c3aed',
          bank_transfer: '#f59e0b',
        },
      },
      transform: (v: string) => this.getTypeLabel(v),
    },
    {
      key: 'state',
      label: 'Estado',
      badge: true,
      priority: 2,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          enabled: '#22c55e',
          disabled: '#6b7280',
          requires_configuration: '#f59e0b',
          available: '#3b82f6',
        },
      },
      transform: (v: string) => this.getStateLabel(v),
    },
  ];

  // Mobile card config
  card_config: ItemListCardConfig = {
    titleKey: 'display_name',
    subtitleKey: 'provider',
    subtitleTransform: (item: CombinedPaymentMethod) =>
      item.is_store_method
        ? item.store_payment_method?.system_payment_method?.provider ||
          'Personalizado'
        : item.provider || 'Sistema',
    avatarFallbackIcon: 'credit-card',
    avatarShape: 'square',
    badgeKey: 'state',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        enabled: '#22c55e',
        disabled: '#6b7280',
        requires_configuration: '#f59e0b',
        available: '#3b82f6',
      },
    },
    badgeTransform: (v: string) => this.getStateLabel(v),
    detailKeys: [
      {
        key: 'type',
        label: 'Tipo',
        transform: (v: string) => this.getTypeLabel(v),
      },
      {
        key: 'is_store_method',
        label: 'Origen',
        transform: (v: boolean) => (v ? 'Tienda' : 'Sistema'),
      },
    ],
  };

  // Shared actions for main list
  table_actions: TableAction[] = [
    {
      label: (item: CombinedPaymentMethod) =>
        item.state === 'enabled' ? 'Desactivar' : 'Activar',
      icon: (item: CombinedPaymentMethod) =>
        item.state === 'enabled' ? 'pause' : 'check-circle',
      action: (item: CombinedPaymentMethod) => this.toggleMethod(item),
      show: (item: CombinedPaymentMethod) => item.is_store_method,
    },
    {
      label: 'Editar',
      icon: 'edit',
      action: (item: CombinedPaymentMethod) => this.editMethod(item),
      show: (item: CombinedPaymentMethod) => item.is_store_method,
      variant: 'primary',
    },
  ];

  // Modal table columns (desktop)
  modal_columns: TableColumn[] = [
    { key: 'display_name', label: 'Método', priority: 1 },
    {
      key: 'type',
      label: 'Tipo',
      badge: true,
      priority: 2,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          cash: '#64748b',
          card: '#3b82f6',
          paypal: '#7c3aed',
          bank_transfer: '#f59e0b',
        },
      },
      transform: (v: string) => this.getTypeLabel(v),
    },
  ];

  // Modal mobile card config
  modal_card_config: ItemListCardConfig = {
    titleKey: 'display_name',
    subtitleKey: 'description',
    subtitleTransform: (item: SystemPaymentMethod) =>
      item.description || 'Sin descripción',
    avatarFallbackIcon: 'plus-circle',
    avatarShape: 'square',
    badgeKey: 'type',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        cash: '#64748b',
        card: '#3b82f6',
        paypal: '#7c3aed',
        bank_transfer: '#f59e0b',
      },
    },
    badgeTransform: (v: string) => this.getTypeLabel(v),
  };

  // Modal actions
  modal_actions: TableAction[] = [
    {
      label: 'Agregar',
      icon: 'plus',
      action: (method: SystemPaymentMethod) => this.enableMethod(method),
      variant: 'primary',
      disabled: () => this.is_enabling(),
    },
  ];

  // Computed
  readonly all_methods = computed<CombinedPaymentMethod[]>(() => {
    const store_methods = this.payment_methods();
    const available_methods = this.available_payment_methods();
    const enabled_ids = new Set(
      store_methods.map((m) => m.system_payment_method_id),
    );

    const combined: CombinedPaymentMethod[] = [];

    // Add store payment methods
    store_methods.forEach((store_method) => {
      combined.push({
        id: store_method.id,
        display_name: store_method.display_name,
        type: store_method.system_payment_method?.type || 'unknown',
        provider: store_method.system_payment_method?.provider || 'unknown',
        state: store_method.state,
        is_system: false,
        is_store_method: true,
        system_payment_method_id: store_method.system_payment_method_id,
        store_payment_method: store_method,
        created_at: store_method.created_at,
      });
    });

    // Add available methods that are NOT yet added to store
    available_methods
      .filter((m) => !enabled_ids.has(m.id))
      .forEach((available_method) => {
        combined.push({
          id: available_method.id,
          display_name: available_method.display_name,
          type: available_method.type,
          provider: available_method.provider,
          state: 'available',
          is_system: available_method.provider === 'system',
          is_store_method: false,
          system_payment_method_id: available_method.id,
          created_at: available_method.created_at,
        });
      });

    return combined;
  });

  readonly filtered_methods = computed(() => {
    const term = this.search_term().toLowerCase();
    const methods = this.all_methods();
    if (!term) return methods;
    return methods.filter(
      (m) =>
        m.display_name?.toLowerCase().includes(term) ||
        m.type?.toLowerCase().includes(term) ||
        m.provider?.toLowerCase().includes(term),
    );
  });

  readonly filtered_available_methods = computed(() => {
    const term = this.modal_search_term().toLowerCase();
    const methods = this.available_payment_methods();
    if (!term) return methods;
    return methods.filter(
      (m) =>
        m.display_name?.toLowerCase().includes(term) ||
        m.type?.toLowerCase().includes(term) ||
        m.provider?.toLowerCase().includes(term) ||
        m.description?.toLowerCase().includes(term),
    );
  });

  constructor(
    private payment_methods_service: PaymentMethodsService,
    private toast_service: ToastService,
    private dialog_service: DialogService,
    private fb: FormBuilder,
  ) {}

  ngOnInit(): void {
    this.loadPaymentMethods();
    this.loadPaymentMethodStats();
    this.loadAvailablePaymentMethods();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchChange(term: string): void {
    this.search_term.set(term);
  }

  onModalSearchChange(term: string): void {
    this.modal_search_term.set(term);
  }

  openAddModal(): void {
    this.modal_search_term.set('');
    this.show_add_modal.set(true);
  }

  closeAddModal(): void {
    this.show_add_modal.set(false);
  }

  loadPaymentMethods(): void {
    this.is_loading.set(true);
    this.payment_methods_service
      .getStorePaymentMethods()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          const methods = response.data || response;
          this.payment_methods.set(methods || []);
          this.is_loading.set(false);
        },
        error: (error: any) => {
          this.toast_service.error(
            'Error al cargar métodos de pago: ' + error.message,
          );
          this.payment_methods.set([]);
          this.is_loading.set(false);
        },
      });
  }

  loadPaymentMethodStats(): void {
    this.is_loading_stats.set(true);
    this.payment_methods_service
      .getPaymentMethodStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats: any) => {
          this.payment_method_stats.set(stats.data || stats);
          this.is_loading_stats.set(false);
        },
        error: (error: any) => {
          this.toast_service.error(
            'Error al cargar estadísticas: ' + error.message,
          );
          this.payment_method_stats.set(null);
          this.is_loading_stats.set(false);
        },
      });
  }

  loadAvailablePaymentMethods(): void {
    this.is_loading_available.set(true);
    this.payment_methods_service
      .getAvailablePaymentMethods()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (methods: any) => {
          const methods_data = methods.data || methods;
          this.available_payment_methods.set(methods_data || []);
          this.is_loading_available.set(false);
        },
        error: (error: any) => {
          this.toast_service.error(
            'Error al cargar métodos disponibles: ' + error.message,
          );
          this.available_payment_methods.set([]);
          this.is_loading_available.set(false);
        },
      });
  }

  enableMethod(method: SystemPaymentMethod): void {
    if (method.requires_config && method.config_schema) {
      // Open config modal for methods that need configuration
      this.config_method = method;
      this.buildConfigForm(method.config_schema);
      this.show_config_modal.set(true);
      return;
    }

    // Simple confirmation for methods without config
    this.dialog_service
      .confirm({
        title: 'Agregar Método de Pago',
        message: `¿Deseas agregar "${method.display_name}" como método de pago?`,
        confirmText: 'Agregar',
        cancelText: 'Cancelar',
        confirmVariant: 'primary',
      })
      .then((confirmed: boolean) => {
        if (confirmed) {
          this.enabling_method_id.set(method.id);
          this.payment_methods_service
            .enablePaymentMethod(method.id, {
              display_name: method.display_name,
            })
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: () => {
                this.toast_service.success('Método de pago agregado correctamente');
                this.enabling_method_id.set(null);
                this.loadPaymentMethods();
                this.loadPaymentMethodStats();
                this.loadAvailablePaymentMethods();
              },
              error: (error: any) => {
                this.toast_service.error('Error al agregar método de pago: ' + error.message);
                this.enabling_method_id.set(null);
              },
            });
        }
      });
  }

  buildConfigForm(schema: any): void {
    const properties = schema.properties || {};
    const required_fields = schema['required'] || [];
    const controls: Record<string, any> = {};
    this.config_fields = [];

    for (const [key, prop] of Object.entries(properties) as [string, any][]) {
      const is_required = required_fields.includes(key);
      const default_value = this.config_method?.default_config?.[key] ?? prop.default ?? '';
      controls[key] = [default_value];
      this.config_fields.push({
        key,
        title: prop.title || key.replace(/_/g, ' '),
        type: prop.format === 'password' ? 'password' : (prop.type || 'string'),
        required: is_required,
        description: prop.description || '',
        enum_values: prop.enum,
        default_value,
      });
    }

    this.config_form = this.fb.group(controls);
  }

  saveConfigAndEnable(): void {
    if (!this.config_method || !this.config_form.valid) return;

    // Validate required fields
    const required = this.config_method.config_schema?.['required'] || [];
    for (const key of required) {
      if (!this.config_form.value[key]) {
        this.toast_service.error(`El campo "${key}" es requerido`);
        return;
      }
    }

    this.config_saving.set(true);
    this.payment_methods_service
      .enablePaymentMethod(this.config_method.id, {
        display_name: this.config_method.display_name,
        custom_config: this.config_form.value,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toast_service.success('Método de pago configurado y agregado correctamente');
          this.config_saving.set(false);
          this.show_config_modal.set(false);
          this.config_method = null;
          this.loadPaymentMethods();
          this.loadPaymentMethodStats();
          this.loadAvailablePaymentMethods();
        },
        error: (error: any) => {
          this.toast_service.error('Error: ' + (error.error?.message || error.message));
          this.config_saving.set(false);
        },
      });
  }

  closeConfigModal(): void {
    this.show_config_modal.set(false);
    this.config_method = null;
    this.config_fields = [];
    this.wompiTestResult = null;
  }

  isWompiConfig(): boolean {
    return this.config_method?.provider === 'wompi' || (this.config_method?.type as string) === 'wompi';
  }

  getWompiKeyWarning(): string | null {
    if (!this.config_form || !this.isWompiConfig()) return null;

    const env = this.config_form.value.environment || 'SANDBOX';
    const pubKey = this.config_form.value.public_key || '';
    const prvKey = this.config_form.value.private_key || '';

    if (env === 'SANDBOX') {
      if (pubKey && !pubKey.startsWith('pub_test_')) return 'La llave pública debe iniciar con pub_test_ para el ambiente SANDBOX';
      if (prvKey && !prvKey.startsWith('prv_test_')) return 'La llave privada debe iniciar con prv_test_ para el ambiente SANDBOX';
    } else if (env === 'PRODUCTION') {
      if (pubKey && !pubKey.startsWith('pub_prod_')) return 'La llave pública debe iniciar con pub_prod_ para el ambiente PRODUCTION';
      if (prvKey && !prvKey.startsWith('prv_prod_')) return 'La llave privada debe iniciar con prv_prod_ para el ambiente PRODUCTION';
    }

    return null;
  }

  testWompiConnection(): void {
    if (!this.config_method) return;
    this.wompiTestLoading = true;
    this.wompiTestResult = null;

    this.payment_methods_service
      .testPaymentMethodConfiguration(this.config_method.id, this.config_form.value)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.wompiTestLoading = false;
          this.wompiTestResult = {
            success: res.success,
            message: res.message || (res.success ? 'Conexión exitosa con Wompi' : 'Error de conexión'),
          };
        },
        error: (err) => {
          this.wompiTestLoading = false;
          this.wompiTestResult = {
            success: false,
            message: err?.message || 'Error al probar la conexión',
          };
        },
      });
  }

  toggleMethod(method: CombinedPaymentMethod): void {
    if (!method.is_store_method || !method.store_payment_method) return;

    const store_method = method.store_payment_method;

    if (store_method.state === 'enabled') {
      this.dialog_service
        .confirm({
          title: 'Desactivar Método de Pago',
          message: `¿Deseas desactivar "${method.display_name}"?`,
          confirmText: 'Desactivar',
          cancelText: 'Cancelar',
          confirmVariant: 'danger',
        })
        .then((confirmed: boolean) => {
          if (confirmed) {
            this.payment_methods_service
              .disablePaymentMethod(store_method.id)
              .pipe(takeUntil(this.destroy$))
              .subscribe({
                next: () => {
                  this.toast_service.success('Método de pago desactivado');
                  this.loadPaymentMethods();
                  this.loadPaymentMethodStats();
                },
                error: (error: any) => {
                  this.toast_service.error(
                    'Error al desactivar método: ' + error.message,
                  );
                },
              });
          }
        });
    } else {
      this.payment_methods_service
        .enableStorePaymentMethod(store_method.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toast_service.success('Método de pago activado');
            this.loadPaymentMethods();
            this.loadPaymentMethodStats();
          },
          error: (error: any) => {
            this.toast_service.error(
              'Error al activar método: ' + error.message,
            );
          },
        });
    }
  }

  editMethod(method: CombinedPaymentMethod): void {
    this.toast_service.info('Funcionalidad de edición próximamente');
  }

  getStateLabel(state: string): string {
    const state_map: Record<string, string> = {
      enabled: 'Activo',
      disabled: 'Inactivo',
      requires_configuration: 'Config. Requerida',
      available: 'Disponible',
    };
    return state_map[state] || state;
  }

  getTypeLabel(type: string): string {
    const type_map: Record<string, string> = {
      cash: 'Efectivo',
      card: 'Tarjeta',
      paypal: 'PayPal',
      bank_transfer: 'Transferencia',
    };
    return type_map[type] || type;
  }
}
