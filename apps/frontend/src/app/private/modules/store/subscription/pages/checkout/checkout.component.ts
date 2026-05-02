import { Component, OnInit, computed, inject, signal, DestroyRef, effect } from '@angular/core';
import { DatePipe, CurrencyPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  CardComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
  StickyHeaderComponent,
} from '../../../../../../shared/components/index';
import { SubscriptionFacade } from '../../../../../../core/store/subscription/subscription.facade';
import { StoreSubscriptionService } from '../../services/store-subscription.service';
import { CheckoutPreviewResponse, SubscriptionPlan } from '../../interfaces/store-subscription.interface';
import {
  WompiCheckoutService,
  WompiWidgetConfig,
} from '../../../../../../core/services/wompi-checkout.service';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';

// S2.1 — Map backend coupon validation `reason` codes to user-facing
// Spanish copy. Kept inline (rather than i18n keys) to match the existing
// component pattern; consider extraction if i18n gets standardized.
const COUPON_REASON_COPY: Record<string, string> = {
  not_found: 'Cupón no encontrado',
  expired: 'Cupón expirado o aún no vigente',
  already_used: 'Este cupón ya fue redimido en esta tienda',
  not_eligible: 'Tu tienda no cumple los requisitos del cupón',
  invalid_state: 'El cupón está deshabilitado',
  network_error: 'Error de red al validar el cupón',
};

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [
    CardComponent,
    ButtonComponent,
    IconComponent,
    DatePipe,
    CurrencyPipe,
    RouterLink,
    ReactiveFormsModule,
    StickyHeaderComponent,
  ],
  template: `
    <div class="w-full space-y-6">
      <!-- Header -->
      <app-sticky-header
        [title]="headerTitle()"
        [subtitle]="headerSubtitle()"
        icon="credit-card"
        variant="glass"
        [showBackButton]="true"
        backRoute="/admin/subscription/plans"
      ></app-sticky-header>

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
            <p class="text-sm text-text-secondary max-w-md mx-auto">
              Este plan no genera ningún cargo. Tu próxima facturación será gratuita.
            </p>

            <div class="pt-4 flex flex-col sm:flex-row gap-3 justify-center">
              <app-button variant="ghost" (clicked)="goBack()">Cancelar</app-button>
              <app-button
                variant="primary"
                [loading]="committing()"
                [disabled]="committing()"
                (clicked)="confirmCheckout()"
              >
                <app-icon name="check" [size]="16" slot="icon"></app-icon>
                Activar plan gratuito
              </app-button>
            </div>
          </div>
        </app-card>
      }

      <!-- S3.4 — Trial plan-swap variant. Free deferred change: keeps the
           remaining trial and starts billing at trial_ends_at. No no-refund
           checkbox; copy is softer; CTA is "Confirmar cambio". -->
      @if (!loadingPreview() && trialSwapInfo(); as ts) {
        <app-card customClasses="border border-blue-200 bg-gradient-to-br from-blue-50 to-white shadow-md">
          <div class="p-6 md:p-8 text-center space-y-4">
            <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg">
              <app-icon name="arrow-right-left" [size]="32" class="text-white"></app-icon>
            </div>
            <h2 class="text-2xl font-extrabold text-text-primary">Cambio de plan durante prueba</h2>
            <p class="text-sm text-text-secondary max-w-xl mx-auto leading-relaxed">
              Cambiarás de <strong>{{ ts.old_plan.name }}</strong> a <strong>{{ ts.new_plan.name }}</strong>.
              Tu prueba sigue activa hasta
              <strong>{{ ts.trial_ends_at | date:'mediumDate':'-0500':'es-CO' }}</strong>,
              sin cobros.
            </p>

            <div class="grid grid-cols-2 gap-3 max-w-md mx-auto">
              <div class="p-4 bg-gray-50 rounded-xl text-left">
                <p class="text-xs text-text-secondary mb-1">Plan actual</p>
                <p class="text-sm font-bold text-text-primary truncate">{{ ts.old_plan.name }}</p>
              </div>
              <div class="p-4 bg-blue-100/50 rounded-xl border border-blue-200 text-left">
                <p class="text-xs text-text-secondary mb-1">Nuevo plan</p>
                <p class="text-sm font-bold text-blue-900 truncate">{{ ts.new_plan.name }}</p>
              </div>
            </div>

            <div class="flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-lg max-w-xl mx-auto text-left">
              <app-icon name="info" [size]="18" class="text-blue-600 mt-0.5 shrink-0"></app-icon>
              <div class="space-y-1">
                <p class="text-xs text-blue-900">
                  <strong>Próximo cargo:</strong>
                  {{ ts.trial_ends_at | date:'mediumDate':'-0500':'es-CO' }}
                  por
                  {{ asNumber(ts.new_effective_price) | currency:'COP':'symbol-narrow':'1.0-0' }}/mes
                </p>
                <p class="text-xs text-blue-900/80">
                  Puedes cancelar la renovación automática en cualquier momento desde tu panel.
                </p>
              </div>
            </div>

            <div class="pt-4 flex flex-col sm:flex-row gap-3 justify-center">
              <app-button variant="ghost" (clicked)="goBack()">Cancelar</app-button>
              <app-button
                variant="primary"
                [loading]="committing()"
                [disabled]="committing()"
                (clicked)="confirmCheckout()"
              >
                <app-icon name="check" [size]="16" slot="icon"></app-icon>
                Confirmar cambio
              </app-button>
            </div>
          </div>
        </app-card>
      }

      <!-- Paid plan variant -->
      @if (!loadingPreview() && !trialSwapInfo() && proration(); as p) {
        <!-- S3.5 — Scheduled-cancel revert notice. Surfaced when the source
             sub has scheduled_cancel_at; the commit clears it and restores
             auto_renew so the user must understand the implicit revert. -->
        @if (p.voids_scheduled_cancel?.active) {
          <div class="flex items-start gap-3 p-4 bg-amber-50 border-l-4 border-amber-400 rounded-r-xl mb-6">
            <app-icon name="info" [size]="20" class="text-amber-700 mt-0.5 shrink-0"></app-icon>
            <div class="space-y-1 min-w-0">
              <p class="text-sm font-semibold text-amber-900">
                Esta compra revertirá tu cancelación programada
              </p>
              <p class="text-xs text-amber-900/90 leading-relaxed">
                Tienes una cancelación programada para el
                <strong>{{ p.voids_scheduled_cancel?.scheduled_at | date:'mediumDate':'-0500':'es-CO' }}</strong>.
                Al confirmar este cambio, la cancelación queda sin efecto y se
                reanuda la auto-renovación de tu suscripción.
              </p>
            </div>
          </div>
        }

        <div class="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
          <!-- Left: Plan detail + proration kind -->
          <app-card>
            <div class="p-5 md:p-6 space-y-5">
              <!-- Plan detail header -->
              @if (selectedPlan(); as sp) {
                <div class="flex flex-col sm:flex-row gap-4">
                  <div class="flex-1 min-w-0 space-y-2">
                    <div class="flex items-center gap-2 flex-wrap">
                      <h2 class="text-lg md:text-xl font-extrabold text-text-primary truncate">{{ sp.name }}</h2>
                      @if (sp.is_popular) {
                        <span class="text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 shrink-0">
                          Recomendado
                        </span>
                      }
                    </div>
                    @if (sp.description) {
                      <p class="text-xs md:text-sm text-text-secondary leading-relaxed">{{ sp.description }}</p>
                    }
                    @if (sp.features.length > 0) {
                      <ul class="flex flex-wrap gap-x-4 gap-y-1">
                        @for (f of sp.features; track f.key) {
                          <li class="flex items-center gap-1.5 text-xs text-text-primary">
                            <app-icon
                              [name]="f.enabled ? 'check-circle-2' : 'minus'"
                              [size]="14"
                              [class.text-primary-600]="f.enabled"
                              [class.opacity-40]="!f.enabled"
                              class="shrink-0"
                            ></app-icon>
                            <span [class.text-text-secondary]="!f.enabled">{{ f.label }}</span>
                            @if (f.limit !== null && f.limit !== undefined) {
                              <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">
                                {{ f.limit }}{{ f.unit ? ' ' + f.unit : '' }}
                              </span>
                            }
                          </li>
                        }
                      </ul>
                    }
                  </div>
                  <div class="sm:border-l sm:border-border sm:pl-4 flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0">
                    <div class="text-right">
                      <span class="text-2xl md:text-3xl font-extrabold text-primary leading-none">
                        {{ sp.base_price | currency:sp.currency:'symbol':'1.0-0' }}
                      </span>
                      <p class="text-xs text-text-secondary mt-1">/{{ cycleLabel(sp.billing_cycle) }}</p>
                    </div>
                    @if (sp.is_free) {
                      <span class="text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-800">
                        Sin costo
                      </span>
                    }
                  </div>
                </div>
                <div class="border-t border-border"></div>
              }

              <!-- Change type — compact inline -->
              <div class="flex items-center gap-2">
                <app-icon
                  [name]="p.kind === 'upgrade' ? 'trending-up' : p.kind === 'downgrade' ? 'trending-down' : p.kind === 're_subscribe' ? 'refresh-cw' : 'arrow-right-left'"
                  [size]="14"
                  [class.text-green-600]="p.kind === 'upgrade'"
                  [class.text-blue-600]="p.kind === 'same-tier'"
                  [class.text-amber-600]="p.kind === 'downgrade'"
                  [class.text-blue-600]="p.kind === 're_subscribe'"
                ></app-icon>
                <span
                  class="text-xs font-semibold"
                  [class.text-green-700]="p.kind === 'upgrade'"
                  [class.text-blue-700]="p.kind === 'same-tier'"
                  [class.text-amber-700]="p.kind === 'downgrade'"
                  [class.text-blue-700]="p.kind === 're_subscribe'"
                >
                  {{ kindLabel(p.kind) }}
                </span>
              </div>

              @if (isResubscribe()) {
                <div class="p-3 bg-primary/10 rounded-xl border border-primary/20">
                  <p class="text-xs text-text-secondary mb-1">Plan a contratar</p>
                  <p class="text-lg font-bold text-primary">{{ asNumber(p.new_effective_price) | currency }}</p>
                  <p class="text-xs text-primary mt-1">por ciclo</p>
                </div>
                <div class="flex items-start gap-3 p-3 rounded-lg" style="background: var(--color-info-light); border: 1px solid color-mix(in srgb, var(--color-info) 20%, transparent);">
                  <app-icon name="info" [size]="18" style="color: var(--color-info);"></app-icon>
                  <p class="text-xs" style="color: var(--color-info);">
                    Iniciarás un <strong>ciclo nuevo</strong>. El cobro corresponde al
                    plan completo desde hoy hasta la próxima renovación.
                  </p>
                </div>
              } @else {
                <div class="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                  <div class="flex-1 min-w-0">
                    <p class="text-[10px] uppercase tracking-wide text-text-secondary">Actual</p>
                    <p class="text-sm font-bold text-text-primary truncate">{{ asNumber(p.old_effective_price) | currency }}<span class="font-normal text-text-secondary">/ciclo</span></p>
                  </div>
                  <app-icon name="arrow-right" [size]="16" class="text-text-secondary shrink-0"></app-icon>
                  <div class="flex-1 min-w-0">
                    <p class="text-[10px] uppercase tracking-wide text-text-secondary">Nuevo</p>
                    <p class="text-sm font-bold text-primary truncate">{{ asNumber(p.new_effective_price) | currency }}<span class="font-normal text-primary/70">/ciclo</span></p>
                  </div>
                </div>

                @if (daysRemainingInCycle() < currentCycleDays()) {
                  <div class="flex items-start gap-2 p-2.5 bg-blue-50 border border-blue-100 rounded-lg">
                    <app-icon name="info" [size]="14" class="text-blue-600 mt-0.5 shrink-0"></app-icon>
                    <p class="text-xs text-blue-900">
                      Quedan <strong>{{ daysRemainingInCycle() }}</strong>/{{ currentCycleDays() }} días del ciclo — cobro prorrateado.
                    </p>
                  </div>
                }
              }

              <!-- G8 — Política de cobro y suscripción (paid plan).
                   Cubre: cobro recurrente automatizado, fecha del próximo
                   cobro (data-driven cuando hay invoice), no-reembolso,
                   posibilidad de cancelar la auto-renovación desde el panel.
                   S3.5 — Always visible: the commit either charges now or
                   voids a scheduled cancel (which restores future charges),
                   so the recurring-billing terms apply in both cases. The
                   no-refund checkbox is skipped at the CTA level when
                   chargeNow=0. -->
              <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 md:p-4 space-y-3">
                <div class="flex items-start gap-2">
                  <app-icon name="info" [size]="16" class="text-amber-700 mt-0.5 shrink-0"></app-icon>
                  <div class="space-y-2 min-w-0">
                    <h3 class="text-xs font-semibold text-amber-900">Política de cobro y suscripción</h3>
                    <ul class="text-xs text-amber-900 leading-relaxed space-y-1.5 list-disc pl-4">
                      <li>
                        <strong>Cobro recurrente:</strong>
                        se cobra automáticamente al final de cada ciclo.
                      </li>
                      <li>
                        <strong>No reembolsable:</strong>
                        los pagos no admiten devolución.
                      </li>
                      <li>
                        <strong>Cancelación:</strong>
                        puedes cancelar la auto-renovación cuando quieras desde tu panel.
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </app-card>
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
                @if (prorationDiscount() > 0) {
                  <div class="flex justify-between items-center" role="listitem">
                    <span class="text-sm text-text-secondary">
                      Plan {{ targetCycleDays() }} días
                    </span>
                    <span class="text-sm font-medium text-text-primary">
                      {{ asNumber(p.new_effective_price) | currency }}
                    </span>
                  </div>
                  <div class="flex justify-between items-center" role="listitem">
                    <span class="text-sm text-text-secondary">
                      Descuento prorrateado ({{ daysRemainingInCycle() }} de {{ currentCycleDays() }} días no usados)
                    </span>
                    <span class="text-sm font-medium text-green-600">
                      -{{ prorationDiscount() | currency }}
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

              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  [checked]="noRefundAcknowledged()"
                  (change)="toggleAck($event)"
                  class="w-4 h-4 rounded border-border text-primary focus:ring-primary shrink-0"
                />
                <span class="text-xs text-text-secondary leading-tight">
                  Acepto la
                  <a
                    [routerLink]="'/legal/terminos'"
                    fragment="pagos-y-reembolsos"
                    target="_blank"
                    class="font-medium text-primary hover:underline"
                  >política de cobro y términos de servicio</a>.
                </span>
              </label>

              <div class="pt-2 space-y-2">
                <app-button
                  variant="primary"
                  [loading]="committing()"
                  [disabled]="(chargeNow() > 0 && !noRefundAcknowledged()) || committing()"
                  [fullWidth]="true"
                  (clicked)="confirmCheckout()"
                >
                  <app-icon name="check" [size]="16" slot="icon"></app-icon>
                  {{ confirmCtaLabel() }}
                </app-button>
                <app-button variant="ghost" [fullWidth]="true" (clicked)="goBack()">Cancelar</app-button>
              </div>
            </div>
          </app-card>
        </div>
      }

      <!-- S2.1 — Coupon redemption block. Placed at the bottom, after the
           plan variants, so the user first sees what they're contracting and
           the coupon stays as an optional discount tool. Hidden during
           loading and on error to avoid noise. -->
      @if (!loadingPreview() && (freePlan() || trialSwapInfo() || proration())) {
        <div class="border-t border-border/50 pt-8">
        <app-card>
          <div class="p-4 md:p-5 space-y-3">
            <div class="flex items-center gap-2">
              <app-icon name="tag" [size]="18" class="text-primary"></app-icon>
              <h3 class="text-sm font-semibold text-text-primary">Código de cupón</h3>
            </div>

            @if (appliedCoupon(); as ac) {
              <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                <div class="space-y-1 min-w-0">
                  <p class="text-sm font-semibold text-emerald-900 truncate">
                    Cupón aplicado: {{ ac.plan.name }}
                  </p>
                  <p class="text-xs text-emerald-800">
                    Código <span class="font-mono">{{ ac.code }}</span>
                    @if (ac.duration_days) {
                      · {{ ac.duration_days }} días
                    }
                    @if (ac.expires_at) {
                      · vence {{ ac.expires_at | date:'mediumDate' }}
                    }
                  </p>
                </div>
                <button
                  type="button"
                  (click)="removeCoupon()"
                  class="text-xs font-medium text-emerald-900 underline-offset-2 hover:underline shrink-0"
                >
                  Quitar cupón
                </button>
              </div>
            } @else {
              <div class="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  [formControl]="couponControl"
                  placeholder="Ingresa tu código"
                  class="flex-1 px-3 py-2 border border-border rounded-lg text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-primary"
                  autocomplete="off"
                  spellcheck="false"
                  maxlength="64"
                />
                <app-button
                  variant="primary"
                  [loading]="couponValidating()"
                  [disabled]="couponValidating() || couponControl.invalid"
                  (clicked)="applyCoupon()"
                >
                  Aplicar
                </app-button>
              </div>
              @if (couponErrorCopy(); as err) {
                <p class="text-xs text-red-700 flex items-center gap-1">
                  <app-icon name="alert-circle" [size]="14"></app-icon>
                  {{ err }}
                </p>
              }
            }
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
  private wompiCheckoutService = inject(WompiCheckoutService);

  readonly preview = signal<CheckoutPreviewResponse | null>(null);
  readonly loadingPreview = signal(false);
  readonly committing = signal(false);
  readonly hasError = signal(false);
  readonly selectedPlan = signal<SubscriptionPlan | null>(null);
  // G8 — checkbox obligatorio de aceptación de política de no-reembolso.
  readonly noRefundAcknowledged = signal(false);

  // RNC-PaidPlan — Tracks whether the Wompi widget produced a terminal payment
  // outcome (APPROVED or PENDING). When the user closes the widget without
  // either, the `onClosed` handler invokes `cancelPendingChange()` so the
  // backend doesn't keep the subscription stuck in `pending_payment` with
  // `pending_plan_id` set indefinitely.
  private readonly paymentSucceeded = signal(false);

  // S2.1 — Coupon redemption form + facade signals.
  readonly couponControl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(64)],
  });
  readonly appliedCoupon = this.facade.appliedCoupon;
  readonly couponValidating = this.facade.couponValidating;
  readonly couponError = this.facade.couponError;
  readonly couponErrorCopy = computed(() => {
    const err = this.couponError();
    if (!err) return null;
    return COUPON_REASON_COPY[err as string] ?? `No se pudo aplicar el cupón (${err})`;
  });

  // S2.1 — Track the previously applied code so we only refresh the preview
  // on actual transitions (skip the initial null → null read). ngOnInit
  // performs the first load explicitly.
  private lastCouponCode: string | null = null;
  private couponEffect = effect(() => {
    const ac = this.appliedCoupon();
    const code = ac?.code ?? null;
    if (code === this.lastCouponCode) return;
    this.lastCouponCode = code;
    const planId = this.route.snapshot.paramMap.get('planId');
    if (planId) {
      // Skip the very first run (planId not yet read in ngOnInit). The init
      // loadPreview call in ngOnInit will fire once after this effect.
      if (code === null && !this.preview()) return;
      this.loadPreview(planId, code ?? undefined);
    }
  });

  readonly freePlan = computed(() => this.preview()?.free_plan ?? null);
  readonly proration = computed(() => this.preview()?.proration ?? null);
  readonly invoice = computed(() => this.preview()?.invoice ?? null);
  // S3.4 — Trial plan-swap variant detection. Backend marks the preview
  // with `kind === 'trial_plan_swap'` and embeds plan metadata in
  // `trial_swap`. The view branches on this signal to render the
  // deferred-change card instead of the regular breakdown.
  //
  // Bundle both `trial_swap` and `new_effective_price` in a single
  // computed snapshot so the template reads them atomically. Reading
  // `proration()?.new_effective_price` separately inside the @if block
  // caused NG0100 (ExpressionChangedAfterItHasBeenChecked) when the
  // preview signal flipped during the verify-changes pass.
  readonly trialSwapInfo = computed(() => {
    const p = this.proration();
    if (!p || p.kind !== 'trial_plan_swap' || !p.trial_swap) return null;
    return {
      ...p.trial_swap,
      new_effective_price: p.new_effective_price,
    };
  });

  readonly chargeNow = computed(() => {
    const inv = this.preview()?.proration?.invoice_to_issue ?? this.preview()?.invoice ?? null;
    return inv ? this.asNumber(inv.total) : 0;
  });

  // Difference between the plan's full cycle price and what is actually
  // charged today. Surfaces the prorated savings in the summary so the user
  // sees both the "list price" and the discount applied for the unused days.
  // Returns 0 when there is no discount (downgrade / re_subscribe / first
  // charge of a fresh cycle).
  readonly prorationDiscount = computed(() => {
    const p = this.proration();
    if (!p) return 0;
    const fullPrice = this.asNumber(p.new_effective_price);
    const charge = this.chargeNow();
    if (fullPrice <= 0 || charge <= 0) return 0;
    return Math.max(0, Math.round(fullPrice - charge));
  });

  // Single source of truth: cycle_days and days_remaining come from the
  // backend's ProrationPreview. The same numbers used to compute the
  // discount $ are exposed on the wire so the UI can label the breakdown
  // without reproducing the math (which previously drifted because the FE
  // was deriving cycleDays from billing_cycle while BE derived it from
  // (period_end - period_start)).
  readonly currentCycleDays = computed(
    () => this.proration()?.cycle_days ?? 0,
  );

  readonly daysRemainingInCycle = computed(
    () => this.proration()?.days_remaining ?? 0,
  );

  readonly daysConsumedInCycle = computed(
    () => Math.max(0, this.currentCycleDays() - this.daysRemainingInCycle()),
  );

  // Target-plan cycle length is the only piece backend doesn't echo because
  // it's not part of the proration: it's a property of the plan the user is
  // buying. Read it from `selectedPlan().billing_cycle` (same map the BE
  // uses internally via `billingCycleDays`).
  readonly targetCycleDays = computed(() => {
    const cycle = this.selectedPlan()?.billing_cycle as string | undefined;
    if (cycle === 'yearly' || cycle === 'annual') return 365;
    if (cycle === 'monthly') return 30;
    if (cycle === 'quarterly') return 90;
    if (cycle === 'semiannual') return 180;
    return this.currentCycleDays();
  });

  // RNC-15 — Trial → paid plan path. The backend returns kind='re_subscribe'
  // for trial → paid (anti-arrastre). We detect it on the frontend by reading
  // the current subscription status from the facade so we can show accurate
  // copy ("Suscríbete al plan…" instead of "Reactivar suscripción").
  readonly isTrialUpgrade = computed(
    () => this.isResubscribe() && this.facade.status() === 'trialing',
  );

  readonly headerTitle = computed(() => {
    if (this.trialSwapInfo()) return 'Cambiar plan durante prueba';
    if (this.freePlan()) return 'Activar Plan';
    if (this.isTrialUpgrade()) return 'Suscríbete al plan';
    if (this.isResubscribe()) return 'Reactivar suscripción';
    if (this.voidsScheduledCancelOnly()) return 'Reanudar suscripción';
    return 'Confirmar Cambio de Plan';
  });

  /**
   * S3.5 — True when the only effect of confirming is voiding a scheduled
   * cancellation: same plan + no charge today. Drives header copy and CTA
   * label so the user understands they're not buying a different plan.
   */
  readonly voidsScheduledCancelOnly = computed(() => {
    const p = this.proration();
    return (
      !!p?.voids_scheduled_cancel?.active &&
      this.chargeNow() === 0 &&
      p.kind === 'same-tier'
    );
  });

  readonly confirmCtaLabel = computed(() => {
    if (this.voidsScheduledCancelOnly()) return 'Reanudar suscripción';
    if (this.chargeNow() === 0) return 'Confirmar cambio';
    return 'Confirmar y pagar';
  });
  readonly headerSubtitle = computed(() => {
    if (this.trialSwapInfo())
      return 'Mantienes tu prueba activa, sin cobros inmediatos';
    if (this.freePlan()) return 'Activa tu plan sin costo en un solo paso';
    if (this.isTrialUpgrade())
      return 'Tu prueba termina al confirmar el pago. Comienzas un ciclo completo desde hoy.';
    if (this.isResubscribe())
      return 'Inicia un ciclo nuevo eligiendo el plan que prefieras';
    return 'Revisa los detalles antes de confirmar';
  });

  ngOnInit(): void {
    const planId = this.route.snapshot.paramMap.get('planId');
    if (!planId) {
      this.router.navigate(['/admin/subscription/plans']);
      return;
    }
    // S2.1 — If a coupon arrived via query param (from PlanCatalog) and the
    // facade doesn't already hold it (e.g. hard reload), auto-trigger
    // validation so the preview can lift the overlay on first load.
    const queryCoupon = this.route.snapshot.queryParamMap.get('coupon');
    const existing = this.facade.appliedCoupon();
    if (queryCoupon && !existing) {
      this.couponControl.setValue(queryCoupon);
      this.facade.validateCoupon(queryCoupon);
    }
    this.loadPreview(planId, existing?.code ?? queryCoupon ?? undefined);
    this.loadSelectedPlan(planId);
  }

  private loadSelectedPlan(planId: string): void {
    this.subscriptionService.getPlans()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            const plan = res.data.find(p => String(p.id) === String(planId)) ?? null;
            this.selectedPlan.set(plan);
          }
        },
      });
  }

  private loadPreview(planId: string, couponCode?: string): void {
    this.loadingPreview.set(true);
    this.hasError.set(false);
    this.subscriptionService.checkoutPreview(planId, couponCode)
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
        error: (err) => {
          this.hasError.set(true);
          this.loadingPreview.set(false);
          // S3.7 — Use the canonical extractApiErrorMessage helper. It reads
          // the backend `error_code` and looks up the Spanish UX copy from
          // ERROR_MESSAGES, falling back to a generic message when unknown.
          this.toastService.error(extractApiErrorMessage(err));
        },
      });
  }

  retry(): void {
    const planId = this.route.snapshot.paramMap.get('planId');
    if (planId) this.loadPreview(planId, this.appliedCoupon()?.code);
  }

  applyCoupon(): void {
    const code = (this.couponControl.value ?? '').trim();
    if (!code) return;
    this.facade.validateCoupon(code);
  }

  removeCoupon(): void {
    this.facade.clearCoupon();
    this.couponControl.reset('');
  }

  toggleAck(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.noRefundAcknowledged.set(!!target?.checked);
  }

  confirmCheckout(): void {
    const planId = this.route.snapshot.paramMap.get('planId');
    if (!planId) return;

    // Idempotency probe — Plan separado vs pagado (RNC-PaidPlan):
    // Si el backend ya emitió un invoice para este mismo planId como
    // pending_change, ir directo al retry-payment en lugar de crear otro.
    // Esto evita duplicar invoices cuando el usuario hace clic "Confirmar"
    // por segunda vez tras cerrar el widget de Wompi sin completar el pago.
    const currentSub: any = this.facade.current();
    if (
      currentSub?.pending_plan_id != null &&
      String(currentSub.pending_plan_id) === String(planId) &&
      currentSub?.pending_change_invoice_id != null
    ) {
      // Ya existe un invoice pendiente para este plan — redirigir a la
      // página de suscripción donde el usuario puede completar el pago
      // con el botón "Completar pago" (retryPayment).
      this.toastService.info(
        'Ya tienes un cambio de plan en proceso. Completa el pago pendiente.',
      );
      this.router.navigate(['/admin/subscription']);
      return;
    }

    // S3.4 — Trial plan-swap is free and deferred (no charge today).
    // Free plans likewise emit no charge. The no-refund acknowledgement
    // only applies to flows that actually emit a charge, so we skip the
    // UI guard for both. The backend mirrors this exception.
    // S3.5 — Same-tier voiding a scheduled cancel also has chargeNow=0;
    // skip the ack requirement uniformly when chargeNow is 0.
    const swap = this.trialSwapInfo();
    const free = this.freePlan();
    const noChargeFlow = !!swap || !!free || this.chargeNow() === 0;
    if (!noChargeFlow && !this.noRefundAcknowledged()) {
      this.toastService.error('Debes aceptar la política de no-reembolso');
      return;
    }

    const returnUrl = `${window.location.origin}/admin/subscription`;
    const acknowledgedAt = new Date().toISOString();
    // Flows without a charge (trial swap, free plan) send `false` so the
    // backend records the absence of acknowledgement faithfully — backend
    // bypasses the hard block when sub.state === 'trial' or plan is free.
    const ackFlag = noChargeFlow ? false : true;

    this.committing.set(true);
    const couponCode = this.appliedCoupon()?.code;
    this.subscriptionService
      .checkoutCommit(planId, undefined, returnUrl, ackFlag, acknowledgedAt, couponCode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.facade.loadCurrent();
          // Paid fresh purchase → backend returns Wompi widget config.
          // Free plan / inline-charged upgrade / trial swap → widget is null.
          const widget = res?.data?.widget as WompiWidgetConfig | null;
          // Pull-fallback: backend now returns `invoiceId` on the commit
          // response so the polling loop can reconcile against Wompi
          // directly when the webhook can't reach localhost.
          const invoiceId =
            typeof res?.data?.invoiceId === 'number'
              ? (res.data.invoiceId as number)
              : null;
          if (widget) {
            this.openWompiWidget(widget, invoiceId);
            return;
          }
          // Defense in depth: if there is a charge to collect AND the target
          // plan is NOT free, the backend MUST return a Wompi widget config.
          // Receiving widget=null here means a server-side regression has
          // routed the commit through a free-plan branch without charging.
          // Surface an error rather than navigating to a misleading
          // "success" state. Prefer the explicit `target_plan_is_free` flag
          // (server-authoritative); fall back to chargeNow heuristic only
          // when older backends omit the field.
          const proration = this.proration();
          const targetIsFree =
            proration && typeof proration.target_plan_is_free === 'boolean'
              ? proration.target_plan_is_free
              : !!this.freePlan();
          if (!swap && !targetIsFree && this.chargeNow() > 0) {
            this.committing.set(false);
            this.toastService.error(
              'Error procesando el cobro. Por favor refresca la página y reintenta.',
            );
            return;
          }
          if (swap) {
            const trialEndsAt = new Date(swap.trial_ends_at).toLocaleDateString(
              'es-CO',
              { day: 'numeric', month: 'long', year: 'numeric' },
            );
            this.toastService.success(
              `Cambiaste a ${swap.new_plan.name}. Tu prueba continúa hasta ${trialEndsAt}.`,
            );
          } else {
            this.toastService.success(
              this.freePlan() ? 'Plan activado exitosamente' : 'Plan cambiado exitosamente',
            );
          }
          this.committing.set(false);
          this.router.navigate(['/admin/subscription']);
        },
        error: (err) => {
          this.committing.set(false);
          // S3.7 — Translate backend error_code into precise Spanish copy via
          // the canonical helper. Critical for SUBSCRIPTION_GATEWAY_003,
          // SUBSCRIPTION_CARD_DECLINED, SUBSCRIPTION_PROVIDER_UNAVAILABLE.
          this.toastService.error(extractApiErrorMessage(err));
        },
      });
  }

  /**
   * Phase 3 — Delegates to the shared `WompiCheckoutService.openWidget`. Every
   * callback path (approved/declined/pending/closed/error) refreshes the
   * subscription state via `loadCurrent()` so the UI never lags behind the
   * webhook. The APPROVED path also kicks off polling so the banner flips
   * `pending_payment → active` as soon as the backend persists the change.
   */
  private async openWompiWidget(
    config: WompiWidgetConfig,
    invoiceId: number | null = null,
  ): Promise<void> {
    // Defensive reset — the user may re-open the widget after closing it
    // once. Without this, a previous APPROVED/PENDING flag would leak across
    // sessions and skip the cleanup on a true abandonment.
    this.paymentSucceeded.set(false);
    await this.wompiCheckoutService.openWidget(config, {
      onApproved: () => {
        this.paymentSucceeded.set(true);
        this.committing.set(false);
        // Always refresh first; the response might already be `active` if
        // the synchronous webhook fast-path won, otherwise polling catches
        // the async transition.
        this.facade.loadCurrent();
        // Pull-fallback: when invoiceId is known, the polling loop will
        // hit /sync-from-gateway each cycle so localhost dev stops getting
        // stuck in pending_payment.
        this.facade.pollSubscriptionUntilActive({ invoiceId });
        this.toastService.info('Verificando confirmación de pago…');
        this.router.navigate(['/admin/subscription']);
      },
      onDeclined: () => {
        this.committing.set(false);
        this.facade.loadCurrent();
        this.toastService.error(
          'El pago fue rechazado. Intenta con otro método de pago.',
        );
      },
      onPending: () => {
        // PSE/transferencia in-flight — backend awaits webhook, do NOT cancel
        // the pending change on close. Cron reconciles after 60min if the
        // webhook never arrives.
        this.paymentSucceeded.set(true);
        this.committing.set(false);
        this.facade.loadCurrent();
        this.facade.pollSubscriptionUntilActive({ invoiceId });
        this.toastService.info(
          'Pago pendiente de confirmación. Verificando…',
        );
        this.router.navigate(['/admin/subscription']);
      },
      onClosed: () => {
        this.committing.set(false);
        if (this.paymentSucceeded()) {
          this.facade.loadCurrent();
          return;
        }
        // True abandonment — wipe the pending change server-side so the
        // subscription returns to its previous state. If the HTTP call
        // fails, fall back to the cron's 60-minute reconciler.
        this.subscriptionService.cancelPendingChange().subscribe({
          next: () => {
            this.facade.loadCurrent();
            this.toastService.info('Cambio cancelado');
          },
          error: () => {
            this.facade.loadCurrent();
            this.toastService.warning(
              'No pudimos limpiar el cambio. Se eliminará automáticamente en unos minutos.',
            );
          },
        });
      },
      onError: () => {
        this.committing.set(false);
        this.facade.loadCurrent();
        this.toastService.error(
          'No se pudo abrir el widget de pago. Intenta de nuevo.',
        );
      },
    });
  }

  goBack(): void {
    this.router.navigate(['/admin/subscription/plans']);
  }

  asNumber(value: string | number | null | undefined): number {
    if (value === null || value === undefined) return 0;
    const n = typeof value === 'string' ? parseFloat(value) : value;
    return isNaN(n) ? 0 : n;
  }

  cycleLabel(cycle: string): string {
    switch (cycle) {
      case 'monthly': return 'mes';
      case 'quarterly': return 'trimestre';
      case 'semiannual': return 'semestre';
      case 'annual':
      case 'yearly':
        return 'año';
      case 'lifetime': return 'pago único';
      default: return cycle;
    }
  }

  kindLabel(
    kind:
      | 'upgrade'
      | 'downgrade'
      | 'same-tier'
      | 'trial_plan_swap'
      | 're_subscribe',
  ): string {
    switch (kind) {
      case 'upgrade': return 'Mejora';
      case 'downgrade': return 'Cambio menor';
      case 'same-tier': return 'Mismo nivel';
      case 'trial_plan_swap': return 'Cambio durante prueba';
      case 're_subscribe': return 'Reactivación';
    }
  }

  /**
   * True when the proration preview signals that the current subscription is
   * `cancelled` or `expired`. Drives a different layout: no "días restantes"
   * notice, no proration badge, single CTA "Reactivar y pagar".
   */
  readonly isResubscribe = computed(
    () => this.proration()?.kind === 're_subscribe',
  );
}
