import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { PaymentMethodsService } from './services/payment-methods.service';
import {
  PaymentMethodStats,
  StorePaymentMethod,
} from './interfaces/payment-methods.interface';
import {
  ToastService,
  StatsComponent,
  DialogService,
} from '../../../../../../app/shared/components/index';
import { EnabledPaymentMethodsListComponent } from './components/enabled-payment-methods-list/enabled-payment-methods-list.component';
import { AvailablePaymentMethodsListComponent } from './components/available-payment-methods-list/available-payment-methods-list.component';

@Component({
  selector: 'app-payments-settings',
  standalone: true,
  imports: [
    CommonModule,
    StatsComponent,
    EnabledPaymentMethodsListComponent,
    AvailablePaymentMethodsListComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats Cards: Sticky on mobile, static on desktop -->
      <div class="stats-container !mb-0 md:!mb-6 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total Métodos"
          [value]="payment_method_stats?.total_methods || 0"
          iconName="credit-card"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Activos"
          [value]="payment_method_stats?.enabled_methods || 0"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Requieren Config"
          [value]="payment_method_stats?.requires_config || 0"
          iconName="settings"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
        <app-stats
          title="Transacciones"
          [value]="payment_method_stats?.successful_transactions || 0"
          iconName="check"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <!-- Payment Methods Tables: Stack on mobile, side-by-side on desktop -->
      <div class="flex flex-col gap-4 lg:flex-row lg:gap-6">
        <!-- Enabled Payment Methods -->
        <div class="w-full lg:w-1/2">
          <app-enabled-payment-methods-list
            [payment_methods]="payment_methods"
            [is_loading]="is_loading"
            (edit)="openEditPaymentMethodModal($event)"
            (toggle)="togglePaymentMethod($event)"
            (refresh)="loadPaymentMethods()"
          ></app-enabled-payment-methods-list>
        </div>

        <!-- Available Payment Methods -->
        <div class="w-full lg:w-1/2">
          <app-available-payment-methods-list
            [payment_methods]="available_payment_methods"
            [is_loading]="is_loading_available"
            [is_enabling]="is_enabling"
            (enable)="enablePaymentMethod($event)"
            (refresh)="loadAvailablePaymentMethods()"
          ></app-available-payment-methods-list>
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
export class PaymentsSettingsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  payment_methods: StorePaymentMethod[] = [];
  available_payment_methods: any[] = [];
  payment_method_stats: PaymentMethodStats | null = null;

  is_loading = false;
  is_loading_stats = false;
  is_loading_available = false;
  is_enabling = false;

  constructor(
    private payment_methods_service: PaymentMethodsService,
    private toast_service: ToastService,
    private dialog_service: DialogService
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

  loadPaymentMethods(): void {
    this.is_loading = true;
    this.payment_methods_service
      .getStorePaymentMethods()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          this.payment_methods = response.data || response;
          this.is_loading = false;
        },
        error: (error: any) => {
          this.toast_service.error(
            'Error al cargar métodos de pago: ' + error.message
          );
          this.payment_methods = [];
          this.is_loading = false;
        },
      });
  }

  loadPaymentMethodStats(): void {
    this.is_loading_stats = true;
    this.payment_methods_service
      .getPaymentMethodStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats: any) => {
          this.payment_method_stats = stats.data || stats;
          this.is_loading_stats = false;
        },
        error: (error: any) => {
          this.toast_service.error(
            'Error al cargar estadísticas: ' + error.message
          );
          this.payment_method_stats = null;
          this.is_loading_stats = false;
        },
      });
  }

  loadAvailablePaymentMethods(): void {
    this.is_loading_available = true;
    this.payment_methods_service
      .getAvailablePaymentMethods()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (methods: any) => {
          const methods_data = methods.data || methods;
          this.available_payment_methods =
            this.sortAvailableMethods(methods_data);
          this.is_loading_available = false;
        },
        error: (error: any) => {
          this.toast_service.error(
            'Error al cargar métodos disponibles: ' + error.message
          );
          this.available_payment_methods = [];
          this.is_loading_available = false;
        },
      });
  }

  enablePaymentMethod(method: any): void {
    this.dialog_service
      .confirm({
        title: 'Activar Método de Pago',
        message: `¿Deseas activar ${method.display_name} para tu tienda?`,
        confirmText: 'Activar',
        cancelText: 'Cancelar',
        confirmVariant: 'primary',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.is_enabling = true;
          this.payment_methods_service
            .enablePaymentMethod(method.id, {
              display_name: method.display_name,
            })
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: () => {
                this.toast_service.success(
                  'Método de pago activado correctamente'
                );
                this.loadPaymentMethods();
                this.loadPaymentMethodStats();
                this.loadAvailablePaymentMethods();
                this.is_enabling = false;
              },
              error: (error: any) => {
                this.toast_service.error(
                  'Error al activar método de pago: ' + error.message
                );
                this.is_enabling = false;
              },
            });
        }
      });
  }

  sortAvailableMethods(methods: any[]): any[] {
    return methods.sort((a, b) => {
      const aIsOrg = this.isOrganizationMethod(a);
      const bIsOrg = this.isOrganizationMethod(b);

      if (aIsOrg && !bIsOrg) return -1;
      if (!aIsOrg && bIsOrg) return 1;

      return a.display_name.localeCompare(b.display_name);
    });
  }

  isOrganizationMethod(method: any): boolean {
    return method.provider !== 'system';
  }

  openEditPaymentMethodModal(method: StorePaymentMethod): void {
    // TODO: Implement edit modal
    this.toast_service.info('Funcionalidad de edición próximamente');
  }

  togglePaymentMethod(method: StorePaymentMethod): void {
    if (method.state === 'enabled') {
      this.payment_methods_service
        .disablePaymentMethod(method.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toast_service.success('Método de pago desactivado');
            this.loadPaymentMethods();
            this.loadPaymentMethodStats();
          },
          error: (error: any) => {
            this.toast_service.error(
              'Error al desactivar método: ' + error.message
            );
          },
        });
    } else {
      this.is_loading = true;
      this.payment_methods_service
        .enableStorePaymentMethod(method.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toast_service.success('Método de pago activado');
            this.loadPaymentMethods();
            this.loadPaymentMethodStats();
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

  deletePaymentMethod(method: StorePaymentMethod): void {
    // TODO: Implement confirmation dialog
    this.toast_service.info('Funcionalidad de eliminación próximamente');
  }

  reorderPaymentMethods(method_ids: string[]): void {
    this.payment_methods_service
      .reorderPaymentMethods({ payment_method_ids: method_ids })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toast_service.success('Orden actualizado correctamente');
          this.loadPaymentMethods();
        },
        error: (error: any) => {
          this.toast_service.error(
            'Error al reordenar métodos: ' + error.message
          );
        },
      });
  }
}
