import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  IconComponent,
  ButtonComponent,
  CardComponent,
  StatsComponent,
  EmptyStateComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { PaymentMethodsService } from '../../../../store/settings/payments/services/payment-methods.service';
import { StorePaymentMethod } from '../../../../store/settings/payments/interfaces/payment-methods.interface';

@Component({
  selector: 'app-subscription-payment-methods',
  standalone: true,
  imports: [
    IconComponent,
    ButtonComponent,
    CardComponent,
    StatsComponent,
    EmptyStateComponent,
  ],
  template: `
    <div class="w-full space-y-6">
      <div class="flex items-center gap-3">
        <button (click)="goBack()" class="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <app-icon name="arrow-left" [size]="20"></app-icon>
        </button>
        <div>
          <h1 class="text-xl font-bold text-text-primary">Métodos de Pago</h1>
          <p class="text-sm text-text-secondary">Configuración de pago para suscripciones</p>
        </div>
      </div>

      <div class="stats-container !mb-0">
        <app-stats
          title="Activos"
          [value]="stats().enabled"
          smallText="Métodos"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Inactivos"
          [value]="stats().disabled"
          smallText="Métodos"
          iconName="pause-circle"
          iconBgColor="bg-yellow-100"
          iconColor="text-yellow-600"
        ></app-stats>
        <app-stats
          title="Total Transacciones"
          [value]="stats().total_transactions"
          smallText="Exitosas"
          iconName="repeat"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
      </div>

      <div class="flex justify-end">
        <app-button variant="primary" size="sm" (clicked)="addPaymentMethod()">
          <app-icon name="plus" [size]="16" slot="icon"></app-icon>
          Agregar Método
        </app-button>
      </div>

      @if (loading()) {
        <div class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      }

      @if (!loading() && paymentMethods().length === 0) {
        <app-empty-state
          icon="credit-card"
          title="Sin métodos de pago"
          description="Agrega un método de pago para procesar facturas de suscripción"
          actionButtonText="Agregar Método"
          (actionClick)="addPaymentMethod()"
        ></app-empty-state>
      }

      @if (!loading() && paymentMethods().length > 0) {
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          @for (method of paymentMethods(); track method.id) {
            <app-card>
              <div class="p-4 space-y-3">
                <div class="flex items-start justify-between">
                  <div class="flex items-center gap-3">
                    <div class="p-2 bg-primary/10 rounded-lg">
                      <app-icon [name]="getMethodIcon(method.system_payment_method.type || 'card')" [size]="20" class="text-primary"></app-icon>
                    </div>
                    <div>
                      <p class="font-semibold text-text-primary">{{ method.display_name || 'Método de Pago' }}</p>
                      <p class="text-sm text-text-secondary">{{ method.system_payment_method.provider || 'Sistema' }}</p>
                    </div>
                  </div>
                  <span
                    class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium"
                    [class.bg-green-100]="method.state === 'enabled'"
                    [class.text-green-700]="method.state === 'enabled'"
                    [class.bg-yellow-100]="method.state === 'disabled'"
                    [class.text-yellow-700]="method.state === 'disabled'"
                  >
                    {{ method.state === 'enabled' ? 'Activo' : 'Inactivo' }}
                  </span>
                </div>

                <div class="flex gap-2 pt-2">
                  <app-button
                    variant="ghost"
                    size="sm"
                    (clicked)="toggleMethod(method)"
                  >
                    {{ method.state === 'enabled' ? 'Desactivar' : 'Activar' }}
                  </app-button>
                  @if (method.state === 'enabled') {
                    <app-button
                      variant="ghost"
                      size="sm"
                      (clicked)="configureMethod(method)"
                    >
                      Configurar
                    </app-button>
                  }
                  <app-button
                    variant="ghost"
                    size="sm"
                    (clicked)="deleteMethod(method)"
                  >
                    Eliminar
                  </app-button>
                </div>
              </div>
            </app-card>
          }
        </div>
      }
    </div>
  `,
})
export class SubscriptionPaymentMethodsComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private currencyService = inject(CurrencyFormatService);
  private toastService = inject(ToastService);
  private paymentMethodsService = inject(PaymentMethodsService);

  readonly paymentMethods = signal<StorePaymentMethod[]>([]);
  readonly loading = signal(false);
  readonly stats = signal({
    enabled: 0,
    disabled: 0,
    total_transactions: 0,
  });

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.loadPaymentMethods();
    this.loadStats();
  }

  private loadPaymentMethods(): void {
    this.loading.set(true);
    this.paymentMethodsService.getStorePaymentMethods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (Array.isArray(res)) {
            this.paymentMethods.set(res);
          } else if (res?.data) {
            this.paymentMethods.set(res.data);
          }
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toastService.error('Error al cargar métodos de pago');
        },
      });
  }

  private loadStats(): void {
    this.paymentMethodsService.getPaymentMethodStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.stats.set({
            enabled: res?.enabled_methods || 0,
            disabled: res?.disabled_methods || 0,
            total_transactions: res?.successful_transactions || 0,
          });
        },
      });
  }

  goBack(): void {
    history.back();
  }

  addPaymentMethod(): void {
    this.paymentMethodsService.getAvailablePaymentMethods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (available) => {
          if (available.length > 0) {
            const method = available[0];
            this.paymentMethodsService.enablePaymentMethod(
              method.id.toString(),
              {}
            ).pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe({
                next: () => {
                  this.toastService.success('Método agregado');
                  this.loadPaymentMethods();
                },
                error: () => this.toastService.error('Error al agregar método'),
              });
          }
        },
      });
  }

  toggleMethod(method: StorePaymentMethod): void {
    if (method.state === 'enabled') {
      this.paymentMethodsService.disablePaymentMethod(method.id.toString())
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.toastService.success('Método desactivado');
            this.loadPaymentMethods();
          },
          error: () => this.toastService.error('Error al desactivar método'),
        });
    } else {
      this.paymentMethodsService.enableStorePaymentMethod(method.id.toString())
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.toastService.success('Método activado');
            this.loadPaymentMethods();
          },
          error: () => this.toastService.error('Error al activar método'),
        });
    }
  }

  configureMethod(method: StorePaymentMethod): void {
    this.toastService.info('Configuración no implementada en esta versión');
  }

  deleteMethod(method: StorePaymentMethod): void {
    if (!confirm('¿Estás seguro de eliminar este método de pago?')) return;

    this.paymentMethodsService.deletePaymentMethod(method.id.toString())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Método eliminado');
          this.loadPaymentMethods();
        },
        error: (err) => {
          this.toastService.error(err?.error?.message || 'No se puede eliminar método en uso');
        },
      });
  }

  getMethodIcon(type: string): string {
    const icons: Record<string, string> = {
      cash: 'dollar-sign',
      card: 'credit-card',
      paypal: 'globe',
      bank_transfer: 'building',
    };
    return icons[type] || 'credit-card';
  }
}
