import { Component, OnInit, computed, inject, signal, DestroyRef } from '@angular/core';
import { DatePipe, CurrencyPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  CardComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { SubscriptionFacade } from '../../../../../../core/store/subscription/subscription.facade';
import { StoreSubscriptionService } from '../../services/store-subscription.service';
import { CheckoutPreviewResponse } from '../../interfaces/store-subscription.interface';
import { WompiService } from '../../../../../../shared/services/wompi.service';

interface SaasWompiWidgetConfig {
  public_key: string;
  currency: string;
  amount_in_cents: number;
  reference: string;
  signature_integrity: string;
  redirect_url: string;
  customer_email: string;
}

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [CardComponent, ButtonComponent, IconComponent, DatePipe, CurrencyPipe],
  template: `
    <div class="w-full max-w-5xl mx-auto px-4 py-6 lg:py-8 space-y-6">
      <!-- Header -->
      <div class="flex items-center gap-3">
        <button
          type="button"
          (click)="goBack()"
          class="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          aria-label="Volver"
        >
          <app-icon name="arrow-left" [size]="20"></app-icon>
        </button>
        <div>
          <h1 class="text-xl md:text-2xl font-bold text-text-primary">{{ headerTitle() }}</h1>
          <p class="text-sm text-text-secondary">{{ headerSubtitle() }}</p>
        </div>
      </div>

      <!-- Loading skeleton -->
      @if (loadingPreview()) {
        <div class="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6 animate-pulse" aria-busy="true">
          <div class="space-y-4">
            <div class="h-8 w-1/2 bg-gray-200 rounded"></div>
            <div class="h-4 w-2/3 bg-gray-200 rounded"></div>
            <div class="space-y-2 mt-4">
              <div class="h-4 bg-gray-200 rounded"></div>
              <div class="h-4 bg-gray-200 rounded"></div>
              <div class="h-4 bg-gray-200 rounded w-3/4"></div>
            </div>
          </div>
          <div class="space-y-3">
            <div class="h-6 bg-gray-200 rounded"></div>
            <div class="h-4 bg-gray-200 rounded"></div>
            <div class="h-4 bg-gray-200 rounded"></div>
            <div class="h-12 bg-gray-200 rounded mt-6"></div>
          </div>
        </div>
      }

      <!-- Free plan variant -->
      @if (!loadingPreview() && freePlan(); as fp) {
        <app-card customClasses="border border-primary/30 bg-gradient-to-br from-primary-50 to-white shadow-md">
          <div class="p-6 md:p-8 text-center space-y-4">
            <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-primary-500 to-primary-700 shadow-lg">
              <app-icon name="sparkles" [size]="32" class="text-white"></app-icon>
            </div>
            <h2 class="text-2xl font-extrabold text-text-primary">{{ fp.plan.name }}</h2>
            <p class="text-3xl font-extrabold text-primary">Gratis</p>
            @if (fp.plan.trial_days > 0) {
              <span class="inline-block bg-amber-100 text-amber-800 text-xs font-semibold uppercase tracking-wide px-3 py-1 rounded-full">
                Incluye {{ fp.plan.trial_days }} días de prueba
              </span>
            }
            <p class="text-sm text-text-secondary max-w-md mx-auto">
              Este plan no genera ningún cargo. Tu próxima facturación será gratuita.
            </p>
            <div class="pt-4 flex flex-col sm:flex-row gap-3 justify-center">
              <app-button variant="ghost" (clicked)="goBack()">Cancelar</app-button>
              <app-button variant="primary" [loading]="committing()" (clicked)="confirmCheckout()">
                <app-icon name="check" [size]="16" slot="icon"></app-icon>
                Activar plan gratuito
              </app-button>
            </div>
          </div>
        </app-card>
      }

      <!-- Paid plan variant -->
      @if (!loadingPreview() && proration(); as p) {
        <div class="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
          <!-- Left: Plan summary + proration kind -->
          <app-card>
            <div class="p-5 md:p-6 space-y-5">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-xs uppercase tracking-wide text-text-secondary mb-1">Tipo de cambio</p>
                  <span
                    class="inline-block text-xs font-semibold uppercase tracking-wide px-3 py-1 rounded-full"
                    [class.bg-green-100]="p.kind === 'upgrade'"
                    [class.text-green-800]="p.kind === 'upgrade'"
                    [class.bg-blue-100]="p.kind === 'same-tier'"
                    [class.text-blue-800]="p.kind === 'same-tier'"
                    [class.bg-amber-100]="p.kind === 'downgrade'"
                    [class.text-amber-800]="p.kind === 'downgrade'"
                  >
                    {{ kindLabel(p.kind) }}
                  </span>
                </div>
                <app-icon
                  [name]="p.kind === 'upgrade' ? 'trending-up' : p.kind === 'downgrade' ? 'trending-down' : 'arrow-right-left'"
                  [size]="24"
                  class="text-text-secondary"
                ></app-icon>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div class="p-4 bg-gray-50 rounded-xl">
                  <p class="text-xs text-text-secondary mb-1">Plan actual</p>
                  <p class="text-lg font-bold text-text-primary">{{ asNumber(p.old_effective_price) | currency }}</p>
                  <p class="text-xs text-text-secondary mt-1">por ciclo</p>
                </div>
                <div class="p-4 bg-primary/10 rounded-xl border border-primary/20">
                  <p class="text-xs text-text-secondary mb-1">Nuevo plan</p>
                  <p class="text-lg font-bold text-primary">{{ asNumber(p.new_effective_price) | currency }}</p>
                  <p class="text-xs text-primary mt-1">por ciclo</p>
                </div>
              </div>

              @if (p.days_remaining < p.cycle_days) {
                <div class="flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                  <app-icon name="info" [size]="18" class="text-blue-600 mt-0.5"></app-icon>
                  <p class="text-xs text-blue-900">
                    Quedan <strong>{{ p.days_remaining }}</strong> días del ciclo actual de {{ p.cycle_days }} días.
                    El cobro se prorratea proporcionalmente.
                  </p>
                </div>
              }
            </div>
          </app-card>

          <!-- Right: Breakdown card (sticky on desktop) -->
          <app-card customClasses="lg:sticky lg:top-24 lg:self-start">
            <div class="p-5 md:p-6 space-y-4">
              <h3 class="text-sm font-semibold text-text-secondary uppercase tracking-wide">Resumen</h3>

              <div class="space-y-3" role="list">
                @if (asNumber(p.credit_to_apply_next_cycle) > 0) {
                  <div class="flex justify-between items-center" role="listitem">
                    <span class="text-sm text-text-secondary">Crédito por tiempo restante</span>
                    <span class="text-sm font-medium text-green-600">
                      -{{ asNumber(p.credit_to_apply_next_cycle) | currency }}
                    </span>
                  </div>
                }
                @if (chargeNow() > 0) {
                  <div class="flex justify-between items-center" role="listitem">
                    <span class="text-sm text-text-secondary">Cargo prorrateado</span>
                    <span class="text-sm font-medium text-text-primary">
                      {{ chargeNow() | currency }}
                    </span>
                  </div>
                }
              </div>

              <div class="border-t border-border pt-4">
                <div class="flex justify-between items-baseline">
                  <span class="text-sm font-semibold text-text-primary">Total a cobrar hoy</span>
                  <span
                    class="text-2xl font-extrabold"
                    [class.text-primary]="chargeNow() > 0"
                    [class.text-green-600]="chargeNow() === 0"
                  >
                    {{ chargeNow() > 0 ? (chargeNow() | currency) : 'Sin cargo' }}
                  </span>
                </div>
              </div>

              @if (invoice(); as inv) {
                <p class="text-xs text-text-secondary pt-2 border-t border-border/50">
                  Próxima facturación: {{ inv.period_end | date:'mediumDate' }} —
                  {{ asNumber(inv.total) | currency }}
                </p>
              }

              <div class="pt-2 space-y-2">
                <app-button
                  variant="primary"
                  [loading]="committing()"
                  [disabled]="committing()"
                  [fullWidth]="true"
                  (clicked)="confirmCheckout()"
                >
                  <app-icon name="check" [size]="16" slot="icon"></app-icon>
                  Confirmar y pagar
                </app-button>
                <app-button variant="ghost" [fullWidth]="true" (clicked)="goBack()">Cancelar</app-button>
              </div>
            </div>
          </app-card>
        </div>
      }

      <!-- Error state -->
      @if (!loadingPreview() && !freePlan() && !proration() && hasError()) {
        <app-card>
          <div class="p-8 text-center space-y-4">
            <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-50">
              <app-icon name="alert-triangle" [size]="32" class="text-red-600"></app-icon>
            </div>
            <h2 class="text-lg font-bold text-text-primary">No se pudo cargar la vista previa</h2>
            <p class="text-sm text-text-secondary max-w-md mx-auto">
              Ocurrió un problema al calcular el detalle de tu cambio de plan. Intenta nuevamente o vuelve al catálogo.
            </p>
            <div class="flex flex-col sm:flex-row gap-3 justify-center">
              <app-button variant="ghost" (clicked)="goBack()">Volver</app-button>
              <app-button variant="primary" (clicked)="retry()">
                <app-icon name="refresh-cw" [size]="16" slot="icon"></app-icon>
                Reintentar
              </app-button>
            </div>
          </div>
        </app-card>
      }
    </div>
  `,
})
export class CheckoutComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private facade = inject(SubscriptionFacade);
  private subscriptionService = inject(StoreSubscriptionService);
  private toastService = inject(ToastService);
  private wompiService = inject(WompiService);

  readonly preview = signal<CheckoutPreviewResponse | null>(null);
  readonly loadingPreview = signal(false);
  readonly committing = signal(false);
  readonly hasError = signal(false);

  readonly freePlan = computed(() => this.preview()?.free_plan ?? null);
  readonly proration = computed(() => this.preview()?.proration ?? null);
  readonly invoice = computed(() => this.preview()?.invoice ?? null);

  readonly chargeNow = computed(() => {
    const inv = this.preview()?.proration?.invoice_to_issue ?? this.preview()?.invoice ?? null;
    return inv ? this.asNumber(inv.total) : 0;
  });

  readonly headerTitle = computed(() =>
    this.freePlan() ? 'Activar Plan' : 'Confirmar Cambio de Plan',
  );
  readonly headerSubtitle = computed(() =>
    this.freePlan()
      ? 'Activa tu plan sin costo en un solo paso'
      : 'Revisa los detalles antes de confirmar',
  );

  ngOnInit(): void {
    const planId = this.route.snapshot.paramMap.get('planId');
    if (!planId) {
      this.router.navigate(['/admin/subscription/plans']);
      return;
    }
    this.loadPreview(planId);
  }

  private loadPreview(planId: string): void {
    this.loadingPreview.set(true);
    this.hasError.set(false);
    this.subscriptionService.checkoutPreview(planId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.preview.set(res.data);
          } else {
            this.hasError.set(true);
          }
          this.loadingPreview.set(false);
        },
        error: () => {
          this.hasError.set(true);
          this.loadingPreview.set(false);
          this.toastService.error('Error al obtener vista previa');
        },
      });
  }

  retry(): void {
    const planId = this.route.snapshot.paramMap.get('planId');
    if (planId) this.loadPreview(planId);
  }

  confirmCheckout(): void {
    const planId = this.route.snapshot.paramMap.get('planId');
    if (!planId) return;

    const returnUrl = `${window.location.origin}/admin/subscription`;

    this.committing.set(true);
    this.subscriptionService.checkoutCommit(planId, undefined, returnUrl)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.facade.loadCurrent();
          // Paid fresh purchase → backend returns Wompi widget config.
          // Free plan / inline-charged upgrade → widget is null.
          const widget = res?.data?.widget as SaasWompiWidgetConfig | null;
          if (widget) {
            this.openWompiWidget(widget);
            return;
          }
          this.toastService.success(
            this.freePlan() ? 'Plan activado exitosamente' : 'Plan cambiado exitosamente',
          );
          this.committing.set(false);
          this.router.navigate(['/admin/subscription']);
        },
        error: () => {
          this.committing.set(false);
          this.toastService.error('Error al confirmar el cambio');
        },
      });
  }

  private async openWompiWidget(config: SaasWompiWidgetConfig): Promise<void> {
    try {
      await this.wompiService.loadWidgetScript();

      const checkout = new (window as any).WidgetCheckout({
        currency: config.currency,
        amountInCents: config.amount_in_cents,
        reference: config.reference,
        publicKey: config.public_key,
        signature: { integrity: config.signature_integrity },
        redirectUrl: config.redirect_url,
        customerData: { email: config.customer_email },
      });

      checkout.open((result: any) => {
        const transaction = result?.transaction;
        this.committing.set(false);

        if (!transaction) {
          // User closed widget without paying.
          this.toastService.warning(
            'El pago fue cancelado. Tu suscripción quedó pendiente de pago.',
          );
          return;
        }

        if (transaction.status === 'APPROVED') {
          this.facade.loadCurrent();
          this.toastService.success('Pago aprobado. Suscripción activada.');
          this.router.navigate(['/admin/subscription']);
          return;
        }

        if (transaction.status === 'DECLINED' || transaction.status === 'ERROR') {
          this.toastService.error(
            'El pago fue rechazado. Intenta con otro método de pago.',
          );
          return;
        }

        // PENDING — webhook llegará luego. Llevamos al usuario a la página
        // de suscripción para que vea el estado.
        this.toastService.info('Pago pendiente de confirmación.');
        this.router.navigate(['/admin/subscription']);
      });
    } catch (err) {
      this.committing.set(false);
      this.toastService.error('No se pudo abrir el widget de pago. Intenta de nuevo.');
    }
  }

  goBack(): void {
    this.router.navigate(['/admin/subscription/plans']);
  }

  asNumber(value: string | number | null | undefined): number {
    if (value === null || value === undefined) return 0;
    const n = typeof value === 'string' ? parseFloat(value) : value;
    return isNaN(n) ? 0 : n;
  }

  kindLabel(kind: 'upgrade' | 'downgrade' | 'same-tier'): string {
    switch (kind) {
      case 'upgrade': return 'Mejora';
      case 'downgrade': return 'Cambio menor';
      case 'same-tier': return 'Mismo nivel';
    }
  }
}
