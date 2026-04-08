import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil, forkJoin } from 'rxjs';
import { map } from 'rxjs/operators';
import { ShippingMethodsService } from '../../services/shipping-methods.service';
import {
  ShippingMethodStats,
  StoreShippingMethod,
  SystemShippingMethod,
} from '../../interfaces/shipping-methods.interface';
import {
  ShippingZone,
  ShippingRate,
  ZoneStats,
  ZoneWithRates,
} from '../../interfaces/shipping-zones.interface';
import {
  ToastService,
  DialogService,
  StatsComponent,
  ButtonComponent,
  IconComponent,
  InputsearchComponent,
  BadgeComponent,
  EmptyStateComponent,
  ToggleComponent,
  ExpandableCardComponent,
  CardComponent,
} from '../../../../../../../shared/components/index';
import { ShippingMethodsModalComponent } from '../../components/shipping-methods-modal.component';
import {
  MethodZonesInlineComponent,
  AddRateWizardModalComponent,
} from '../../components/index';

@Component({
  selector: 'app-shipping-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    StatsComponent,
    ButtonComponent,
    IconComponent,
    InputsearchComponent,
    BadgeComponent,
    EmptyStateComponent,
    ToggleComponent,
    ExpandableCardComponent,
    CardComponent,
    MethodZonesInlineComponent,
    ShippingMethodsModalComponent,
    AddRateWizardModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-full md:space-y-4">
      <!-- Stats Cards (sticky on mobile, static on desktop) -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Métodos Activos"
          [value]="method_stats()?.enabled_methods ?? 0"
          smallText="Habilitados en tu tienda"
          iconName="truck"
          iconBgColor="bg-indigo-100"
          iconColor="text-indigo-600"
          [loading]="is_loading()"
        ></app-stats>
        <app-stats
          title="Zonas Config."
          [value]="zone_stats()?.total_zones ?? zone_stats()?.store_zones ?? 0"
          smallText="Zonas de envío"
          iconName="map-pin"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-600"
          [loading]="is_loading()"
        ></app-stats>
        <app-stats
          title="Tarifas Activas"
          [value]="zone_stats()?.total_rates ?? zone_stats()?.store_rates ?? 0"
          smallText="Tarifas configuradas"
          iconName="tag"
          iconBgColor="bg-violet-100"
          iconColor="text-violet-600"
          [loading]="is_loading()"
        ></app-stats>
        <app-stats
          title="Pedidos c/Envío"
          [value]="method_stats()?.orders_using_shipping ?? 0"
          smallText="Con método de envío"
          iconName="package"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
          [loading]="is_loading()"
        ></app-stats>
      </div>

      <!-- Content Card -->
      <app-card [responsive]="true" [padding]="false">
        <!-- Sticky search header -->
        <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <h2 class="text-[13px] font-bold text-gray-600 md:text-lg md:font-semibold md:text-text-primary">
                Métodos de Envío ({{ filtered_methods().length }})
              </h2>
            </div>
            <div class="flex items-center gap-2">
              @if (shipping_methods().length > 0) {
                <app-inputsearch placeholder="Buscar método..." (searchChange)="onSearchChange($event)" />
              }
              <app-button (clicked)="openMethodsModal()">
                <app-icon slot="icon" name="plus" [size]="16" />
                Agregar Método
              </app-button>
            </div>
          </div>
        </div>

        <!-- Method Cards List -->
        <div class="px-2 pb-2 pt-2 md:p-4">
          <div class="flex flex-col gap-3">
            @for (method of filtered_methods(); track method.id) {
              <app-expandable-card
                [expanded]="expanded_method_id() === method.id"
                (expandedChange)="onMethodExpand(method.id, $event)">

                <!-- Header slot -->
                <div slot="header" class="flex items-center gap-3 md:gap-4 flex-1 min-w-0">
                  <div
                    class="w-10 h-10 md:w-11 md:h-11 rounded-[10px] flex items-center justify-center shrink-0"
                    [style.background]="getMethodIconBg(method.type)">
                    <app-icon
                      [name]="getMethodIcon(method.type)"
                      [size]="20"
                      [style.color]="getMethodIconColor(method.type)"
                    />
                  </div>
                  <div class="flex flex-col gap-0.5 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="font-semibold text-sm md:text-base text-text-primary capitalize">{{ method.name }}</span>
                      <app-badge variant="primary" size="xs">{{ getTypeLabel(method.type) }}</app-badge>
                    </div>
                    <div class="flex items-center gap-3 text-text-secondary">
                      <span class="flex items-center gap-1">
                        <app-icon name="clock" [size]="12" />
                        <span class="text-xs">{{ formatDeliveryTime(method.min_days, method.max_days) }}</span>
                      </span>
                      <span class="flex items-center gap-1">
                        <app-icon name="map-pin" [size]="12" />
                        <span class="text-xs font-medium">{{ getMethodZoneCount(method.id) }}</span>
                        <span class="text-xs hidden md:inline">zonas</span>
                      </span>
                      <span class="flex items-center gap-1">
                        <app-icon name="tag" [size]="12" />
                        <span class="text-xs font-medium">{{ getMethodRateCount(method.id) }}</span>
                        <span class="text-xs hidden md:inline">tarifas</span>
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Actions slot -->
                <div slot="actions" class="flex items-center gap-2 shrink-0">
                  <app-toggle [checked]="method.is_active" (toggled)="toggleMethod(method)" />
                </div>

                <!-- Expandable body -->
                <app-method-zones-inline
                  [zones]="getZonesForMethod(method.id)"
                  [is_loading]="loading_zones_for() === method.id"
                  (addRate)="openRateWizard(method.id)"
                  (editRate)="onEditRate($event, method.id)"
                  (deleteRate)="confirmDeleteRate($event)"
                />
              </app-expandable-card>
            }

            <!-- Empty state -->
            @if (filtered_methods().length === 0 && !is_loading()) {
              <app-empty-state
                icon="truck"
                title="No hay métodos de envío configurados"
                description="Agrega tu primer método de envío para empezar a configurar tus tarifas"
                actionButtonText="Agregar Método"
                actionButtonIcon="plus"
                [showActionButton]="true"
                (actionClick)="openMethodsModal()"
              />
            }

            <!-- Loading skeleton -->
            @if (is_loading()) {
              @for (i of [1, 2, 3]; track i) {
                <div class="h-20 bg-surface rounded-xl animate-pulse"></div>
              }
            }
          </div>
        </div>
      </app-card>

      <!-- Methods Modal -->
      @if (show_methods_modal()) {
        <app-shipping-methods-modal
          [available_methods]="available_methods()"
          [is_loading]="false"
          [is_enabling]="is_enabling()"
          (enable)="enableShippingMethod($event)"
          (close)="closeMethodsModal()"
        />
      }

      <!-- Rate Wizard Modal -->
      @if (show_rate_wizard() && rate_wizard_method_id()) {
        <app-add-rate-wizard-modal
          [method_id]="rate_wizard_method_id()!"
          [existing_zones]="store_zones()"
          [edit_rate]="rate_wizard_edit_rate()"
          (close)="closeRateWizard()"
          (saved)="onRateSaved()"
        />
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .no-scrollbar {
      scrollbar-width: none;
      -ms-overflow-style: none;
      &::-webkit-scrollbar {
        display: none;
      }
    }

    :host ::ng-deep app-stats {
      min-width: 140px;

      @media (min-width: 768px) {
        min-width: auto;
      }
    }
  `,
})
export class ShippingDashboardComponent implements OnInit, OnDestroy {
  private shippingService = inject(ShippingMethodsService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private destroy$ = new Subject<void>();

  // ===== DATA =====
  shipping_methods = signal<StoreShippingMethod[]>([]);
  available_methods = signal<SystemShippingMethod[]>([]);
  method_stats = signal<ShippingMethodStats | null>(null);
  zone_stats = signal<ZoneStats | null>(null);
  store_zones = signal<ShippingZone[]>([]);

  // ===== UI STATE =====
  is_loading = signal<boolean>(true);
  is_enabling = signal<boolean>(false);
  search_term = signal<string>('');
  expanded_method_id = signal<number | null>(null);
  method_zones_cache = signal<Map<number, ZoneWithRates[]>>(new Map());
  loading_zones_for = signal<number | null>(null);

  // ===== MODALS =====
  show_methods_modal = signal<boolean>(false);
  show_rate_wizard = signal<boolean>(false);
  rate_wizard_method_id = signal<number | null>(null);
  rate_wizard_edit_rate = signal<ShippingRate | null>(null);

  // ===== COMPUTED =====
  filtered_methods = computed(() => {
    const term = this.search_term().toLowerCase();
    if (!term) return this.shipping_methods();
    return this.shipping_methods().filter(
      (m) =>
        m.name?.toLowerCase().includes(term) ||
        this.getTypeLabel(m.type).toLowerCase().includes(term) ||
        m.provider_name?.toLowerCase().includes(term),
    );
  });

  // ===== LIFECYCLE =====

  ngOnInit(): void {
    this.loadAll();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ===== DATA LOADING =====

  loadAll(): void {
    this.is_loading.set(true);
    this.loadShippingMethods();
    this.loadShippingMethodStats();
    this.loadZoneStats();
    this.loadStoreZones();
    this.loadAvailableShippingMethods();
  }

  loadShippingMethods(): void {
    this.shippingService
      .getStoreShippingMethods()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          this.shipping_methods.set(response.data || response);
          this.is_loading.set(false);
          this.loadAllMethodZonesInBackground();
        },
        error: (error: any) => {
          this.toastService.show({
            variant: 'error',
            description: 'Error al cargar metodos de envio: ' + error.message,
          });
          this.shipping_methods.set([]);
          this.is_loading.set(false);
        },
      });
  }

  loadShippingMethodStats(): void {
    this.shippingService
      .getShippingMethodStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats: any) => {
          this.method_stats.set(stats.data || stats);
        },
        error: (error: any) => {
          this.toastService.show({
            variant: 'error',
            description: 'Error al cargar estadisticas: ' + error.message,
          });
          this.method_stats.set(null);
        },
      });
  }

  loadZoneStats(): void {
    this.shippingService
      .getZoneStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats) => this.zone_stats.set(stats),
        error: () =>
          this.toastService.show({ variant: 'error', description: 'Error al cargar estadisticas de zonas' }),
      });
  }

  loadStoreZones(): void {
    this.shippingService
      .getStoreZones()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (zones) => {
          this.store_zones.set(zones);
          this.loadAllMethodZonesInBackground();
        },
        error: () => this.toastService.show({ variant: 'error', description: 'Error al cargar tus zonas' }),
      });
  }

  loadAvailableShippingMethods(): void {
    this.shippingService
      .getAvailableShippingMethods()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (methods: any) => {
          const methods_data = methods.data || methods;
          this.available_methods.set(this.sortAvailableMethods(methods_data));
        },
        error: (error: any) => {
          this.toastService.show({
            variant: 'error',
            description: 'Error al cargar metodos disponibles: ' + error.message,
          });
          this.available_methods.set([]);
        },
      });
  }

  // ===== METHOD OPERATIONS =====

  enableShippingMethod(method: SystemShippingMethod): void {
    this.dialogService
      .confirm({
        title: 'Activar Metodo de Envio',
        message: `Al activar "${method.name}", se copiaran automaticamente las zonas y tarifas preconfiguradas del sistema. Continuar?`,
        confirmText: 'Activar',
        cancelText: 'Cancelar',
        confirmVariant: 'primary',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.is_enabling.set(true);
          this.shippingService
            .enableShippingMethod(method.id, { name: method.name })
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: (result: any) => {
                const data = result.data || result;
                const copyStats = data._copy_stats;
                let message = 'Metodo de envio activado correctamente';
                if (
                  copyStats &&
                  (copyStats.zones_copied > 0 || copyStats.rates_copied > 0)
                ) {
                  message = `Metodo activado con ${copyStats.zones_copied} zonas y ${copyStats.rates_copied} tarifas copiadas`;
                }
                this.toastService.show({ variant: 'success', description: message });

                // Reload all data and invalidate cache
                this.method_zones_cache.set(new Map());
                this.loadShippingMethods();
                this.loadShippingMethodStats();
                this.loadAvailableShippingMethods();
                this.loadStoreZones();
                this.loadZoneStats();
                this.is_enabling.set(false);

                if (this.available_methods().length === 0) {
                  this.closeMethodsModal();
                }
              },
              error: (error: any) => {
                this.toastService.show({
                  variant: 'error',
                  description: 'Error al activar metodo de envio: ' + error.message,
                });
                this.is_enabling.set(false);
              },
            });
        }
      });
  }

  toggleMethod(method: StoreShippingMethod): void {
    if (method.is_active) {
      this.shippingService
        .disableShippingMethod(method.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toastService.show({ variant: 'success', description: 'Metodo de envio desactivado' });
            this.loadShippingMethods();
            this.loadShippingMethodStats();
          },
          error: (error: any) => {
            this.toastService.show({
              variant: 'error',
              description: 'Error al desactivar metodo: ' + error.message,
            });
          },
        });
    } else {
      this.shippingService
        .enableStoreShippingMethod(method.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toastService.show({ variant: 'success', description: 'Metodo de envio activado' });
            this.loadShippingMethods();
            this.loadShippingMethodStats();
          },
          error: (error: any) => {
            this.toastService.show({
              variant: 'error',
              description: 'Error al activar metodo: ' + error.message,
            });
          },
        });
    }
  }

  confirmDeleteShippingMethod(method: StoreShippingMethod): void {
    this.dialogService
      .confirm({
        title: 'Eliminar Metodo de Envio',
        message: `Estas seguro de eliminar "${method.name}"? Se eliminaran tambien todas sus zonas y tarifas.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.shippingService
            .deleteShippingMethod(method.id)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: () => {
                this.toastService.show({
                  variant: 'success',
                  description: 'Metodo de envio eliminado correctamente',
                });
                this.method_zones_cache.set(new Map());
                this.loadShippingMethods();
                this.loadShippingMethodStats();
                this.loadAvailableShippingMethods();
                this.loadStoreZones();
                this.loadZoneStats();
              },
              error: (error: any) => {
                this.toastService.show({
                  variant: 'error',
                  description: 'Error al eliminar metodo: ' + error.message,
                });
              },
            });
        }
      });
  }

  // ===== EXPANDABLE CARD =====

  onMethodExpand(methodId: number, expanded: boolean): void {
    if (expanded) {
      this.expanded_method_id.set(methodId);
      this.loadZonesForMethod(methodId);
    } else {
      this.expanded_method_id.set(null);
    }
  }

  loadZonesForMethod(methodId: number): void {
    const cache = this.method_zones_cache();
    if (cache.has(methodId)) return; // Already cached

    this.loading_zones_for.set(methodId);
    const zones = this.store_zones();

    if (zones.length === 0) {
      this.loading_zones_for.set(null);
      const newCache = new Map(cache);
      newCache.set(methodId, []);
      this.method_zones_cache.set(newCache);
      return;
    }

    // For each zone, load rates and filter by methodId
    const rateRequests = zones.map((z) =>
      this.shippingService.getStoreZoneRates(z.id).pipe(
        map((rates) =>
          rates
            .filter((r) => r.shipping_method_id === methodId)
            .map((rate) => ({ zone: z, rate })),
        ),
      ),
    );

    forkJoin(rateRequests)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (results) => {
          const zonesWithRates: ZoneWithRates[] = results.flat();
          const newCache = new Map(this.method_zones_cache());
          newCache.set(methodId, zonesWithRates);
          this.method_zones_cache.set(newCache);
          this.loading_zones_for.set(null);
        },
        error: () => this.loading_zones_for.set(null),
      });
  }

  getZonesForMethod(methodId: number): ZoneWithRates[] {
    return this.method_zones_cache().get(methodId) || [];
  }

  getMethodZoneCount(methodId: number): number {
    const cached = this.method_zones_cache().get(methodId);
    return cached ? cached.length : 0;
  }

  getMethodRateCount(methodId: number): number {
    return this.getMethodZoneCount(methodId); // 1 rate per zone-method pair
  }

  loadAllMethodZonesInBackground(): void {
    const methods = this.shipping_methods();
    if (methods.length === 0 || this.store_zones().length === 0) return;
    methods.forEach((m) => this.loadZonesForMethod(m.id));
  }

  // ===== RATE OPERATIONS =====

  onEditRate(rate: ShippingRate, methodId: number): void {
    this.rate_wizard_edit_rate.set(rate);
    this.rate_wizard_method_id.set(methodId);
    this.show_rate_wizard.set(true);
  }

  confirmDeleteRate(rate: ShippingRate): void {
    this.dialogService
      .confirm({
        title: 'Eliminar Tarifa',
        message: 'Estas seguro de eliminar esta tarifa? Esta accion no se puede deshacer.',
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.shippingService
            .deleteRate(rate.id)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: () => {
                this.toastService.show({ variant: 'success', description: 'Tarifa eliminada correctamente' });
                // Invalidate cache for the method that had this rate
                this.invalidateCacheForRate(rate);
                this.loadZoneStats();
                this.loadShippingMethodStats();
              },
              error: (error: any) => {
                this.toastService.show({
                  variant: 'error',
                  description: 'Error al eliminar tarifa: ' + error.message,
                });
              },
            });
        }
      });
  }

  private invalidateCacheForRate(rate: ShippingRate): void {
    const methodId = rate.shipping_method_id;
    const newCache = new Map(this.method_zones_cache());
    newCache.delete(methodId);
    this.method_zones_cache.set(newCache);
    // Reload zones for this method if it's currently expanded
    if (this.expanded_method_id() === methodId) {
      this.loadZonesForMethod(methodId);
    }
  }

  // ===== MODALS =====

  openMethodsModal(): void {
    this.loadAvailableShippingMethods();
    this.show_methods_modal.set(true);
  }

  closeMethodsModal(): void {
    this.show_methods_modal.set(false);
  }

  openRateWizard(methodId: number): void {
    this.rate_wizard_edit_rate.set(null);
    this.rate_wizard_method_id.set(methodId);
    this.show_rate_wizard.set(true);
  }

  closeRateWizard(): void {
    this.show_rate_wizard.set(false);
    this.rate_wizard_method_id.set(null);
    this.rate_wizard_edit_rate.set(null);
  }

  onRateSaved(): void {
    // Invalidate cache for affected method and reload
    const methodId = this.rate_wizard_method_id();
    if (methodId) {
      const newCache = new Map(this.method_zones_cache());
      newCache.delete(methodId);
      this.method_zones_cache.set(newCache);
      this.loadZonesForMethod(methodId);
    }
    this.loadZoneStats();
    this.loadShippingMethodStats();
    this.closeRateWizard();
  }

  // ===== HELPERS =====

  getTypeLabel(type: string): string {
    const label_map: Record<string, string> = {
      custom: 'Personalizado',
      pickup: 'Recogida',
      own_fleet: 'Flota propia',
      carrier: 'Transportadora',
      third_party_provider: 'Externo',
    };
    return label_map[type] || type;
  }

  formatDeliveryTime(min_days?: number, max_days?: number): string {
    if (min_days == null && max_days == null) return 'Sin definir';
    if (min_days === max_days) return `${min_days} dias`;
    if (!max_days) return `${min_days}+ dias`;
    return `${min_days}-${max_days} dias`;
  }

  getMethodIcon(type: string): string {
    const icon_map: Record<string, string> = {
      custom: 'package',
      pickup: 'store',
      own_fleet: 'truck',
      carrier: 'send',
      third_party_provider: 'globe',
    };
    return icon_map[type] || 'truck';
  }

  getMethodIconBg(type: string): string {
    const bg_map: Record<string, string> = {
      custom: '#F1F5F9',
      pickup: '#ECFDF5',
      own_fleet: '#EFF6FF',
      carrier: '#FFF7ED',
      third_party_provider: '#F5F3FF',
    };
    return bg_map[type] || '#F1F5F9';
  }

  getMethodIconColor(type: string): string {
    const color_map: Record<string, string> = {
      custom: '#64748B',
      pickup: '#10B981',
      own_fleet: '#3B82F6',
      carrier: '#F59E0B',
      third_party_provider: '#8B5CF6',
    };
    return color_map[type] || '#64748B';
  }

  onSearchChange(term: string): void {
    this.search_term.set(term);
  }

  private sortAvailableMethods(
    methods: SystemShippingMethod[],
  ): SystemShippingMethod[] {
    return methods.sort((a, b) => {
      if (a.display_order !== b.display_order) {
        return a.display_order - b.display_order;
      }
      return a.name.localeCompare(b.name);
    });
  }
}
