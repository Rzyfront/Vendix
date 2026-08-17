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
import {
  WompiCardWidgetComponent,
  WompiTokenizeResult,
} from '../../components/wompi-card-widget/wompi-card-widget.component';

/**
 * Payment-methods management page.
 *
 * Alta de tarjeta: la página abre el widget de tokenización de Wompi
 * (`app-wompi-card-widget` → `GET payment-methods/widget-config`) y registra el
 * resultado con `POST payment-methods/tokenize`. Hasta ahora esa pareja de
 * endpoints existía en backend y estaba envuelta en el servicio frontend, pero
 * ningún componente la llamaba: la página era un callejón sin salida que le
 * decía al cliente que la tarjeta "se habilita al pagar", y la campana de
 * autopago mandaba a todo el mundo justo aquí.
 *
 * Desde esta página el usuario puede:
 *   - Agregar una tarjeta para renovaciones automáticas (Wompi COF).
 *   - Ver los métodos habilitados (marca, últimos 4, vencimiento, predeterminado).
 *   - Marcar otro método como predeterminado.
 *   - Eliminar un método (soft-delete: state -> removed).
 *
 * La renovación automática SOLO funciona con tarjeta; el aviso se muestra
 * siempre, con métodos o sin ellos.
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
    WompiCardWidgetComponent,
  ],
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

      <div class="max-w-5xl mx-auto px-4 py-6 lg:py-8 space-y-4">
        <!-- Aviso permanente: exigencia del dueño del producto. Un cliente
             activó la renovación automática pagando por un medio que no
             renueva y su renovación falló en silencio. -->
        <app-alert-banner variant="warning" icon="credit-card">
          La renovación automática solo funciona con tarjeta. Si pagas por otro
          medio (PSE, Nequi, transferencia o efectivo), tu plan no se renovará
          solo y deberás pagar cada período manualmente.
        </app-alert-banner>

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
              <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 class="text-base font-semibold text-text-primary">Métodos habilitados para renovaciones</h2>
                  <p class="text-sm text-text-secondary">
                    Protegido por Wompi. Vendix no almacena el número completo de tu tarjeta ni el CVV.
                  </p>
                </div>
                <app-button
                  variant="primary"
                  size="sm"
                  [loading]="mutating()"
                  [disabled]="mutating()"
                  (clicked)="openAddCard()"
                >
                  <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                  Agregar tarjeta
                </app-button>
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
                            <app-icon name="star" [size]="14" slot="icon" ></app-icon>
                            Predeterminado
                          </app-button>
                        }
                        <app-button
                          variant="ghost"
                          size="sm"
                          [disabled]="mutating()"
                          (clicked)="removeMethod(method)"
                        >
                          <app-icon name="trash-2" [size]="14" slot="icon" ></app-icon>
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
                  Aún no tienes una tarjeta habilitada para renovaciones automáticas
                </p>
                <p class="text-sm text-text-secondary max-w-lg mx-auto">
                  Agrega una tarjeta y Wompi la habilitará para cobrar tus
                  renovaciones automáticamente. Vendix no almacena el número
                  completo de tu tarjeta ni el CVV.
                </p>
              </div>
              <div class="flex flex-col sm:flex-row gap-3 justify-center">
                <app-button
                  variant="primary"
                  [loading]="mutating()"
                  [disabled]="mutating()"
                  (clicked)="openAddCard()"
                >
                  <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                  Agregar tarjeta
                </app-button>
                <app-button variant="outline" (clicked)="goToPanel()">
                  <app-icon name="arrow-right" [size]="16" slot="icon" ></app-icon>
                  Ir al panel de suscripción
                </app-button>
              </div>
            </div>
          }
        </app-card>
      </div>
    </div>

    <!-- Widget de tokenización de Wompi. Se auto-abre al pasar isOpen a true y
         emite (tokenized) con el tok_* + los tokens legales bit-exactos. -->
    <app-wompi-card-widget
      [(isOpen)]="showAddCard"
      (tokenized)="onCardTokenized($event)"
    ></app-wompi-card-widget>
  `,
})
export class PaymentMethodComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private router = inject(Router);
  private subscriptionService = inject(StoreSubscriptionService);
  private toastService = inject(ToastService);
  /**
   * El estado de suscripción vive en NgRx. Tras dar de alta una tarjeta hay que
   * refrescarlo por la acción del store (`loadCurrent`) y no con un GET suelto:
   * un HTTP directo se salta el effect y deja banner, pill y sidebar rancios
   * mostrando todavía "tu autopago no se pudo activar".
   */
  private subscriptionFacade = inject(SubscriptionFacade);

  readonly paymentMethods = signal<PaymentMethod[]>([]);
  readonly loading = signal(false);
  readonly mutating = signal(false);

  /** Visibilidad del widget de tokenización de Wompi. */
  readonly showAddCard = signal(false);

  readonly hasMethods = computed(() => this.paymentMethods().length > 0);
  readonly headerBadgeText = computed(() => {
    const count = this.paymentMethods().length;
    if (count === 0) return 'Sin métodos';
    return count === 1 ? '1 método' : `${count} métodos`;
  });
  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'add-card',
      label: 'Agregar tarjeta',
      variant: 'primary',
      icon: 'plus',
      loading: this.mutating(),
      disabled: this.mutating(),
    },
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
    if (actionId === 'add-card') this.openAddCard();
  }

  /** Abre el widget de Wompi. El componente carga su config y se auto-abre. */
  openAddCard(): void {
    if (this.mutating()) return;
    this.showAddCard.set(true);
  }

  /**
   * El widget tokenizó la tarjeta: la registramos como método recurrente (COF)
   * vía `POST payment-methods/tokenize`.
   *
   * `acceptance_token` y `personal_auth_token` viajan bit-exactos tal como los
   * aceptó el usuario en el widget — Wompi rechaza el `payment_source` si se
   * alteran. El widget ya los echa de vuelta desde su `widget-config`.
   */
  onCardTokenized(result: WompiTokenizeResult): void {
    if (!result.card_token) {
      this.toastService.error(
        'Wompi no devolvió el token de la tarjeta. Intenta de nuevo.',
      );
      return;
    }

    this.mutating.set(true);
    this.subscriptionService
      .addPaymentMethod({
        card_token: result.card_token,
        acceptance_token: result.acceptance_token,
        personal_auth_token: result.personal_auth_token,
        type: result.type,
        last4: result.last4,
        brand: result.brand,
        expiry_month: result.expiry_month,
        expiry_year: result.expiry_year,
        card_holder: result.card_holder,
        // Primera tarjeta: queda predeterminada para que la renovación
        // automática tenga con qué cobrar sin un segundo paso del usuario.
        is_default: !this.hasMethods(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.mutating.set(false);
          this.toastService.success(
            'Tarjeta habilitada para renovaciones automáticas',
          );
          this.loadPaymentMethods();
          // Refresco por el store: la acción dispara el effect que relee
          // `/store/subscriptions/current`, y con eso el banner de autopago
          // deja de anunciar un problema ya resuelto.
          this.subscriptionFacade.loadCurrent();
        },
        error: (err: { error?: { message?: string } }) => {
          this.mutating.set(false);
          this.toastService.error(
            err?.error?.message ?? 'No se pudo habilitar la tarjeta',
          );
        },
      });
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
