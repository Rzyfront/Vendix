import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { ShippingMethodsService } from './services/shipping-methods.service';
import {
  ShippingMethodStats,
  StoreShippingMethod,
  SystemShippingMethod,
} from './interfaces/shipping-methods.interface';
import {
  ToastService,
  StatsComponent,
  DialogService,
} from '../../../../../../app/shared/components/index';
import { EnabledShippingMethodsListComponent } from './components/enabled-shipping-methods-list/enabled-shipping-methods-list.component';
import { AvailableShippingMethodsListComponent } from './components/available-shipping-methods-list/available-shipping-methods-list.component';

@Component({
  selector: 'app-shipping-settings',
  standalone: true,
  imports: [
    CommonModule,
    StatsComponent,
    EnabledShippingMethodsListComponent,
    AvailableShippingMethodsListComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats Cards: Sticky on mobile, static on desktop -->
      <div
        class="stats-container !mb-0 md:!mb-6 sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total Métodos"
          [value]="shipping_method_stats?.total_methods || 0"
          iconName="truck"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Activos"
          [value]="shipping_method_stats?.enabled_methods || 0"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Inactivos"
          [value]="shipping_method_stats?.disabled_methods || 0"
          iconName="pause-circle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
        <app-stats
          title="Pedidos c/Envío"
          [value]="shipping_method_stats?.orders_using_shipping || 0"
          iconName="package"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <!-- Shipping Methods Tables: Stack on mobile, side-by-side on desktop -->
      <div class="flex flex-col gap-4 lg:flex-row lg:gap-6">
        <!-- Enabled Shipping Methods -->
        <div class="w-full lg:w-1/2">
          <app-enabled-shipping-methods-list
            [shipping_methods]="shipping_methods"
            [is_loading]="is_loading"
            (edit)="openEditShippingMethodModal($event)"
            (toggle)="toggleShippingMethod($event)"
            (refresh)="loadShippingMethods()"
          ></app-enabled-shipping-methods-list>
        </div>

        <!-- Available Shipping Methods -->
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

  shipping_methods: StoreShippingMethod[] = [];
  available_shipping_methods: SystemShippingMethod[] = [];
  shipping_method_stats: ShippingMethodStats | null = null;

  is_loading = false;
  is_loading_stats = false;
  is_loading_available = false;
  is_enabling = false;

  constructor(
    private shipping_methods_service: ShippingMethodsService,
    private toast_service: ToastService,
    private dialog_service: DialogService
  ) {}

  ngOnInit(): void {
    this.loadShippingMethods();
    this.loadShippingMethodStats();
    this.loadAvailableShippingMethods();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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
        message: `¿Deseas activar ${method.name} para tu tienda?`,
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
              next: () => {
                this.toast_service.success(
                  'Método de envío activado correctamente'
                );
                this.loadShippingMethods();
                this.loadShippingMethodStats();
                this.loadAvailableShippingMethods();
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
}
