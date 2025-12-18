import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { PaymentMethodsService } from './services/payment-methods.service';
import {
  PaymentMethodStats,
  StorePaymentMethod,
} from './interfaces/payment-methods.interface';
import {
  ButtonComponent,
  ToastService,
  IconComponent,
  StatsComponent,
  TableComponent,
  TableColumn,
  TableAction,
  DialogService,
} from '../../../../../../app/shared/components/index';

@Component({
  selector: 'app-payments-settings',
  standalone: true,
  imports: [
    CommonModule,
    ButtonComponent,
    IconComponent,
    StatsComponent,
    TableComponent,
  ],
  template: `
    <div class="p-6 space-y-6">
      <!-- Stats Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <app-stats
          title="Total de Métodos"
          [value]="payment_method_stats?.total_methods || 0"
          iconName="credit-card"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Métodos Activos"
          [value]="payment_method_stats?.enabled_methods || 0"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Requieren Configuración"
          [value]="payment_method_stats?.requires_config || 0"
          iconName="settings"
          iconBgColor="bg-yellow-100"
          iconColor="text-yellow-600"
        ></app-stats>
        <app-stats
          title="Transacciones Exitosas"
          [value]="payment_method_stats?.successful_transactions || 0"
          iconName="check"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
      </div>

      <!-- Payment Methods Tables -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Store Payment Methods Table -->
        <div class="bg-surface rounded-lg shadow-sm border border-border">
          <div class="flex items-center justify-between px-4 py-3 border-b border-border">
            <div>
              <h3 class="text-lg font-semibold text-text-primary">
                Métodos de Pago Activados ({{ payment_methods.length }})
              </h3>
              <p class="text-sm text-text-secondary">
                Métodos configurados para tu tienda
              </p>
            </div>
            <app-button
              variant="outline"
              size="sm"
              (clicked)="loadPaymentMethods()"
              [disabled]="is_loading"
            >
              <app-icon name="refresh" [size]="16" slot="icon"></app-icon>
            </app-button>
          </div>
          <div class="p-4">
            <app-table
              [data]="payment_methods"
              [columns]="enabled_payment_methods_columns"
              [actions]="enabled_payment_methods_actions"
              [loading]="is_loading"
              [emptyMessage]="'No hay métodos de pago activados'"
              size="md"
              [hoverable]="true"
              [bordered]="true"
            ></app-table>
          </div>
        </div>

        <!-- Available Payment Methods Table -->
        <div class="bg-surface rounded-lg shadow-sm border border-border">
          <div class="flex items-center justify-between px-4 py-3 border-b border-border">
            <div>
              <h3 class="text-lg font-semibold text-text-primary">
                Métodos Disponibles ({{ available_payment_methods.length }})
              </h3>
              <p class="text-sm text-text-secondary">
                Activa nuevos métodos para tu tienda
              </p>
            </div>
            <app-button
              variant="outline"
              size="sm"
              (clicked)="loadAvailablePaymentMethods()"
              [disabled]="is_loading_available"
            >
              <app-icon name="refresh" [size]="16" slot="icon"></app-icon>
            </app-button>
          </div>
          <div class="p-4">
            <app-table
              [data]="available_payment_methods"
              [columns]="available_payment_methods_columns"
              [actions]="available_payment_methods_actions"
              [loading]="is_loading_available"
              [emptyMessage]="'No hay métodos disponibles'"
              size="md"
              [hoverable]="true"
              [bordered]="true"
            ></app-table>
          </div>
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

  
  // Table configuration for enabled payment methods
  enabled_payment_methods_columns: TableColumn[] = [
    {
      key: 'display_name',
      label: 'Método',
      transform: (value: any) => value || 'Sin nombre'
    },
    {
      key: 'system_payment_method.provider',
      label: 'Proveedor',
      defaultValue: '-'
    },
    {
      key: 'state',
      label: 'Estado',
      badge: true,
      badgeConfig: { type: 'status' },
      transform: (value: string) => {
        const state_map: Record<string, string> = {
          enabled: 'Activo',
          disabled: 'Inactivo',
          requires_configuration: 'Requiere Configuración',
          archived: 'Archivado',
        };
        return state_map[value] || value;
      }
    },
    {
      key: 'system_payment_method.type',
      label: 'Tipo',
      transform: (value: string) => {
        const type_map: Record<string, string> = {
          cash: 'Efectivo',
          card: 'Tarjeta',
          paypal: 'PayPal',
          bank_transfer: 'Transferencia Bancaria',
        };
        return type_map[value] || value;
      }
    }
  ];

  // Table configuration for available payment methods
  available_payment_methods_columns: TableColumn[] = [
    {
      key: 'display_name',
      label: 'Método'
    },
    {
      key: 'provider',
      label: 'Origen',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          'system': '#64748b',
          'organization': '#7c3aed'
        }
      },
      transform: (value: string) => {
        return value === 'system' ? 'Sistema' : 'Organización';
      }
    },
    {
      key: 'type',
      label: 'Tipo',
      transform: (value: string) => {
        const type_map: Record<string, string> = {
          cash: 'Efectivo',
          card: 'Tarjeta',
          paypal: 'PayPal',
          bank_transfer: 'Transferencia Bancaria',
        };
        return type_map[value] || value;
      }
    }
  ];

  // Actions for enabled payment methods
  enabled_payment_methods_actions: TableAction[] = [
    {
      label: 'Configurar',
      icon: 'settings',
      action: (method: StorePaymentMethod) => this.openEditPaymentMethodModal(method),
      variant: 'ghost'
    },
    {
      label: (method: StorePaymentMethod) => method.state === 'enabled' ? 'Desactivar' : 'Activar',
      icon: (method: StorePaymentMethod) => method.state === 'enabled' ? 'pause' : 'play',
      action: (method: StorePaymentMethod) => this.togglePaymentMethod(method),
      variant: 'ghost'
    }
  ];

  // Actions for available payment methods
  available_payment_methods_actions: TableAction[] = [
    {
      label: 'Activar',
      icon: 'plus',
      action: (method: any) => this.enablePaymentMethod(method),
      variant: 'primary',
      disabled: () => this.is_enabling
    }
  ];

  constructor(
    private payment_methods_service: PaymentMethodsService,
    private toast_service: ToastService,
    private dialog_service: DialogService,
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
          // Service already extracted data from ResponseService format
          this.payment_methods = response.data || response;
          this.is_loading = false;
        },
        error: (error: any) => {
          this.toast_service.error(
            'Failed to load payment methods: ' + error.message,
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
          // Service already extracted data from ResponseService format
          this.payment_method_stats = stats.data || stats;
          this.is_loading_stats = false;
        },
        error: (error: any) => {
          this.toast_service.error(
            'Failed to load payment statistics: ' + error.message,
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
          // Service already extracted data from ResponseService format
          const methods_data = methods.data || methods;
          // Sort methods: organization methods first, then system methods
          this.available_payment_methods = this.sortAvailableMethods(methods_data);
          this.is_loading_available = false;
        },
        error: (error: any) => {
          this.toast_service.error(
            'Failed to load available payment methods: ' + error.message,
          );
          this.available_payment_methods = [];
          this.is_loading_available = false;
        },
      });
  }

  enablePaymentMethod(method: any): void {
    this.dialog_service.confirm({
      title: 'Activar Método de Pago',
      message: `¿Deseas activar ${method.display_name} para tu tienda?`,
      confirmText: 'Activar',
      cancelText: 'Cancelar',
      confirmVariant: 'primary'
    }).then((confirmed) => {
      if (confirmed) {
        this.is_enabling = true;
        this.payment_methods_service
          .enablePaymentMethod(method.id, {
            display_name: method.display_name
          })
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: () => {
              this.toast_service.success('Método de pago activado correctamente');
              this.loadPaymentMethods();
              this.loadPaymentMethodStats();
              this.loadAvailablePaymentMethods();
              this.is_enabling = false;
            },
            error: (error: any) => {
              this.toast_service.error(
                'Error al activar método de pago: ' + error.message,
              );
              this.is_enabling = false;
            },
          });
      }
    });
  }

  sortAvailableMethods(methods: any[]): any[] {
    return methods.sort((a, b) => {
      // Prioritize organization methods (assuming they have a flag or different provider pattern)
      const aIsOrg = this.isOrganizationMethod(a);
      const bIsOrg = this.isOrganizationMethod(b);

      if (aIsOrg && !bIsOrg) return -1;
      if (!aIsOrg && bIsOrg) return 1;

      return a.display_name.localeCompare(b.display_name);
    });
  }

  isOrganizationMethod(method: any): boolean {
    // Organization methods are those where the provider is not 'system'
    // System methods have provider = 'system'
    // Organization methods might have provider = 'organization' or the organization name
    return method.provider !== 'system';
  }

  openEditPaymentMethodModal(method: StorePaymentMethod): void {
    // TODO: Implement edit modal
    this.toast_service.info('Edit functionality coming soon');
  }

  togglePaymentMethod(method: StorePaymentMethod): void {
    if (method.state === 'enabled') {
      this.payment_methods_service
        .disablePaymentMethod(method.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toast_service.success('Payment method disabled successfully');
            this.loadPaymentMethods();
            this.loadPaymentMethodStats();
          },
          error: (error: any) => {
            this.toast_service.error(
              'Failed to disable payment method: ' + error.message,
            );
          },
        });
    } else {
      // For now, just show a message since state update is not available in DTO
      this.toast_service.info('Enable functionality through available actions');
    }
  }

  deletePaymentMethod(method: StorePaymentMethod): void {
    // TODO: Implement confirmation dialog
    this.toast_service.info('Delete functionality coming soon');
  }

  reorderPaymentMethods(method_ids: string[]): void {
    this.payment_methods_service
      .reorderPaymentMethods({ payment_method_ids: method_ids })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toast_service.success('Payment methods reordered successfully');
          this.loadPaymentMethods();
        },
        error: (error: any) => {
          this.toast_service.error(
            'Failed to reorder payment methods: ' + error.message,
          );
        },
      });
  }
}
