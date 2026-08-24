import { Component, OnInit, inject, signal, DestroyRef, computed } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AlertBannerComponent,
  CardComponent,
  ButtonComponent,
  IconComponent,
  StickyHeaderComponent,
  StickyHeaderActionButton,
  ToastService,
} from '../../../../../../shared/components/index';
import { SubscriptionFacade } from '../../../../../../core/store/subscription/subscription.facade';
import { StoreSubscriptionService } from '../../services/store-subscription.service';
import { PaymentMethod } from '../../interfaces/store-subscription.interface';
import { WompiCheckoutService, WompiTransaction } from '../../../../../../core/services/wompi-checkout.service';

/**
 * Vista de pago de suscripción y gestión de comprobantes / métodos.
 *
 * Permite a cualquier tienda con factura pendiente (en estado active, grace_soft,
 * grace_hard, suspended) realizar el pago directo de su suscripción mediante el
 * widget de Wompi (Nequi, PSE, Tarjeta o Transferencia).
 */
@Component({
  selector: 'app-payment-method',
  standalone: true,
  imports: [
    AlertBannerComponent,
    CardComponent,
    ButtonComponent,
    IconComponent,
    StickyHeaderComponent,
  ],
  template: `
    <div class="w-full min-h-full">
      <app-sticky-header
        title="Pago de Suscripción"
        subtitle="Gestiona el pago de tu plan y mantén tu tienda activa sin interrupciones."
        icon="credit-card"
        variant="glass"
        [badgeText]="headerBadgeText()"
        [badgeColor]="headerBadgeColor()"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      ></app-sticky-header>

      <div class="max-w-4xl mx-auto px-4 py-6 lg:py-8 space-y-6">
        @if (loading()) {
          <div class="p-6 md:p-8" aria-busy="true">
            <div class="flex items-center gap-4 rounded-2xl border border-border bg-surface p-6">
              <div class="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                <app-icon name="loader-2" [size]="24" class="text-primary" [spin]="true"></app-icon>
              </div>
              <div class="space-y-2 flex-1">
                <div class="h-4 w-40 rounded bg-gray-200 animate-pulse"></div>
                <div class="h-3 w-full max-w-sm rounded bg-gray-100 animate-pulse"></div>
              </div>
            </div>
          </div>
        } @else {
          <!-- ── BLOQUE 1: PAGO DE FACTURA PENDIENTE ── -->
          @if (dueInvoice(); as inv) {
            <div class="space-y-4">
              @if (isGrace()) {
                <app-alert-banner variant="danger" icon="alert-octagon">
                  Tu suscripción se encuentra en mora. Realiza el pago para evitar la suspensión de los servicios de tu tienda.
                </app-alert-banner>
              }

              <app-card [padding]="false" class="overflow-hidden border border-border shadow-sm">
                <div class="p-6 md:p-8 space-y-6">
                  <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-4 pb-6 border-b border-border">
                    <div class="space-y-1">
                      <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                        Pago Pendiente
                      </span>
                      <h2 class="text-2xl font-bold text-text-primary mt-2">
                        {{ planName() }}
                      </h2>
                      <p class="text-sm text-text-secondary">
                        Factura #{{ inv.id }} · {{ billingCycleLabel() }}
                      </p>
                    </div>

                    <div class="text-left md:text-right">
                      <p class="text-sm text-text-secondary">Total a pagar</p>
                      <p class="text-3xl font-extrabold text-primary">
                        {{ formatCurrency(inv.total, inv.currency) }}
                      </p>
                      @if (inv.due_at) {
                        <p class="text-xs text-text-secondary mt-1">
                          Vence el {{ formatDate(inv.due_at) }}
                        </p>
                      }
                    </div>
                  </div>

                  @if (inv.period_start && inv.period_end) {
                    <div class="flex items-center justify-between text-xs text-text-secondary bg-surface-subtle p-3 rounded-xl">
                      <span>Período facturado</span>
                      <span class="font-medium text-text-primary">
                        {{ formatDate(inv.period_start) }} - {{ formatDate(inv.period_end) }}
                      </span>
                    </div>
                  }

                  <div class="flex flex-col sm:flex-row items-center gap-3 pt-2">
                    <app-button
                      variant="primary"
                      size="lg"
                      class="w-full sm:w-auto min-w-[220px]"
                      [loading]="paying()"
                      [disabled]="paying()"
                      (clicked)="payDueInvoice()"
                    >
                      <app-icon name="credit-card" [size]="18" slot="icon"></app-icon>
                      Pagar {{ formatCurrency(inv.total, inv.currency) }}
                    </app-button>

                    <app-button
                      variant="ghost"
                      size="lg"
                      class="w-full sm:w-auto"
                      (clicked)="goToPlans()"
                    >
                      Cambiar de plan
                    </app-button>
                  </div>
                </div>
              </app-card>

              <app-alert-banner variant="info" icon="info">
                Pago protegido y procesado de forma segura por Wompi. Aceptamos Nequi, PSE, tarjetas de crédito/débito y transferencias Bancolombia. Te notificaremos cada período cuando tu siguiente pago esté disponible.
              </app-alert-banner>
            </div>
          } @else {
            <!-- ── BLOQUE 2: ESTADO AL DÍA (SIN FACTURAS PENDIENTES) ── -->
            <app-card [padding]="false" class="border border-border">
              <div class="p-8 md:p-12 text-center space-y-5">
                <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 text-emerald-600">
                  <app-icon name="check-circle-2" [size]="32"></app-icon>
                </div>
                <div class="space-y-2 max-w-md mx-auto">
                  <h2 class="text-xl font-bold text-text-primary">
                    Tu suscripción está al día
                  </h2>
                  <p class="text-sm text-text-secondary">
                    Tu plan <strong class="text-text-primary">{{ planName() }}</strong> no tiene pagos pendientes.
                    @if (nextBillingDate()) {
                      <span> Tu próximo corte es el <strong>{{ nextBillingDate() }}</strong>.</span>
                    }
                  </p>
                </div>

                <div class="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                  <app-button variant="outline" (clicked)="goToPlans()">
                    <app-icon name="sparkles" [size]="16" slot="icon"></app-icon>
                    Ver planes disponibles
                  </app-button>
                  <app-button variant="ghost" (clicked)="goToPanel()">
                    <app-icon name="arrow-right" [size]="16" slot="icon"></app-icon>
                    Ir al panel de suscripción
                  </app-button>
                </div>
              </div>
            </app-card>
          }

          <!-- ── BLOQUE 3: MÉTODOS GUARDADOS (SOLO SI EXISTEN) ── -->
          @if (hasMethods()) {
            <div class="pt-6 space-y-4">
              <div class="flex items-center justify-between">
                <div>
                  <h3 class="text-base font-semibold text-text-primary">Métodos de pago guardados</h3>
                  <p class="text-xs text-text-secondary">Métodos registrados previamente</p>
                </div>
              </div>

              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                @for (method of paymentMethods(); track method.id) {
                  <div
                    class="rounded-2xl border bg-surface p-4 flex items-center justify-between gap-3"
                    [class.border-primary]="method.is_default"
                  >
                    <div class="flex items-center gap-3 min-w-0">
                      <div class="p-2.5 bg-gray-100 rounded-xl shrink-0">
                        <app-icon
                          [name]="method.type === 'card' ? 'credit-card' : 'landmark'"
                          [size]="20"
                          class="text-text-secondary"
                        ></app-icon>
                      </div>
                      <div class="min-w-0">
                        <p class="font-medium text-sm text-text-primary truncate">
                          {{ method.type === 'card' ? 'Tarjeta' : 'Cuenta' }}
                          @if (method.last4) {
                            <span>****{{ method.last4 }}</span>
                          }
                        </p>
                        @if (method.brand) {
                          <p class="text-xs text-text-secondary capitalize">{{ method.brand }}</p>
                        }
                      </div>
                    </div>

                    <app-button
                      variant="ghost"
                      size="sm"
                      [disabled]="mutating()"
                      (clicked)="removeMethod(method)"
                    >
                      <app-icon name="trash-2" [size]="14" slot="icon"></app-icon>
                    </app-button>
                  </div>
                }
              </div>
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class PaymentMethodComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private router = inject(Router);
  private subscriptionService = inject(StoreSubscriptionService);
  private toastService = inject(ToastService);
  private subscriptionFacade = inject(SubscriptionFacade);
  private wompiCheckoutService = inject(WompiCheckoutService);

  readonly paymentMethods = signal<PaymentMethod[]>([]);
  readonly loading = signal(false);
  readonly mutating = signal(false);
  readonly paying = signal(false);

  readonly currentSubscription = this.subscriptionFacade.current;
  readonly uiState = this.subscriptionFacade.subscriptionUiState;

  readonly hasMethods = computed(() => this.paymentMethods().length > 0);

  readonly dueInvoice = computed(() => {
    const ui = this.uiState();
    if (ui.kind === 'payment_due') {
      return ui.invoice;
    }
    if ((ui.kind === 'grace_soft' || ui.kind === 'grace_hard') && ui.invoice) {
      return ui.invoice;
    }
    const sub: any = this.currentSubscription();
    if (sub?.payable_invoice) {
      return sub.payable_invoice;
    }
    return null;
  });

  readonly isGrace = computed(() => {
    const ui = this.uiState();
    return ui.kind === 'grace_soft' || ui.kind === 'grace_hard';
  });

  readonly planName = computed(() => {
    const sub: any = this.currentSubscription();
    return sub?.paid_plan?.name ?? sub?.plan?.name ?? sub?.plan_name ?? 'Plan Vendix';
  });

  readonly billingCycleLabel = computed(() => {
    const sub: any = this.currentSubscription();
    const cycle = sub?.billing_cycle ?? sub?.paid_plan?.billing_cycle ?? 'monthly';
    switch (cycle) {
      case 'yearly':
      case 'annual':
        return 'Facturación anual';
      case 'quarterly':
        return 'Facturación trimestral';
      case 'semiannual':
        return 'Facturación semestral';
      default:
        return 'Facturación mensual';
    }
  });

  readonly nextBillingDate = computed<string | null>(() => {
    const sub: any = this.currentSubscription();
    if (!sub?.next_billing_at && !sub?.current_period_end) return null;
    const dateStr = sub.next_billing_at ?? sub.current_period_end;
    return this.formatDate(dateStr);
  });

  readonly headerBadgeText = computed(() => {
    if (this.dueInvoice()) return 'Pago pendiente';
    return 'Al día';
  });

  readonly headerBadgeColor = computed<'red' | 'green' | 'blue' | 'yellow'>(() => {
    if (this.isGrace()) return 'red';
    if (this.dueInvoice()) return 'yellow';
    return 'green';
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'plans',
      label: 'Cambiar de plan',
      variant: 'outline',
      icon: 'sparkles',
    },
    {
      id: 'panel',
      label: 'Panel de suscripción',
      variant: 'ghost',
      icon: 'arrow-right',
    },
  ]);

  ngOnInit(): void {
    this.subscriptionFacade.loadCurrent();
    this.loadPaymentMethods();
  }

  private loadPaymentMethods(): void {
    this.loading.set(true);
    this.subscriptionService
      .getPaymentMethods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.paymentMethods.set(res.data);
          }
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        },
      });
  }

  payDueInvoice(): void {
    const inv = this.dueInvoice();
    if (this.paying()) return;
    this.paying.set(true);

    this.subscriptionService
      .payDue({ invoiceId: inv ? inv.id : undefined })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: async (res) => {
          if (!res?.widget) {
            this.paying.set(false);
            this.toastService.error('No se pudo preparar la pasarela de pago');
            return;
          }

          await this.wompiCheckoutService.openWidget(res.widget, {
            onApproved: (tx: WompiTransaction) => {
              this.paying.set(false);
              this.toastService.success('¡Pago completado exitosamente!');
              this.subscriptionFacade.loadCurrent();
            },
            onPending: (tx: WompiTransaction) => {
              this.paying.set(false);
              this.toastService.info(
                'Tu pago está en proceso de verificación por la pasarela.',
              );
              this.subscriptionFacade.loadCurrent();
            },
            onDeclined: (tx: WompiTransaction) => {
              this.paying.set(false);
              this.toastService.warning(
                'La transacción no fue aprobada. Puedes intentar con otro medio de pago.',
              );
            },
            onError: (err: unknown) => {
              this.paying.set(false);
              this.toastService.error(
                'Ocurrió un error al procesar el pago con Wompi.',
              );
            },
            onClosed: () => {
              this.paying.set(false);
            },
          });
        },
        error: (err) => {
          this.paying.set(false);
          const msg =
            err?.error?.message ??
            'Error al preparar el pago de la factura pendiente.';
          this.toastService.error(msg);
        },
      });
  }

  goToPanel(): void {
    this.router.navigate(['/admin/subscription']);
  }

  goToPlans(): void {
    this.router.navigate(['/admin/subscription/plans']);
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'panel') this.goToPanel();
    if (actionId === 'plans') this.goToPlans();
  }

  removeMethod(method: PaymentMethod): void {
    if (this.mutating()) return;
    const confirmed = window.confirm(
      '¿Deseas eliminar este método de pago guardado?',
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

  formatCurrency(amount: number | string, currency: string = 'COP'): string {
    const val = Number(amount) || 0;
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: currency || 'COP',
      maximumFractionDigits: 0,
    }).format(val);
  }

  formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString('es-CO', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  }
}
