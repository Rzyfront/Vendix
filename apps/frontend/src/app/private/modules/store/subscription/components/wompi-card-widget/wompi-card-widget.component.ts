import {
  Component,
  model,
  output,
  signal,
  inject,
  DestroyRef,
  effect,
  untracked,
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
        @if (loadError()) {
          <div class="space-y-3 text-center py-4">
            <p class="text-sm text-text-secondary">
              No pudimos preparar el formulario seguro. Inténtalo de nuevo.
            </p>
            <app-button
              variant="primary"
              [loading]="loading() || widgetLoading()"
              (clicked)="retry()"
              class="w-full"
            >
              Reintentar
            </app-button>
          </div>
        } @else {
          <div class="flex flex-col items-center justify-center py-8 space-y-3">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
            <p class="text-sm text-text-secondary text-center">
              @if (loading()) {
                Preparando formulario seguro de Wompi...
              } @else {
                Abriendo formulario...
              }
            </p>
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
  readonly loadError = signal(false);

  /**
   * Guards against re-triggering the auto-open flow while the modal is
   * already open. Reset on close so the next open re-runs the effect.
   */
  private hasOpened = false;
  private widgetConfig: WompiWidgetConfig | null = null;

  constructor() {
    // Auto-trigger the load + open flow whenever the modal transitions
    // from closed -> open. Defer with queueMicrotask to avoid NG0100
    // (the parent just set isOpen=true in the same change-detection
    // cycle). Use untracked() inside the deferred work so we don't
    // accidentally re-track signals read during start().
    effect(() => {
      const open = this.isOpen();
      if (!open) {
        // Reset on close so the next open runs the flow again.
        this.hasOpened = false;
        this.loadError.set(false);
        return;
      }
      if (this.hasOpened) return;
      this.hasOpened = true;
      queueMicrotask(() => untracked(() => this.start()));
    });
  }

  /**
   * Backwards-compatible no-op kept for any caller that still invokes it.
   * The effect() above handles the load + open lifecycle automatically.
   */
  loadWidgetConfigIfNeeded(): void {
    /* handled by effect() */
  }

  /**
   * Entry point of the open flow: load config (if not cached) and then
   * auto-open the Wompi widget. On any failure flips loadError() so the
   * template renders the Reintentar branch.
   */
  private start(): void {
    this.loadError.set(false);
    if (this.widgetConfig) {
      void this.openWompiWidget();
      return;
    }
    this.loadWidgetConfig();
  }

  private loadWidgetConfig(): void {
    this.loading.set(true);
    this.subscriptionService
      .getPaymentMethodWidgetConfig()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.loading.set(false);
          if (res.success && res.data) {
            this.widgetConfig = res.data as WompiWidgetConfig;
            void this.openWompiWidget();
          } else {
            this.loadError.set(true);
          }
        },
        error: () => {
          this.loading.set(false);
          this.loadError.set(true);
        },
      });
  }

  /**
   * Retry handler — re-runs the full load + open flow. Used after a
   * config-load failure or a widget-open failure.
   */
  retry(): void {
    this.start();
  }

  async openWompiWidget(): Promise<void> {
    if (!this.widgetConfig) {
      this.loadError.set(true);
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
          this.onClose();
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
          this.onClose();
          return;
        }

        this.toastService.info('Pago pendiente de confirmación.');
        this.onClose();
      });
    } catch (err) {
      this.widgetLoading.set(false);
      this.loadError.set(true);
    }
  }

  onClose(): void {
    this.isOpen.set(false);
  }
}
