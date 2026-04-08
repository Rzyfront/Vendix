import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ShippingMethodsService } from './services/shipping-methods.service';
import {
  ShippingMethodStats,
  StoreShippingMethod,
  SystemShippingMethod,
} from './interfaces/shipping-methods.interface';
import { ShippingZone, ZoneStats } from './interfaces/shipping-zones.interface';
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
  OptionsDropdownComponent,
  DropdownAction,
  CardComponent,
} from '../../../../../../app/shared/components/index';
import { ShippingMethodsModalComponent } from './components/shipping-methods-modal.component';
import { ZoneModalComponent } from './components/index';
import { RatesModalComponent } from './components/rates-modal/rates-modal.component';
import { ModalComponent } from '../../../../../../app/shared/components/index';
import {
  ScrollableTabsComponent,
  ScrollableTab,
} from '../../../../../../app/shared/components/index';

@Component({
  selector: 'app-shipping-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    StatsComponent,
    ButtonComponent,
    IconComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    ScrollableTabsComponent,
    ShippingMethodsModalComponent,
    ModalComponent,
    ZoneModalComponent,
    RatesModalComponent,
    OptionsDropdownComponent,
    CardComponent,
  ],
  template: `
    <div class="w-full md:space-y-4">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Métodos Activos"
          [value]="shipping_method_stats()?.enabled_methods || 0"
          iconName="truck"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Zonas Config."
          [value]="zone_stats()?.total_zones || (zone_stats()?.store_zones || 0)"
          iconName="map-pin"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Tarifas Activas"
          [value]="zone_stats()?.store_rates || shipping_method_stats()?.total_rates || 0"
          iconName="tag"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
        <app-stats
          title="Pedidos c/Envío"
          [value]="shipping_method_stats()?.orders_using_shipping || 0"
          iconName="package"
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

      <!-- Tab: Methods -->
      @if (active_tab() === 'methods') {
        <app-card [responsive]="true" [padding]="false">

          <!-- Sticky search header -->
          <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                      md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
            <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
              <h2 class="text-[13px] font-bold text-gray-600 tracking-wide
                         md:text-lg md:font-semibold md:text-text-primary">
                Métodos de Envío ({{ filtered_methods().length }})
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
                  (clicked)="openAddMethodModal()"
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
                [columns]="methods_table_columns"
                [cardConfig]="methods_card_config"
                [actions]="methods_table_actions"
                [loading]="is_loading()"
                emptyMessage="No hay métodos de envío configurados"
                emptyIcon="truck"
              ></app-responsive-data-view>
            </div>
          }

          <!-- Loading State -->
          @if (is_loading()) {
            <div class="p-4 md:p-6 text-center">
              <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p class="mt-2 text-text-secondary">Cargando métodos de envío...</p>
            </div>
          }

          <!-- Empty State -->
          @if (!is_loading() && filtered_methods().length === 0) {
            <div class="p-8 text-center">
              <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center">
                <app-icon name="truck" [size]="24" class="text-gray-400"></app-icon>
              </div>
              @if (search_term()) {
                <p class="text-sm text-text-secondary">No se encontraron métodos con ese criterio</p>
              } @else {
                <p class="text-sm text-text-secondary">No hay métodos de envío configurados</p>
                <p class="text-xs text-gray-400 mt-1">Agrega tu primer método de envío</p>
              }
            </div>
          }
        </app-card>
      }

      <!-- Tab: Zones -->
      @if (active_tab() === 'zones') {
        <app-card [responsive]="true" [padding]="false">

          <!-- Sticky search header -->
          <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                      md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
            <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
              <h2 class="text-[13px] font-bold text-gray-600 tracking-wide
                         md:text-lg md:font-semibold md:text-text-primary">
                Zonas y Tarifas ({{ filtered_store_zones().length }})
              </h2>
              <div class="flex items-center gap-2 w-full md:w-auto">
                <app-inputsearch
                  class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                  size="sm"
                  placeholder="Buscar zonas..."
                  [debounceTime]="300"
                  [ngModel]="zones_search_term()"
                  (ngModelChange)="onZonesSearchChange($event)"
                ></app-inputsearch>
                <app-options-dropdown
                  class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                  [actions]="zones_dropdown_actions"
                  (actionClick)="onZonesActionClick($event)"
                ></app-options-dropdown>
              </div>
            </div>
          </div>

          <!-- Data View: Store Zones -->
          @if (!is_loading_store_zones() && filtered_store_zones().length > 0) {
            <div class="px-2 pb-2 pt-3 md:p-4">
              <app-responsive-data-view
                [data]="filtered_store_zones()"
                [columns]="zones_table_columns"
                [cardConfig]="zones_card_config"
                [actions]="zones_table_actions"
                [loading]="is_loading_store_zones()"
                emptyMessage="No hay zonas configuradas"
                emptyIcon="map-pin"
              ></app-responsive-data-view>
            </div>
          }

          <!-- Loading State -->
          @if (is_loading_store_zones()) {
            <div class="p-4 md:p-6 text-center">
              <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p class="mt-2 text-text-secondary">Cargando zonas...</p>
            </div>
          }

          <!-- Empty State -->
          @if (!is_loading_store_zones() && filtered_store_zones().length === 0) {
            <div class="p-8 text-center">
              <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center">
                <app-icon name="map-pin" [size]="24" class="text-gray-400"></app-icon>
              </div>
              @if (zones_search_term()) {
                <p class="text-sm text-text-secondary">No se encontraron zonas con ese criterio</p>
              } @else {
                <p class="text-sm text-text-secondary">No tienes zonas creadas</p>
                <p class="text-xs text-gray-400 mt-1">Activa un método de envío o crea una zona personalizada</p>
              }
            </div>
          }
        </app-card>
      }

      <!-- Zone CRUD Modal -->
        @if (show_zone_modal()) {
          <app-zone-modal
            [zone]="selected_zone"
            [mode]="zone_modal_mode"
            (close)="closeZoneModal()"
            (saved)="onZoneSaved()"
          ></app-zone-modal>
        }

        <!-- Rates Modal -->
        @if (show_rates_modal()) {
          <app-rates-modal
            [zone]="selected_zone_for_rates!"
            [is_read_only]="is_rates_read_only()"
            (close)="closeRatesModal()"
            (rates_changed)="onRatesChanged()"
          ></app-rates-modal>
        }

        <!-- System Zones Modal -->
        <app-modal
          [isOpen]="show_system_zones_modal()"
          title="Zonas del Sistema"
          subtitle="Duplica zonas preconfiguradas para personalizar"
          size="lg"
          (closed)="closeSystemZonesModal()"
        >
          <div slot="header">
            <div class="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center border border-green-100">
              <app-icon name="globe" [size]="20" class="text-green-600"></app-icon>
            </div>
          </div>

          <div class="mb-4">
            <app-inputsearch
              class="w-full"
              size="sm"
              placeholder="Buscar zonas del sistema..."
              [debounceTime]="300"
              [ngModel]="system_zones_search_term()"
              (ngModelChange)="onSystemZonesSearchChange($event)"
            ></app-inputsearch>
          </div>

          @if (is_loading_system_zones()) {
            <div class="p-4 text-center">
              <div class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              <p class="mt-2 text-sm text-text-secondary">Cargando zonas del sistema...</p>
            </div>
          }

          @if (!is_loading_system_zones() && filtered_system_zones().length > 0) {
            <app-responsive-data-view
              [data]="filtered_system_zones()"
              [columns]="system_zones_columns"
              [cardConfig]="system_zones_card_config"
              [actions]="system_zones_actions"
              [loading]="is_loading_system_zones()"
              emptyMessage="No hay zonas del sistema"
              emptyIcon="globe"
            ></app-responsive-data-view>
          }

          @if (!is_loading_system_zones() && filtered_system_zones().length === 0) {
            <div class="p-6 text-center">
              <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-green-50 flex items-center justify-center">
                <app-icon name="check-circle" [size]="24" class="text-green-500"></app-icon>
              </div>
              <p class="text-sm text-text-secondary">
                @if (system_zones_search_term()) {
                  No hay zonas del sistema con ese criterio
                } @else {
                  No hay zonas del sistema disponibles
                }
              </p>
            </div>
          }

          <div slot="footer" class="flex justify-end gap-3">
            <app-button variant="ghost" (clicked)="closeSystemZonesModal()">
              Cerrar
            </app-button>
          </div>
        </app-modal>

      <!-- Modal para agregar métodos disponibles -->
      @if (show_methods_modal()) {
        <app-shipping-methods-modal
          [available_methods]="available_shipping_methods()"
          [is_loading]="is_loading_available()"
          [is_enabling]="is_enabling()"
          (enable)="enableShippingMethod($event)"
          (close)="closeMethodsModal()"
          (refresh)="loadAvailableShippingMethods()"
        ></app-shipping-methods-modal>
      }
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
export class ShippingSettingsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Tabs configuration
  readonly tabs: ScrollableTab[] = [
    { id: 'methods', label: 'Métodos de Envío', icon: 'truck' },
    { id: 'zones', label: 'Zonas y Tarifas', icon: 'map-pin' },
  ];

  readonly active_tab = signal<'methods' | 'zones'>('methods');

  // Methods state (signals)
  readonly shipping_methods = signal<StoreShippingMethod[]>([]);
  readonly available_shipping_methods = signal<SystemShippingMethod[]>([]);
  readonly shipping_method_stats = signal<ShippingMethodStats | null>(null);

  readonly is_loading = signal(false);
  readonly is_loading_available = signal(false);
  readonly is_enabling = signal(false);

  // Search
  readonly search_term = signal('');

  readonly filtered_methods = computed(() => {
    const term = this.search_term().toLowerCase();
    const methods = this.shipping_methods();
    if (!term) return methods;
    return methods.filter(
      (m) =>
        m.name?.toLowerCase().includes(term) ||
        m.type?.toLowerCase().includes(term) ||
        m.provider_name?.toLowerCase().includes(term),
    );
  });

  // Zones search
  readonly zones_search_term = signal('');
  readonly system_zones_search_term = signal('');

  readonly filtered_store_zones = computed(() => {
    const term = this.zones_search_term().toLowerCase();
    const zones = this.store_zones();
    if (!term) return zones;
    return zones.filter(
      (z) =>
        z.name?.toLowerCase().includes(term) ||
        z.display_name?.toLowerCase().includes(term) ||
        z.countries?.some((c: string) => c.toLowerCase().includes(term)),
    );
  });

  readonly filtered_system_zones = computed(() => {
    const term = this.system_zones_search_term().toLowerCase();
    const zones = this.system_zones();
    if (!term) return zones;
    return zones.filter(
      (z) =>
        z.name?.toLowerCase().includes(term) ||
        z.display_name?.toLowerCase().includes(term) ||
        z.countries?.some((c: string) => c.toLowerCase().includes(term)),
    );
  });

  // Modal state (signals)
  readonly show_methods_modal = signal(false);
  readonly show_zone_modal = signal(false);
  readonly show_rates_modal = signal(false);
  readonly show_system_zones_modal = signal(false);
  readonly is_rates_read_only = signal(false);

  // Zones state (signals)
  readonly zone_stats = signal<ZoneStats | null>(null);
  readonly system_zones = signal<ShippingZone[]>([]);
  readonly store_zones = signal<ShippingZone[]>([]);
  readonly is_loading_system_zones = signal(false);
  readonly is_loading_store_zones = signal(false);

  // Zone modal state
  zone_modal_mode: 'create' | 'edit' = 'create';
  selected_zone?: ShippingZone;
  selected_zone_for_rates?: ShippingZone;

  // ========== TABLE CONFIG (absorbed from ShippingMethodsListComponent) ==========

  methods_table_columns: TableColumn[] = [
    {
      key: 'name',
      label: 'Método de Envío',
      sortable: true,
      priority: 1,
      transform: (value: string) => value || 'Sin nombre',
    },
    {
      key: 'type',
      label: 'Tipo',
      badge: true,
      priority: 3,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          custom: '#64748b',
          pickup: '#22c55e',
          own_fleet: '#3b82f6',
          carrier: '#f59e0b',
          third_party_provider: '#7c3aed',
        },
      },
      transform: (value: string) => this.getTypeLabel(value),
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
      transform: (value: boolean) => (value ? 'Activo' : 'Inactivo'),
    },
    {
      key: 'min_days',
      label: 'Tiempo',
      sortable: true,
      priority: 3,
      transform: (_value: any, item: StoreShippingMethod) =>
        this.formatDeliveryTime(item?.min_days, item?.max_days),
    },
    {
      key: 'created_at',
      label: 'Fecha Agregado',
      sortable: true,
      priority: 3,
      transform: (value: string) => new Date(value).toLocaleDateString(),
    },
  ];

  methods_card_config: ItemListCardConfig = {
    titleKey: 'name',
    titleTransform: (item: StoreShippingMethod) => item.name || 'Sin nombre',
    subtitleKey: 'type',
    subtitleTransform: (item: StoreShippingMethod) =>
      this.getTypeLabel(item.type),
    avatarFallbackIcon: 'truck',
    avatarShape: 'square',
    badgeKey: 'is_active',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: { true: '#22c55e', false: '#f59e0b' },
    },
    badgeTransform: (val: boolean) => (val ? 'Activo' : 'Inactivo'),
    detailKeys: [
      {
        key: 'provider_name',
        label: 'Proveedor',
        transform: (val: string) => val || 'Sin proveedor',
      },
      {
        key: 'created_at',
        label: 'Agregado',
        transform: (val: string) => new Date(val).toLocaleDateString(),
      },
    ],
  };

  methods_table_actions: TableAction[] = [
    {
      label: 'Configurar',
      icon: 'settings',
      variant: 'secondary',
      action: (row: StoreShippingMethod) =>
        this.openEditShippingMethodModal(row),
      show: (row: StoreShippingMethod) => row.is_active,
    },
    {
      label: (row: StoreShippingMethod) =>
        row.is_active ? 'Desactivar' : 'Activar',
      icon: (row: StoreShippingMethod) => (row.is_active ? 'pause' : 'play'),
      variant: 'primary',
      action: (row: StoreShippingMethod) => this.toggleShippingMethod(row),
    },
    {
      label: 'Eliminar',
      icon: 'trash',
      variant: 'danger',
      action: (row: StoreShippingMethod) =>
        this.confirmDeleteShippingMethod(row),
      show: (row: StoreShippingMethod) => !row.is_active,
    },
  ];

  // ========== ZONES TABLE CONFIG ==========

  zones_table_columns: TableColumn[] = [
    { key: 'name', label: 'Zona', sortable: true, priority: 1 },
    {
      key: 'countries',
      label: 'Países',
      priority: 2,
      transform: (value: string[]) => this.formatCountries(value),
    },
    {
      key: '_count.shipping_rates',
      label: 'Tarifas',
      priority: 2,
      defaultValue: '0',
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
  ];

  zones_card_config: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'countries',
    subtitleTransform: (item: ShippingZone) =>
      this.formatCountries(item.countries),
    avatarFallbackIcon: 'map-pin',
    avatarShape: 'square',
    badgeKey: 'is_active',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: { true: '#22c55e', false: '#f59e0b' },
    },
    badgeTransform: (value: boolean) => (value ? 'Activa' : 'Inactiva'),
    detailKeys: [
      { key: '_count.shipping_rates', label: 'Tarifas' },
      {
        key: 'source_type',
        label: 'Origen',
        transform: (val: string) =>
          val === 'system_copy' ? 'Del sistema' : 'Personalizada',
      },
    ],
    footerKey: 'created_at',
    footerLabel: 'Creada',
    footerTransform: (val: string) =>
      val ? new Date(val).toLocaleDateString() : '-',
  };

  zones_table_actions: TableAction[] = [
    {
      label: 'Tarifas',
      icon: 'tag',
      variant: 'primary',
      action: (zone: ShippingZone) => this.openRatesModal(zone, false),
    },
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'ghost',
      action: (zone: ShippingZone) => this.openZoneModal('edit', zone),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (zone: ShippingZone) => this.confirmDeleteZone(zone),
    },
  ];

  // Zones dropdown actions
  zones_dropdown_actions: DropdownAction[] = [
    {
      label: 'Crear zona',
      icon: 'plus',
      action: 'create_zone',
      variant: 'primary',
    },
    { label: 'Zonas del sistema', icon: 'globe', action: 'system_zones' },
  ];

  // System zones modal configs
  system_zones_columns: TableColumn[] = [
    { key: 'name', label: 'Zona', sortable: true, priority: 1 },
    {
      key: 'countries',
      label: 'Países',
      priority: 2,
      transform: (value: string[]) => this.formatCountries(value),
    },
    {
      key: '_count.shipping_rates',
      label: 'Tarifas',
      priority: 2,
      defaultValue: '0',
    },
  ];

  system_zones_card_config: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'countries',
    subtitleTransform: (item: ShippingZone) =>
      this.formatCountries(item.countries),
    avatarFallbackIcon: 'globe',
    avatarShape: 'square',
    detailKeys: [{ key: '_count.shipping_rates', label: 'Tarifas' }],
  };

  system_zones_actions: TableAction[] = [
    {
      label: 'Ver',
      icon: 'eye',
      variant: 'primary',
      action: (zone: ShippingZone) => this.openRatesModal(zone, true),
    },
    {
      label: 'Duplicar',
      icon: 'copy',
      variant: 'ghost',
      action: (zone: ShippingZone) => this.duplicateSystemZone(zone),
    },
  ];

  constructor(
    private shipping_methods_service: ShippingMethodsService,
    private toast_service: ToastService,
    private dialog_service: DialogService,
  ) {}

  ngOnInit(): void {
    this.loadShippingMethods();
    this.loadShippingMethodStats();
    this.loadAvailableShippingMethods();
    this.loadZoneStats();
    this.loadSystemZones();
    this.loadStoreZones();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Tab change handler
  onTabChange(tabId: string): void {
    this.active_tab.set(tabId as 'methods' | 'zones');
  }

  // Search handlers
  onSearchChange(term: string): void {
    this.search_term.set(term);
  }

  onZonesActionClick(action: string): void {
    if (action === 'create_zone') {
      this.openZoneModal('create');
    } else if (action === 'system_zones') {
      this.openSystemZonesModal();
    }
  }

  onZonesSearchChange(term: string): void {
    this.zones_search_term.set(term);
  }

  onSystemZonesSearchChange(term: string): void {
    this.system_zones_search_term.set(term);
  }

  // System zones modal
  openSystemZonesModal(): void {
    this.system_zones_search_term.set('');
    this.loadSystemZones();
    this.show_system_zones_modal.set(true);
  }

  closeSystemZonesModal(): void {
    this.show_system_zones_modal.set(false);
  }

  // ========== DATA LOADING ==========

  loadShippingMethods(): void {
    this.is_loading.set(true);
    this.shipping_methods_service
      .getStoreShippingMethods()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          this.shipping_methods.set(response.data || response);
          this.is_loading.set(false);
        },
        error: (error: any) => {
          this.toast_service.error(
            'Error al cargar métodos de envío: ' + error.message,
          );
          this.shipping_methods.set([]);
          this.is_loading.set(false);
        },
      });
  }

  loadShippingMethodStats(): void {
    this.shipping_methods_service
      .getShippingMethodStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats: any) => {
          this.shipping_method_stats.set(stats.data || stats);
        },
        error: (error: any) => {
          this.toast_service.error(
            'Error al cargar estadísticas: ' + error.message,
          );
          this.shipping_method_stats.set(null);
        },
      });
  }

  loadAvailableShippingMethods(): void {
    this.is_loading_available.set(true);
    this.shipping_methods_service
      .getAvailableShippingMethods()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (methods: any) => {
          const methods_data = methods.data || methods;
          this.available_shipping_methods.set(
            this.sortAvailableMethods(methods_data),
          );
          this.is_loading_available.set(false);
        },
        error: (error: any) => {
          this.toast_service.error(
            'Error al cargar métodos disponibles: ' + error.message,
          );
          this.available_shipping_methods.set([]);
          this.is_loading_available.set(false);
        },
      });
  }

  // ========== MODAL METHODS ==========

  openAddMethodModal(): void {
    this.loadAvailableShippingMethods();
    this.show_methods_modal.set(true);
  }

  closeMethodsModal(): void {
    this.show_methods_modal.set(false);
  }

  enableShippingMethod(method: SystemShippingMethod): void {
    this.dialog_service
      .confirm({
        title: 'Activar Método de Envío',
        message: `Al activar "${method.name}", se copiarán automáticamente las zonas y tarifas preconfiguradas del sistema. ¿Continuar?`,
        confirmText: 'Activar',
        cancelText: 'Cancelar',
        confirmVariant: 'primary',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.is_enabling.set(true);
          this.shipping_methods_service
            .enableShippingMethod(method.id, {
              name: method.name,
            })
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: (result: any) => {
                const data = result.data || result;
                const copyStats = data._copy_stats;
                let message = 'Método de envío activado correctamente';
                if (
                  copyStats &&
                  (copyStats.zones_copied > 0 || copyStats.rates_copied > 0)
                ) {
                  message = `✓ Método activado con ${copyStats.zones_copied} zonas y ${copyStats.rates_copied} tarifas copiadas`;
                }
                this.toast_service.success(message);

                this.loadShippingMethods();
                this.loadShippingMethodStats();
                this.loadAvailableShippingMethods();
                this.loadStoreZones();
                this.loadZoneStats();
                this.is_enabling.set(false);

                if (this.available_shipping_methods().length === 0) {
                  this.closeMethodsModal();
                }
              },
              error: (error: any) => {
                this.toast_service.error(
                  'Error al activar método de envío: ' + error.message,
                );
                this.is_enabling.set(false);
              },
            });
        }
      });
  }

  sortAvailableMethods(
    methods: SystemShippingMethod[],
  ): SystemShippingMethod[] {
    return methods.sort((a, b) => {
      if (a.display_order !== b.display_order) {
        return a.display_order - b.display_order;
      }
      return a.name.localeCompare(b.name);
    });
  }

  openEditShippingMethodModal(method: StoreShippingMethod): void {
    this.toast_service.info('Funcionalidad de edición próximamente');
  }

  toggleShippingMethod(method: StoreShippingMethod): void {
    if (method.is_active) {
      this.shipping_methods_service
        .disableShippingMethod(method.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toast_service.success('Método de envío desactivado');
            this.loadShippingMethods();
            this.loadShippingMethodStats();
          },
          error: (error: any) => {
            this.toast_service.error(
              'Error al desactivar método: ' + error.message,
            );
          },
        });
    } else {
      this.is_loading.set(true);
      this.shipping_methods_service
        .enableStoreShippingMethod(method.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toast_service.success('Método de envío activado');
            this.loadShippingMethods();
            this.loadShippingMethodStats();
            this.is_loading.set(false);
          },
          error: (error: any) => {
            this.is_loading.set(false);
            this.toast_service.error(
              'Error al activar método: ' + error.message,
            );
          },
        });
    }
  }

  confirmDeleteShippingMethod(method: StoreShippingMethod): void {
    this.dialog_service
      .confirm({
        title: 'Eliminar Método de Envío',
        message: `¿Estás seguro de eliminar "${method.name}"? Se eliminarán también todas sus zonas y tarifas.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.shipping_methods_service
            .deleteShippingMethod(method.id)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: () => {
                this.toast_service.success(
                  'Método de envío eliminado correctamente',
                );
                this.loadShippingMethods();
                this.loadShippingMethodStats();
                this.loadAvailableShippingMethods();
                this.loadStoreZones();
                this.loadZoneStats();
              },
              error: (error: any) => {
                this.toast_service.error(
                  'Error al eliminar método: ' + error.message,
                );
              },
            });
        }
      });
  }

  // ========== ZONES MANAGEMENT ==========

  loadZoneStats(): void {
    this.shipping_methods_service
      .getZoneStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats) => this.zone_stats.set(stats),
        error: () =>
          this.toast_service.error('Error al cargar estadísticas de zonas'),
      });
  }

  loadSystemZones(): void {
    this.is_loading_system_zones.set(true);
    this.shipping_methods_service
      .getSystemZones()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (zones) => {
          this.system_zones.set(zones);
          this.is_loading_system_zones.set(false);
        },
        error: () => {
          this.toast_service.error('Error al cargar zonas del sistema');
          this.is_loading_system_zones.set(false);
        },
      });
  }

  loadStoreZones(): void {
    this.is_loading_store_zones.set(true);
    this.shipping_methods_service
      .getStoreZones()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (zones) => {
          this.store_zones.set(zones);
          this.is_loading_store_zones.set(false);
        },
        error: () => {
          this.toast_service.error('Error al cargar tus zonas');
          this.is_loading_store_zones.set(false);
        },
      });
  }

  // Zone modal
  openZoneModal(mode: 'create' | 'edit', zone?: ShippingZone): void {
    this.zone_modal_mode = mode;
    this.selected_zone = zone;
    this.show_zone_modal.set(true);
  }

  closeZoneModal(): void {
    this.show_zone_modal.set(false);
    this.selected_zone = undefined;
  }

  onZoneSaved(): void {
    this.closeZoneModal();
    this.loadStoreZones();
    this.loadZoneStats();
  }

  confirmDeleteZone(zone: ShippingZone): void {
    this.dialog_service
      .confirm({
        title: 'Eliminar Zona',
        message: `¿Estás seguro de eliminar la zona "${zone.name}"? Se eliminarán también todas sus tarifas.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.shipping_methods_service
            .deleteZone(zone.id)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: () => {
                this.toast_service.success('Zona eliminada correctamente');
                this.loadStoreZones();
                this.loadZoneStats();
              },
              error: (error) => {
                this.toast_service.error(
                  'Error al eliminar zona: ' + error.message,
                );
              },
            });
        }
      });
  }

  // Rates modal
  openRatesModal(zone: ShippingZone, readOnly: boolean): void {
    this.selected_zone_for_rates = zone;
    this.is_rates_read_only.set(readOnly);
    this.show_rates_modal.set(true);
  }

  closeRatesModal(): void {
    this.show_rates_modal.set(false);
    this.selected_zone_for_rates = undefined;
  }

  onRatesChanged(): void {
    this.loadStoreZones();
    this.loadZoneStats();
  }

  // ========== DUPLICACIÓN Y SINCRONIZACIÓN ==========

  duplicateSystemZone(zone: ShippingZone): void {
    this.dialog_service
      .confirm({
        title: 'Duplicar Zona del Sistema',
        message: `Se creará una copia editable de "${zone.name}" con todas sus tarifas. ¿Continuar?`,
        confirmText: 'Duplicar',
        cancelText: 'Cancelar',
        confirmVariant: 'primary',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.shipping_methods_service
            .duplicateSystemZone(zone.id)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: () => {
                this.toast_service.success(
                  `Zona duplicada correctamente. Ahora puedes editarla.`,
                );
                this.loadStoreZones();
                this.loadZoneStats();
              },
              error: (error: any) => {
                this.toast_service.error(
                  'Error al duplicar zona: ' + error.message,
                );
              },
            });
        }
      });
  }

  syncZoneWithSystem(zone: ShippingZone): void {
    this.dialog_service
      .confirm({
        title: 'Sincronizar con Sistema',
        message: `Esto actualizará "${zone.name}" con los últimos cambios del sistema. Tus personalizaciones en la zona serán sobrescritas. ¿Continuar?`,
        confirmText: 'Sincronizar',
        cancelText: 'Cancelar',
        confirmVariant: 'primary',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.shipping_methods_service
            .syncZoneWithSystem(zone.id)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: (result: any) => {
                const stats = result._sync_stats || result.data?._sync_stats;
                let message = 'Zona sincronizada correctamente.';
                if (stats) {
                  message = `Zona sincronizada: ${stats.rates_updated} tarifas actualizadas, ${stats.rates_added} tarifas nuevas.`;
                }
                this.toast_service.success(message);
                this.loadStoreZones();
                this.loadZoneStats();
              },
              error: (error: any) => {
                this.toast_service.error(
                  'Error al sincronizar zona: ' + error.message,
                );
              },
            });
        }
      });
  }

  // ========== HELPERS ==========

  private getTypeLabel(type: string): string {
    const label_map: Record<string, string> = {
      custom: 'Personalizado',
      pickup: 'Recogida',
      own_fleet: 'Flota propia',
      carrier: 'Transportadora',
      third_party_provider: 'Externo',
    };
    return label_map[type] || type;
  }

  private formatDeliveryTime(min_days?: number, max_days?: number): string {
    if (min_days == null && max_days == null) return 'Sin definir';
    if (min_days === max_days) return `${min_days} días`;
    if (!max_days) return `${min_days}+ días`;
    return `${min_days}-${max_days} días`;
  }

  private readonly country_map: Record<string, string> = {
    DO: 'República Dominicana',
    US: 'Estados Unidos',
    CO: 'Colombia',
    MX: 'México',
    ES: 'España',
    AR: 'Argentina',
    CL: 'Chile',
    PE: 'Perú',
    VE: 'Venezuela',
    EC: 'Ecuador',
    GT: 'Guatemala',
    HN: 'Honduras',
    SV: 'El Salvador',
    NI: 'Nicaragua',
    CR: 'Costa Rica',
    PA: 'Panamá',
    PR: 'Puerto Rico',
    CU: 'Cuba',
    BR: 'Brasil',
    UY: 'Uruguay',
    PY: 'Paraguay',
    BO: 'Bolivia',
  };

  formatCountries(countries: string[]): string {
    if (!countries || countries.length === 0) return '-';
    const name = this.country_map[countries[0]] || countries[0];
    if (countries.length === 1) return name;
    return `${name} +${countries.length - 1}`;
  }
}
