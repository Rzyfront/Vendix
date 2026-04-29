import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CardComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { StoreSubscriptionService } from '../../services/store-subscription.service';
import { PaymentMethod } from '../../interfaces/store-subscription.interface';
import { WompiCardWidgetComponent } from '../../components/wompi-card-widget/wompi-card-widget.component';
import {
  PaymentMethodEditModalComponent,
  PaymentMethodEditResult,
} from '../../components/payment-method-edit-modal/payment-method-edit-modal.component';

interface TokenizedCard {
  provider_token: string;
  type: string;
  last4?: string;
  brand?: string;
  expiry_month?: string;
  expiry_year?: string;
  card_holder?: string;
}

@Component({
  selector: 'app-payment-method',
  standalone: true,
  imports: [
    CardComponent,
    ButtonComponent,
    IconComponent,
    WompiCardWidgetComponent,
    PaymentMethodEditModalComponent,
  ],
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
              <div class="p-4 flex items-center justify-between gap-3">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="p-3 bg-gray-100 rounded-xl shrink-0">
                    <app-icon name="{{ method.type === 'card' ? 'credit-card' : 'landmark' }}" [size]="24" class="text-text-secondary"></app-icon>
                  </div>
                  <div class="min-w-0">
                    <p class="font-medium text-text-primary truncate">
                      {{ method.type === 'card' ? 'Tarjeta' : 'Transferencia' }}
                      @if (method.last4) {
                        <span class="text-text-secondary">****{{ method.last4 }}</span>
                      }
                    </p>
                    @if (method.brand) {
                      <p class="text-xs text-text-secondary capitalize">{{ method.brand }}</p>
                    }
                    @if (method.expiry_month && method.expiry_year) {
                      <p class="text-xs text-text-secondary">
                        Vence {{ formatExpiry(method) }}
                      </p>
                    }
                    <div class="mt-1 flex flex-wrap gap-1">
                      @if (method.is_default) {
                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary font-medium">Predeterminado</span>
                      }
                      @if (method.state === 'invalid') {
                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-600 font-medium">No válida</span>
                      }
                      @if (isExpiringSoon(method)) {
                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700 font-medium">Por vencer</span>
                      }
                    </div>
                  </div>
                </div>
                <div class="flex flex-col items-end gap-1 shrink-0">
                  <app-button variant="ghost" size="sm" (clicked)="configureMethod(method)">
                    <app-icon name="settings" [size]="14" slot="icon"></app-icon>
                    Configurar
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
              <p class="text-xs text-text-secondary">La tokenización de tarjeta se maneja a través de Wompi</p>
              <app-button variant="outline" (clicked)="addPaymentMethod()">
                <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                Agregar Tarjeta
              </app-button>
            </div>
          </app-card>
        </div>
      }
    </div>

    <app-wompi-card-widget
      [isOpen]="showWidget()"
      (isOpenChange)="onWidgetClose($event)"
      (tokenized)="onCardTokenized($event)"
    />

    <app-payment-method-edit-modal
      [isOpen]="editModalOpen()"
      (isOpenChange)="editModalOpen.set($event)"
      [paymentMethod]="selectedMethod()"
      [allPaymentMethods]="paymentMethods()"
      (closedWithResult)="onEditModalResult($event)"
    />
  `,
})
export class PaymentMethodComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private subscriptionService = inject(StoreSubscriptionService);
  private toastService = inject(ToastService);

  readonly paymentMethods = signal<PaymentMethod[]>([]);
  readonly loading = signal(false);
  readonly showWidget = signal(false);

  // G11 — when set, the next successful tokenization replaces this PM
  // instead of creating a fresh one.
  readonly replacingMethodId = signal<string | null>(null);

  // S3.2 — "Configurar" modal state. The modal handles default toggle,
  // delete (with last-active-default guard), replace (Wompi widget) and
  // shows the last 5 charges executed against the selected PM.
  readonly editModalOpen = signal(false);
  readonly selectedMethod = signal<PaymentMethod | null>(null);

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

  /**
   * S3.2 — Open the "Configurar" modal for the selected PM. The modal
   * is the single source of truth for default-toggle, delete and
   * replace, plus surfaces the last 5 charges for context.
   */
  configureMethod(method: PaymentMethod): void {
    this.selectedMethod.set(method);
    this.editModalOpen.set(true);
  }

  /**
   * S3.2 — Refresh the list when the modal reports a real mutation.
   * Pure cancellations don't need a re-fetch.
   */
  onEditModalResult(result: PaymentMethodEditResult): void {
    this.editModalOpen.set(false);
    this.selectedMethod.set(null);
    if (result.action !== 'cancelled') {
      this.loadPaymentMethods();
    }
  }

  addPaymentMethod(): void {
    this.replacingMethodId.set(null);
    this.showWidget.set(true);
  }

  /**
   * G11 — Open the Wompi widget in "replace" mode. After a successful
   * tokenization onCardTokenized() will detect replacingMethodId() and
   * call POST /payment-methods/:id/replace instead of /tokenize.
   */
  changeCard(id: string): void {
    this.replacingMethodId.set(id);
    this.showWidget.set(true);
  }

  onWidgetClose(open: boolean): void {
    this.showWidget.set(open);
    if (!open) {
      // Reset replace context if the user closed without tokenizing.
      this.replacingMethodId.set(null);
    }
  }

  onCardTokenized(event: TokenizedCard): void {
    const replaceId = this.replacingMethodId();

    const payload = {
      provider_token: event.provider_token,
      type: event.type,
      last4: event.last4,
      brand: event.brand,
      expiry_month: event.expiry_month,
      expiry_year: event.expiry_year,
      card_holder: event.card_holder,
      is_default: this.paymentMethods().length === 0,
    };

    const request$ = replaceId
      ? this.subscriptionService.replacePaymentMethod(replaceId, payload)
      : this.subscriptionService.addPaymentMethod(payload);

    request$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success(
            replaceId ? 'Tarjeta reemplazada exitosamente' : 'Tarjeta agregada exitosamente',
          );
          this.replacingMethodId.set(null);
          this.loadPaymentMethods();
        },
        error: () => {
          this.toastService.error(
            replaceId ? 'Error al reemplazar la tarjeta' : 'Error al guardar la tarjeta',
          );
          this.replacingMethodId.set(null);
        },
      });
  }

  /** G11 — formatted MM/YY expiry label for the UI. */
  formatExpiry(method: PaymentMethod): string {
    const m = (method.expiry_month ?? '').padStart(2, '0');
    const y = (method.expiry_year ?? '').slice(-2);
    return m && y ? `${m}/${y}` : '';
  }

  /** G11 — true when the card expires within the next 14 days. */
  isExpiringSoon(method: PaymentMethod): boolean {
    if (!method.expiry_month || !method.expiry_year) return false;
    const m = parseInt(method.expiry_month, 10);
    let y = parseInt(method.expiry_year, 10);
    if (isNaN(m) || isNaN(y)) return false;
    if (y < 100) y += 2000;
    // Last day of the expiry month, UTC.
    const expEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)).getTime();
    const now = Date.now();
    if (expEnd < now) return false;
    const fourteenDays = 14 * 24 * 60 * 60 * 1000;
    return expEnd - now <= fourteenDays;
  }
}
