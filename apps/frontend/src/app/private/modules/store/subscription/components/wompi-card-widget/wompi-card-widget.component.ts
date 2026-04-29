import {
  Component,
  model,
  output,
  signal,
  inject,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ButtonComponent,
  ModalComponent,
  ToastService,
} from '../../../../../../shared/components';
import { WompiService } from '../../../../../../shared/services/wompi.service';
import { StoreSubscriptionService } from '../../services/store-subscription.service';

export interface WompiTokenizeResult {
  provider_token: string;
  type: string;
  last4?: string;
  brand?: string;
  expiry_month?: string;
  expiry_year?: string;
  card_holder?: string;
}

export interface WompiWidgetConfig {
  public_key: string;
  currency: string;
  amount_in_cents: number;
  reference: string;
  signature_integrity: string;
  redirect_url: string;
  customer_email: string;
}

@Component({
  selector: 'app-wompi-card-widget',
  standalone: true,
  imports: [CommonModule, ModalComponent, ButtonComponent],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      (cancel)="onClose()"
      title="Agregar Tarjeta"
      subtitle="Ingresa los datos de tu tarjeta de forma segura a través de Wompi"
      size="md"
    >
      <div class="p-4 space-y-4">
        @if (loading()) {
          <div class="flex items-center justify-center py-8">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
          </div>
        } @else {
          <div class="space-y-3">
            <p class="text-sm text-text-secondary">
              Al hacer clic en "Abrir Widget Wompi" serás redirigido al formulario
              seguro de Wompi para ingresar los datos de tu tarjeta.
            </p>
            <app-button
              variant="primary"
              [loading]="widgetLoading()"
              (clicked)="openWompiWidget()"
              class="w-full"
            >
              Abrir Widget Wompi
            </app-button>
          </div>
        }
      </div>

      <div slot="footer" class="flex gap-3 justify-end w-full">
        <app-button variant="ghost" (clicked)="onClose()">
          Cancelar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class WompiCardWidgetComponent {
  private destroyRef = inject(DestroyRef);
  private wompiService = inject(WompiService);
  private subscriptionService = inject(StoreSubscriptionService);
  private toastService = inject(ToastService);

  readonly isOpen = model<boolean>(false);

  readonly tokenized = output<WompiTokenizeResult>();

  readonly loading = signal(false);
  readonly widgetLoading = signal(false);

  private widgetConfig: WompiWidgetConfig | null = null;

  constructor() {
    // Load config when modal opens
    // Use effect to react to model changes
    // But simple approach: parent calls load when opening
  }

  loadWidgetConfigIfNeeded(): void {
    if (!this.widgetConfig) {
      this.loadWidgetConfig();
    }
  }

  private loadWidgetConfig(): void {
    this.loading.set(true);
    this.subscriptionService
      .getPaymentMethodWidgetConfig()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.widgetConfig = res.data as WompiWidgetConfig;
          }
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toastService.error('Error al cargar configuración del widget');
          this.onClose();
        },
      });
  }

  async openWompiWidget(): Promise<void> {
    if (!this.widgetConfig) {
      this.toastService.error('Configuración del widget no disponible');
      return;
    }

    this.widgetLoading.set(true);

    try {
      await this.wompiService.loadWidgetScript();

      const checkout = new (window as any).WidgetCheckout({
        currency: this.widgetConfig.currency,
        amountInCents: this.widgetConfig.amount_in_cents,
        reference: this.widgetConfig.reference,
        publicKey: this.widgetConfig.public_key,
        signature: { integrity: this.widgetConfig.signature_integrity },
        redirectUrl: this.widgetConfig.redirect_url,
        customerData: { email: this.widgetConfig.customer_email },
      });

      checkout.open((result: any) => {
        this.widgetLoading.set(false);
        const transaction = result?.transaction;

        if (!transaction) {
          this.toastService.warning('Tokenización cancelada');
          return;
        }

        if (transaction.status === 'APPROVED') {
          const paymentMethod = transaction.payment_method ?? {};
          const extra = paymentMethod.extra ?? {};

          this.tokenized.emit({
            provider_token: transaction.id,
            type: 'card',
            last4: extra.last_four ?? '',
            brand: extra.brand ?? '',
            expiry_month: extra.exp_month ?? '',
            expiry_year: extra.exp_year ?? '',
            card_holder: extra.card_holder ?? '',
          });

          this.toastService.success('Tarjeta tokenizada exitosamente');
          this.onClose();
          return;
        }

        if (
          transaction.status === 'DECLINED' ||
          transaction.status === 'ERROR'
        ) {
          this.toastService.error(
            'La tarjeta fue rechazada. Intenta con otra.',
          );
          return;
        }

        this.toastService.info('Pago pendiente de confirmación.');
      });
    } catch (err) {
      this.widgetLoading.set(false);
      this.toastService.error('No se pudo abrir el widget de Wompi');
    }
  }

  onClose(): void {
    this.isOpen.set(false);
  }
}
