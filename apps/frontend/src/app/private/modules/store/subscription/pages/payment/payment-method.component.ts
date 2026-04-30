import { Component, OnInit, inject, signal, DestroyRef, computed } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CardComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { StoreSubscriptionService } from '../../services/store-subscription.service';
import { PaymentMethod } from '../../interfaces/store-subscription.interface';

/**
 * Read-only payment-methods management page.
 *
 * Canonical UX: payment methods are NEVER added explicitly here. They are
 * registered automatically as a side-effect of the first successful real
 * invoice charge (see `SubscriptionPaymentService.autoRegisterPaymentMethodFromGateway`).
 *
 * From this page the user can only:
 *   - View saved cards (brand, last4, expiry, default flag).
 *   - Mark another saved card as default.
 *   - Remove a saved card (soft-delete: state -> removed).
 *
 * If there are no PMs saved yet, the page renders an informational empty
 * state pointing the user back to the subscription panel — payment is the
 * canonical entry point, not a standalone "add card" flow.
 */
@Component({
  selector: 'app-payment-method',
  standalone: true,
  imports: [CardComponent, ButtonComponent, IconComponent],
  template: `
    <div class="w-full space-y-6">
      <div>
        <h1 class="text-xl font-bold text-text-primary">Métodos de Pago</h1>
        <p class="text-sm text-text-secondary">
          Las tarjetas se registran automáticamente al pagar una factura. Aquí puedes
          gestionar las tarjetas ya guardadas.
        </p>
      </div>

      @if (loading()) {
        <div class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      }

      @if (!loading() && hasMethods()) {
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          @for (method of paymentMethods(); track method.id) {
            <app-card customClasses="{{ method.is_default ? 'ring-2 ring-primary' : '' }}">
              <div class="p-4 flex items-start justify-between gap-3">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="p-3 bg-gray-100 rounded-xl shrink-0">
                    <app-icon
                      name="{{ method.type === 'card' ? 'credit-card' : 'landmark' }}"
                      [size]="24"
                      class="text-text-secondary"
                    ></app-icon>
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
                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary font-medium">
                          Predeterminado
                        </span>
                      }
                      @if (method.state === 'invalid') {
                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-600 font-medium">
                          No válida
                        </span>
                      }
                      @if (isExpiringSoon(method)) {
                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700 font-medium">
                          Por vencer
                        </span>
                      }
                      <!--
                        Fase 4 (Wompi recurrent migration) — badge shown
                        when the card has been registered as a Wompi
                        payment_source (COF). The field is populated by
                        the new tokenize endpoint shipping in Fase 5;
                        defensive optional-chain so legacy PMs without
                        the field simply do not render the badge.
                      -->
                      @if (method?.providerPaymentSourceId) {
                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700 font-medium">
                          Verificada para cobros recurrentes
                        </span>
                      }
                    </div>
                  </div>
                </div>

                <div class="flex flex-col items-end gap-1 shrink-0">
                  @if (!method.is_default && method.state === 'active') {
                    <app-button
                      variant="ghost"
                      size="sm"
                      [disabled]="mutating()"
                      (clicked)="setDefault(method)"
                    >
                      <app-icon name="star" [size]="14" slot="icon"></app-icon>
                      Predeterminada
                    </app-button>
                  }
                  <app-button
                    variant="ghost"
                    size="sm"
                    [disabled]="mutating()"
                    (clicked)="removeMethod(method)"
                  >
                    <app-icon name="trash-2" [size]="14" slot="icon"></app-icon>
                    Eliminar
                  </app-button>
                </div>
              </div>
            </app-card>
          }
        </div>
      }

      @if (!loading() && !hasMethods()) {
        <app-card>
          <div class="p-8 text-center space-y-4">
            <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10">
              <app-icon name="credit-card" [size]="28" class="text-primary"></app-icon>
            </div>
            <div class="space-y-1">
              <p class="text-base font-semibold text-text-primary">
                Aún no tienes método de pago guardado
              </p>
              <p class="text-sm text-text-secondary max-w-md mx-auto">
                Tu tarjeta se registrará automáticamente cuando completes el pago de
                tu primera factura. No es necesario agregarla por separado.
              </p>
            </div>
            <app-button variant="outline" (clicked)="goToPanel()">
              <app-icon name="arrow-right" [size]="16" slot="icon"></app-icon>
              Ir al panel de suscripción
            </app-button>
          </div>
        </app-card>
      }
    </div>
  `,
})
export class PaymentMethodComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private router = inject(Router);
  private subscriptionService = inject(StoreSubscriptionService);
  private toastService = inject(ToastService);

  readonly paymentMethods = signal<PaymentMethod[]>([]);
  readonly loading = signal(false);
  readonly mutating = signal(false);

  readonly hasMethods = computed(() => this.paymentMethods().length > 0);

  ngOnInit(): void {
    this.loadPaymentMethods();
  }

  private loadPaymentMethods(): void {
    this.loading.set(true);
    this.subscriptionService
      .getPaymentMethods()
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

  goToPanel(): void {
    this.router.navigate(['/admin/subscription']);
  }

  setDefault(method: PaymentMethod): void {
    if (this.mutating() || method.is_default) return;
    this.mutating.set(true);
    this.subscriptionService
      .setDefaultPaymentMethod(method.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.mutating.set(false);
          this.toastService.success('Tarjeta marcada como predeterminada');
          this.loadPaymentMethods();
        },
        error: () => {
          this.mutating.set(false);
          this.toastService.error('No se pudo cambiar la tarjeta predeterminada');
        },
      });
  }

  removeMethod(method: PaymentMethod): void {
    if (this.mutating()) return;
    const confirmed = window.confirm(
      method.is_default
        ? 'Esta es tu tarjeta predeterminada. Si la eliminas, ya no se cobrarán renovaciones automáticamente hasta que pagues otra factura. ¿Continuar?'
        : '¿Eliminar esta tarjeta guardada?',
    );
    if (!confirmed) return;
    this.mutating.set(true);
    this.subscriptionService
      .removePaymentMethod(method.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.mutating.set(false);
          this.toastService.success('Tarjeta eliminada');
          this.loadPaymentMethods();
        },
        error: () => {
          this.mutating.set(false);
          this.toastService.error('No se pudo eliminar la tarjeta');
        },
      });
  }

  /** Formatted MM/YY expiry label for the UI. */
  formatExpiry(method: PaymentMethod): string {
    const m = (method.expiry_month ?? '').padStart(2, '0');
    const y = (method.expiry_year ?? '').slice(-2);
    return m && y ? `${m}/${y}` : '';
  }

  /** True when the card expires within the next 14 days. */
  isExpiringSoon(method: PaymentMethod): boolean {
    if (!method.expiry_month || !method.expiry_year) return false;
    const m = parseInt(method.expiry_month, 10);
    let y = parseInt(method.expiry_year, 10);
    if (isNaN(m) || isNaN(y)) return false;
    if (y < 100) y += 2000;
    const expEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)).getTime();
    const now = Date.now();
    if (expEnd < now) return false;
    const fourteenDays = 14 * 24 * 60 * 60 * 1000;
    return expEnd - now <= fourteenDays;
  }
}
