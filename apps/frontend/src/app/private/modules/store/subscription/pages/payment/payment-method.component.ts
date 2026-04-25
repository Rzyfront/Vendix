import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CardComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { StoreSubscriptionService } from '../../services/store-subscription.service';
import { PaymentMethod } from '../../interfaces/store-subscription.interface';

@Component({
  selector: 'app-payment-method',
  standalone: true,
  imports: [CardComponent, ButtonComponent, IconComponent],
  template: `
    <div class="w-full space-y-6">
      <div>
        <h1 class="text-xl font-bold text-text-primary">Método de Pago</h1>
        <p class="text-sm text-text-secondary">Gestiona tus métodos de pago</p>
      </div>

      @if (loading()) {
        <div class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      }

      @if (!loading()) {
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          @for (method of paymentMethods(); track method.id) {
            <app-card customClasses="{{ method.is_default ? 'ring-2 ring-primary' : '' }}">
              <div class="p-4 flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="p-3 bg-gray-100 rounded-xl">
                    <app-icon name="{{ method.type === 'card' ? 'credit-card' : 'landmark' }}" [size]="24" class="text-text-secondary"></app-icon>
                  </div>
                  <div>
                    <p class="font-medium text-text-primary">
                      {{ method.type === 'card' ? 'Tarjeta' : 'Transferencia' }}
                      @if (method.last4) {
                        <span class="text-text-secondary">****{{ method.last4 }}</span>
                      }
                    </p>
                    @if (method.brand) {
                      <p class="text-xs text-text-secondary capitalize">{{ method.brand }}</p>
                    }
                    @if (method.is_default) {
                      <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary font-medium">Predeterminado</span>
                    }
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  @if (!method.is_default) {
                    <app-button variant="ghost" size="sm" (clicked)="setDefault(method.id)">
                      Usar
                    </app-button>
                  }
                  <app-button variant="ghost" size="sm" (clicked)="removeMethod(method.id)">
                    <app-icon name="trash-2" [size]="16" class="text-red-500"></app-icon>
                  </app-button>
                </div>
              </div>
            </app-card>
          }
        </div>

        @if (paymentMethods().length === 0) {
          <div class="text-center p-8 space-y-4">
            <app-icon name="credit-card" [size]="48" class="text-text-secondary"></app-icon>
            <p class="text-text-secondary">No tienes métodos de pago registrados</p>
          </div>
        }

        <div class="mt-6">
          <app-card>
            <div class="p-4 space-y-4">
              <h3 class="text-sm font-semibold text-text-secondary uppercase tracking-wide">Agregar Método de Pago</h3>
              <p class="text-xs text-text-secondary">La tokenización de tarjeta se maneja a través de Wompi/Stripe</p>
              <app-button variant="outline" (clicked)="addPaymentMethod()">
                <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                Agregar Tarjeta
              </app-button>
            </div>
          </app-card>
        </div>
      }
    </div>
  `,
})
export class PaymentMethodComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private subscriptionService = inject(StoreSubscriptionService);
  private toastService = inject(ToastService);

  readonly paymentMethods = signal<PaymentMethod[]>([]);
  readonly loading = signal(false);

  ngOnInit(): void {
    this.loadPaymentMethods();
  }

  private loadPaymentMethods(): void {
    this.loading.set(true);
    this.subscriptionService.getPaymentMethods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) this.paymentMethods.set(res.data);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toastService.error('Error al cargar métodos de pago');
        },
      });
  }

  setDefault(id: string): void {
    this.subscriptionService.setDefaultPaymentMethod(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Método predeterminado actualizado');
          this.loadPaymentMethods();
        },
        error: () => this.toastService.error('Error al actualizar método'),
      });
  }

  removeMethod(id: string): void {
    this.subscriptionService.removePaymentMethod(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Método eliminado');
          this.loadPaymentMethods();
        },
        error: () => this.toastService.error('Error al eliminar método'),
      });
  }

  addPaymentMethod(): void {
    this.toastService.info('Integración con Wompi/Stripe pendiente');
  }
}
