import { Component, OnInit, inject, signal, DestroyRef, computed } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CardComponent,
  ButtonComponent,
  IconComponent,
  StickyHeaderComponent,
  StickyHeaderActionButton,
  ToastService,
} from '../../../../../../shared/components/index';
import { StoreSubscriptionService } from '../../services/store-subscription.service';
import { PaymentMethod } from '../../interfaces/store-subscription.interface';

/**
 * Read-only payment-methods management page.
 *
 * Canonical UX: payment methods are NEVER added explicitly here. Wompi enables
 * them for automatic renewals as a side-effect of the first successful real
 * invoice charge (see `SubscriptionPaymentService.autoRegisterPaymentMethodFromGateway`).
 *
 * From this page the user can only:
 *   - View payment methods enabled for renewals (brand, last4, expiry, default flag).
 *   - Mark another method as default.
 *   - Remove a method (soft-delete: state -> removed).
 *
 * If there are no PMs enabled yet, the page renders an informational empty
 * state pointing the user back to the subscription panel — payment is the
 * canonical entry point, not a standalone "add card" flow.
 */
@Component({
  selector: 'app-payment-method',
  standalone: true,
  imports: [CardComponent, ButtonComponent, IconComponent, StickyHeaderComponent],
  template: `
    <div class="w-full min-h-full">
      <app-sticky-header
        title="Métodos de Pago"
        subtitle="Gestiona métodos de pago habilitados para renovaciones automáticas mediante Wompi. Vendix no almacena el número completo de tu tarjeta ni el CVV."
        icon="credit-card"
        variant="glass"
        [badgeText]="headerBadgeText()"
        badgeColor="blue"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      ></app-sticky-header>

      <div class="max-w-5xl mx-auto px-4 py-6 lg:py-8">
        <app-card [padding]="false">
          @if (loading()) {
            <div class="p-6 md:p-8" aria-busy="true">
              <div class="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4">
                <div class="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                  <app-icon name="loader-2" [size]="24" class="text-primary" [spin]="true"></app-icon>
                </div>
                <div class="space-y-2 flex-1">
                  <div class="h-4 w-40 rounded bg-gray-200"></div>
                  <div class="h-3 w-full max-w-sm rounded bg-gray-100"></div>
                </div>
              </div>
            </div>
          }

          @if (!loading() && hasMethods()) {
            <div class="space-y-4 p-4 md:p-6">
              <div class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 class="text-base font-semibold text-text-primary">Métodos habilitados para renovaciones</h2>
                  <p class="text-sm text-text-secondary">
                    Protegido por Wompi. Vendix no almacena el número completo de tu tarjeta ni el CVV.
                  </p>
                </div>
              </div>

              <div class="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
                @for (method of paymentMethods(); track method.id) {
                  <div
                    class="rounded-2xl border bg-surface p-4 transition-shadow hover:shadow-sm"
                    [class.border-primary]="method.is_default"
                    [class.ring-2]="method.is_default"
                    [class.ring-primary]="method.is_default"
                  >
                    <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div class="flex items-start gap-3 min-w-0">
                        <div class="p-3 bg-gray-100 rounded-xl shrink-0">
                          <app-icon
                            [name]="method.type === 'card' ? 'credit-card' : 'landmark'"
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
                          <div class="mt-2 flex flex-wrap gap-1.5">
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
                              when the payment method has been enabled as a Wompi
                              payment_source (COF). The field is populated by
                              the new tokenize endpoint shipping in Fase 5;
                              defensive optional-chain so legacy PMs without
                              the field simply do not render the badge.
                            -->
                            @if (method?.providerPaymentSourceId) {
                              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700 font-medium">
                                Protegido por Wompi
                              </span>
                            }
                          </div>
                        </div>
                      </div>

                      <div class="flex flex-wrap gap-2 sm:flex-col sm:items-end shrink-0">
                        @if (!method.is_default && method.state === 'active') {
                          <app-button
                            variant="ghost"
                            size="sm"
                            [disabled]="mutating()"
                            (clicked)="setDefault(method)"
                          >
                            <app-icon name="star" [size]="14" slot="icon"></app-icon>
                            Predeterminado
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
                  </div>
                }
              </div>
            </div>
          }

          @if (!loading() && !hasMethods()) {
            <div class="p-6 md:p-10 text-center space-y-5">
              <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10">
                <app-icon name="credit-card" [size]="30" class="text-primary"></app-icon>
              </div>
              <div class="space-y-2">
                <p class="text-base md:text-lg font-semibold text-text-primary">
                  Aún no tienes un método habilitado para renovaciones automáticas
                </p>
                <p class="text-sm text-text-secondary max-w-lg mx-auto">
                  Al completar el pago de tu primera factura con tarjeta, Wompi habilitará
                  el método de pago para renovaciones automáticas. Vendix no almacena el
                  número completo de tu tarjeta ni el CVV.
                </p>
              </div>
              <app-button variant="outline" (clicked)="goToPanel()">
                <app-icon name="arrow-right" [size]="16" slot="icon"></app-icon>
                Ir al panel de suscripción
              </app-button>
            </div>
          }
        </app-card>
      </div>
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
  readonly headerBadgeText = computed(() => {
    const count = this.paymentMethods().length;
    if (count === 0) return 'Sin métodos';
    return count === 1 ? '1 método' : `${count} métodos`;
  });
  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'panel',
      label: 'Panel de suscripción',
      variant: 'outline',
      icon: 'arrow-right',
    },
  ]);

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

  onHeaderAction(actionId: string): void {
    if (actionId === 'panel') this.goToPanel();
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
          this.toastService.success('Método marcado como predeterminado');
          this.loadPaymentMethods();
        },
        error: () => {
          this.mutating.set(false);
          this.toastService.error('No se pudo cambiar el método predeterminado');
        },
      });
  }

  removeMethod(method: PaymentMethod): void {
    if (this.mutating()) return;
    const confirmed = window.confirm(
      method.is_default
        ? 'Este es tu método predeterminado para renovaciones automáticas mediante Wompi. Si lo eliminas, no se cobrarán renovaciones automáticamente hasta que pagues otra factura. ¿Continuar?'
        : '¿Eliminar este método habilitado para renovaciones automáticas?',
    );
    if (!confirmed) return;
    this.mutating.set(true);
    this.subscriptionService
      .removePaymentMethod(method.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.mutating.set(false);
          this.toastService.success('Método eliminado');
          this.loadPaymentMethods();
        },
        error: () => {
          this.mutating.set(false);
          this.toastService.error('No se pudo eliminar el método');
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
