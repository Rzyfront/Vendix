import { Component, OnInit, OnDestroy, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { ShippingMethodsService } from './services/shipping-methods.service';
import {
  ShippingMethodStats,
  StoreShippingMethod,
  SystemShippingMethod,
} from './interfaces/shipping-methods.interface';
import {
  ShippingZone,
  ZoneStats,
  CreateZoneDto,
} from './interfaces/shipping-zones.interface';
import {
  ToastService,
  StatsComponent,
  DialogService,
} from '../../../../../../app/shared/components/index';
import { EnabledShippingMethodsListComponent } from './components/enabled-shipping-methods-list/enabled-shipping-methods-list.component';
import { AvailableShippingMethodsListComponent } from './components/available-shipping-methods-list/available-shipping-methods-list.component';
import {
  ShippingZonesListComponent,
  ZoneModalComponent,
  RatesModalComponent,
} from './components/index';
import {
  DashboardTabsComponent,
  DashboardTab,
} from '../../dashboard/components/dashboard-tabs.component';

@Component({
  selector: 'app-shipping-settings',
  standalone: true,
  imports: [
    CommonModule,
    StatsComponent,
    DashboardTabsComponent,
    EnabledShippingMethodsListComponent,
    AvailableShippingMethodsListComponent,
    ShippingZonesListComponent,
    ZoneModalComponent,
    RatesModalComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats Cards (Siempre visibles arriba) -->
      <div
        class="stats-container !mb-0 md:!mb-6 sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Métodos Activos"
          [value]="shipping_method_stats?.enabled_methods || 0"
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
          [value]="zone_stats()?.store_rates || shipping_method_stats?.total_rates || 0"
          iconName="tag"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
        <app-stats
          title="Pedidos c/Envío"
          [value]="shipping_method_stats?.orders_using_shipping || 0"
          iconName="package"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

      <!-- Tabs (debajo de stats, como Dashboard) -->
      <app-dashboard-tabs
        [tabs]="tabs"
        [activeTab]="active_tab()"
        (tabChange)="onTabChange($event)"
      />

      <!-- Tab: Methods -->
      @if (active_tab() === 'methods') {
        <!-- Shipping Methods Tables - 2 columnas lado a lado -->
        <div class="flex flex-col gap-4 lg:flex-row lg:gap-6">
          <div class="w-full lg:w-1/2">
            <app-enabled-shipping-methods-list
              [shipping_methods]="shipping_methods"
              [is_loading]="is_loading"
              (edit)="openEditShippingMethodModal($event)"
              (toggle)="toggleShippingMethod($event)"
              (refresh)="loadShippingMethods()"
            ></app-enabled-shipping-methods-list>
          </div>
          <div class="w-full lg:w-1/2">
            <app-available-shipping-methods-list
              [shipping_methods]="available_shipping_methods"
              [is_loading]="is_loading_available"
              [is_enabling]="is_enabling"
              (enable)="enableShippingMethod($event)"
              (refresh)="loadAvailableShippingMethods()"
            ></app-available-shipping-methods-list>
          </div>
        </div>
      }

      <!-- Tab: Zones - 2 columnas lado a lado -->
      @if (active_tab() === 'zones') {
        <div class="flex flex-col gap-4 lg:flex-row lg:gap-6">
          <!-- Store Zones (CRUD, left column - primary) -->
          <div class="w-full lg:w-1/2">
            <app-shipping-zones-list
              [zones]="store_zones()"
              [is_loading]="is_loading_store_zones()"
              [is_system]="false"
              [show_create]="true"
              [show_source_badge]="true"
              title="Mis Configuraciones"
              subtitle="Zonas editables de tu tienda"
              empty_message="No tienes zonas creadas"
              empty_description="Activa un método de envío o crea una zona personalizada"
              (create)="openZoneModal('create')"
              (edit)="openZoneModal('edit', $event)"
              (delete)="confirmDeleteZone($event)"
              (view_rates)="openRatesModal($event, false)"
              (sync)="syncZoneWithSystem($event)"
            ></app-shipping-zones-list>
          </div>

          <!-- System Zones (read-only, right column - reference) -->
          <div class="w-full lg:w-1/2">
            <app-shipping-zones-list
              [zones]="system_zones()"
              [is_loading]="is_loading_system_zones()"
              [is_system]="true"
              [show_duplicate]="true"
              title="Configuraciones del Sistema"
              subtitle="Solo lectura - Duplica para personalizar"
              empty_message="No hay zonas del sistema"
              empty_description="El administrador aún no ha configurado zonas"
              (view_rates)="openRatesModal($event, true)"
              (duplicate)="duplicateSystemZone($event)"
            ></app-shipping-zones-list>
          </div>
        </div>

        <!-- Zone Modal -->
        <app-zone-modal
          #zoneModal
          [is_open]="is_zone_modal_open()"
          [mode]="zone_modal_mode()"
          [zone]="selected_zone()"
          (close)="closeZoneModal()"
          (save)="saveZone($event)"
        ></app-zone-modal>

        <!-- Rates Modal -->
        <app-rates-modal
          #ratesModal
          [is_open]="is_rates_modal_open()"
          [zone]="selected_zone_for_rates()"
          [is_read_only]="is_rates_read_only()"
          (close)="closeRatesModal()"
          (rates_changed)="onRatesChanged()"
        ></app-rates-modal>
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
  @ViewChild('zoneModal') zoneModal!: ZoneModalComponent;
  @ViewChild('ratesModal') ratesModal!: RatesModalComponent;

  private destroy$ = new Subject<void>();

  // Tabs configuration (Dashboard-style)
  readonly tabs: DashboardTab[] = [
    { id: 'methods', label: 'Métodos de Envío', shortLabel: 'Métodos', icon: 'truck' },
    { id: 'zones', label: 'Zonas y Tarifas', shortLabel: 'Zonas', icon: 'map-pin' },
  ];

  // Active tab (now a signal)
  readonly active_tab = signal<'methods' | 'zones'>('methods');

  // Methods state
  shipping_methods: StoreShippingMethod[] = [];
  available_shipping_methods: SystemShippingMethod[] = [];
  shipping_method_stats: ShippingMethodStats | null = null;

  is_loading = false;
  is_loading_stats = false;
  is_loading_available = false;
  is_enabling = false;

  // Zones state (signals)
  readonly zone_stats = signal<ZoneStats | null>(null);
  readonly system_zones = signal<ShippingZone[]>([]);
  readonly store_zones = signal<ShippingZone[]>([]);
  readonly is_loading_system_zones = signal(false);
  readonly is_loading_store_zones = signal(false);

  // Zone modal state
  readonly is_zone_modal_open = signal(false);
  readonly zone_modal_mode = signal<'create' | 'edit'>('create');
  readonly selected_zone = signal<ShippingZone | null>(null);

  // Rates modal state
  readonly is_rates_modal_open = signal(false);
  readonly selected_zone_for_rates = signal<ShippingZone | null>(null);
  readonly is_rates_read_only = signal(false);

  constructor(
    private shipping_methods_service: ShippingMethodsService,
    private toast_service: ToastService,
    private dialog_service: DialogService
  ) {}

  ngOnInit(): void {
    this.loadShippingMethods();
    this.loadShippingMethodStats();
    this.loadAvailableShippingMethods();
    // Eagerly load all zone data so it's ready when switching tabs
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

  loadShippingMethods(): void {
    this.is_loading = true;
    this.shipping_methods_service
      .getStoreShippingMethods()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          this.shipping_methods = response.data || response;
          this.is_loading = false;
        },
        error: (error: any) => {
          this.toast_service.error(
            'Error al cargar métodos de envío: ' + error.message
          );
          this.shipping_methods = [];
          this.is_loading = false;
        },
      });
  }

  loadShippingMethodStats(): void {
    this.is_loading_stats = true;
    this.shipping_methods_service
      .getShippingMethodStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats: any) => {
          this.shipping_method_stats = stats.data || stats;
          this.is_loading_stats = false;
        },
        error: (error: any) => {
          this.toast_service.error(
            'Error al cargar estadísticas: ' + error.message
          );
          this.shipping_method_stats = null;
          this.is_loading_stats = false;
        },
      });
  }

  loadAvailableShippingMethods(): void {
    this.is_loading_available = true;
    this.shipping_methods_service
      .getAvailableShippingMethods()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (methods: any) => {
          const methods_data = methods.data || methods;
          this.available_shipping_methods =
            this.sortAvailableMethods(methods_data);
          this.is_loading_available = false;
        },
        error: (error: any) => {
          this.toast_service.error(
            'Error al cargar métodos disponibles: ' + error.message
          );
          this.available_shipping_methods = [];
          this.is_loading_available = false;
        },
      });
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
          this.is_enabling = true;
          this.shipping_methods_service
            .enableShippingMethod(method.id, {
              display_name: method.name,
            })
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: (result: any) => {
                // Show One-Click Magic feedback
                const data = result.data || result;
                const copyStats = data._copy_stats;
                let message = 'Método de envío activado correctamente';
                if (copyStats && (copyStats.zones_copied > 0 || copyStats.rates_copied > 0)) {
                  message = `✓ Método activado con ${copyStats.zones_copied} zonas y ${copyStats.rates_copied} tarifas copiadas`;
                }
                this.toast_service.success(message);

                // Reload all data
                this.loadShippingMethods();
                this.loadShippingMethodStats();
                this.loadAvailableShippingMethods();
                // Also reload zones since they may have been auto-copied
                this.loadStoreZones();
                this.loadZoneStats();
                this.is_enabling = false;
              },
              error: (error: any) => {
                this.toast_service.error(
                  'Error al activar método de envío: ' + error.message
                );
                this.is_enabling = false;
              },
            });
        }
      });
  }

  sortAvailableMethods(methods: SystemShippingMethod[]): SystemShippingMethod[] {
    return methods.sort((a, b) => {
      // Sort by display_order first, then by name
      if (a.display_order !== b.display_order) {
        return a.display_order - b.display_order;
      }
      return a.name.localeCompare(b.name);
    });
  }

  openEditShippingMethodModal(method: StoreShippingMethod): void {
    // TODO: Implement edit modal
    this.toast_service.info('Funcionalidad de edición próximamente');
  }

  toggleShippingMethod(method: StoreShippingMethod): void {
    if (method.state === 'enabled') {
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
              'Error al desactivar método: ' + error.message
            );
          },
        });
    } else {
      this.is_loading = true;
      this.shipping_methods_service
        .enableStoreShippingMethod(method.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toast_service.success('Método de envío activado');
            this.loadShippingMethods();
            this.loadShippingMethodStats();
            this.is_loading = false;
          },
          error: (error: any) => {
            this.is_loading = false;
            this.toast_service.error(
              'Error al activar método: ' + error.message
            );
          },
        });
    }
  }

  deleteShippingMethod(method: StoreShippingMethod): void {
    // TODO: Implement confirmation dialog
    this.toast_service.info('Funcionalidad de eliminación próximamente');
  }

  // ========== ZONES MANAGEMENT ==========

  loadZoneStats(): void {
    this.shipping_methods_service
      .getZoneStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats) => this.zone_stats.set(stats),
        error: (error) =>
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
        error: (error) => {
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
        error: (error) => {
          this.toast_service.error('Error al cargar tus zonas');
          this.is_loading_store_zones.set(false);
        },
      });
  }

  // Zone modal
  openZoneModal(mode: 'create' | 'edit', zone?: ShippingZone): void {
    this.zone_modal_mode.set(mode);
    this.selected_zone.set(zone || null);
    this.is_zone_modal_open.set(true);

    // Reset form when modal opens
    setTimeout(() => {
      this.zoneModal?.resetAndPopulate(zone || null);
    }, 0);
  }

  closeZoneModal(): void {
    this.is_zone_modal_open.set(false);
    this.selected_zone.set(null);
  }

  saveZone(dto: CreateZoneDto): void {
    this.zoneModal?.setIsSaving(true);

    if (this.zone_modal_mode() === 'create') {
      this.shipping_methods_service
        .createZone(dto)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toast_service.success('Zona creada correctamente');
            this.closeZoneModal();
            this.loadStoreZones();
            this.loadZoneStats();
            this.zoneModal?.setIsSaving(false);
          },
          error: (error) => {
            this.toast_service.error('Error al crear zona: ' + error.message);
            this.zoneModal?.setIsSaving(false);
          },
        });
    } else {
      const zone = this.selected_zone();
      if (!zone) return;

      this.shipping_methods_service
        .updateZone(zone.id, dto)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toast_service.success('Zona actualizada correctamente');
            this.closeZoneModal();
            this.loadStoreZones();
            this.zoneModal?.setIsSaving(false);
          },
          error: (error) => {
            this.toast_service.error('Error al actualizar zona: ' + error.message);
            this.zoneModal?.setIsSaving(false);
          },
        });
    }
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
                this.toast_service.error('Error al eliminar zona: ' + error.message);
              },
            });
        }
      });
  }

  // Rates modal
  openRatesModal(zone: ShippingZone, readOnly: boolean): void {
    this.selected_zone_for_rates.set(zone);
    this.is_rates_read_only.set(readOnly);
    this.is_rates_modal_open.set(true);

    // Load rates when modal opens
    setTimeout(() => {
      this.ratesModal?.loadRates();
    }, 0);
  }

  closeRatesModal(): void {
    this.is_rates_modal_open.set(false);
    this.selected_zone_for_rates.set(null);
  }

  onRatesChanged(): void {
    this.loadStoreZones();
    this.loadZoneStats();
  }

  // ========== DUPLICACIÓN Y SINCRONIZACIÓN ==========

  /**
   * Duplicate a system zone to create an editable copy.
   * Used when clicking "Duplicar" on a system zone.
   */
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
              next: (result: any) => {
                this.toast_service.success(
                  `Zona duplicada correctamente. Ahora puedes editarla.`
                );
                this.loadStoreZones();
                this.loadZoneStats();
              },
              error: (error: any) => {
                this.toast_service.error(
                  'Error al duplicar zona: ' + error.message
                );
              },
            });
        }
      });
  }

  /**
   * Sync a store zone (system_copy) with its source system zone.
   * Applies any updates from the system zone.
   */
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
                  'Error al sincronizar zona: ' + error.message
                );
              },
            });
        }
      });
  }
}
