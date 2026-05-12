import { Component, DestroyRef, OnInit, inject, computed, effect, signal, untracked } from '@angular/core';
import { DatePipe, CurrencyPipe, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CardComponent,
  IconComponent,
  ButtonComponent,
  EmptyStateComponent,
  StickyHeaderComponent,
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
  ToastService,
} from '../../../../../../shared/components/index';
import { SubscriptionFacade } from '../../../../../../core/store/subscription/subscription.facade';
import { StoreSubscriptionService } from '../../services/store-subscription.service';
import { WompiCheckoutService } from '../../../../../../core/services/wompi-checkout.service';
import {
  STATE_PAYWALL_MAP,
  SubscriptionAccessService,
} from '../../../../../../core/services/subscription-access.service';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import {
  CancellationFlowModalComponent,
  CancellationConfirmedPayload,
} from '../../components/cancellation-flow-modal/cancellation-flow-modal.component';

@Component({
  selector: 'app-my-subscription',
  standalone: true,
  imports: [
    CardComponent,
    IconComponent,
    ButtonComponent,
    EmptyStateComponent,
    StickyHeaderComponent,
    CancellationFlowModalComponent,
    DatePipe,
    CurrencyPipe,
    DecimalPipe,
  ],
  template: `
    <div class="w-full min-h-full">
      <!-- Sticky header with actions -->
      <app-sticky-header
        title="Mi Suscripción"
        [subtitle]="headerSubtitle()"
        [icon]="headerIcon()"
        variant="glass"
        [badgeText]="badgeLabel()"
        [badgeColor]="badgeColor()"
        [badgePulse]="needsAttention()"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      ></app-sticky-header>

      <div class="max-w-6xl mx-auto px-4 py-6 lg:py-8 space-y-6">
        <!-- RNC-PaidPlan — Unified subscription state banner. Driven by
             facade.subscriptionUiState (single source of truth). Mutually
             exclusive cases — only one banner is ever rendered. -->
        @switch (uiState().kind) {
          @case ('pending_initial_payment') {
            <div
              class="rounded-2xl border-l-4 border-amber-500 bg-amber-50 p-4 md:p-5 shadow-sm"
              role="status"
              aria-live="polite"
            >
              <div class="flex flex-col sm:flex-row sm:items-start gap-4">
                <div class="flex items-start gap-3 flex-1 min-w-0">
                  <div class="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                    <app-icon name="alert-triangle" [size]="20" class="text-amber-700"></app-icon>
                  </div>
                  <div class="space-y-1 min-w-0">
                    <h3 class="text-sm md:text-base font-bold text-amber-900">
                      Completa tu pago para activar tu plan {{ pendingPlanLabel() }}
                    </h3>
                    <p class="text-xs md:text-sm text-amber-900/85 leading-relaxed">
                      Si ya pagaste, espera unos segundos mientras confirmamos con la pasarela.
                    </p>
                  </div>
                </div>
                <div class="flex flex-col sm:flex-row gap-2 sm:items-center sm:shrink-0">
                  <app-button
                    variant="primary"
                    [loading]="retryingPayment()"
                    [disabled]="retryingPayment() || cancellingPendingChange()"
                    (clicked)="retryPayment()"
                  >
                    <app-icon name="credit-card" [size]="16" slot="icon"></app-icon>
                    Completar pago
                  </app-button>
                  <app-button
                    variant="ghost"
                    [loading]="cancellingPendingChange()"
                    [disabled]="retryingPayment() || cancellingPendingChange()"
                    (clicked)="cancelPendingChange()"
                  >
                    Cancelar
                  </app-button>
                </div>
              </div>
            </div>
          }

          @case ('pending_change_abandoned') {
            <div
              class="rounded-2xl border-l-4 border-amber-400 bg-amber-50 p-4 md:p-5 shadow-sm"
              role="status"
              aria-live="polite"
            >
              <div class="flex flex-col sm:flex-row sm:items-start gap-4">
                <div class="flex items-start gap-3 flex-1 min-w-0">
                  <div class="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                    <app-icon name="clock" [size]="20" class="text-amber-700"></app-icon>
                  </div>
                  <div class="space-y-1 min-w-0">
                    <h3 class="text-sm md:text-base font-bold text-amber-900">
                      Tienes un cambio de plan pendiente
                    </h3>
                    <p class="text-xs md:text-sm text-amber-900/85 leading-relaxed">
                      {{ pendingChangeFromLabel() }} → {{ pendingChangeToLabel() }}.
                      Puedes retomar el pago o cancelar el cambio para conservar tu plan actual.
                    </p>
                  </div>
                </div>
                <div class="flex flex-col sm:flex-row gap-2 sm:items-center sm:shrink-0">
                  <app-button
                    variant="primary"
                    [loading]="retryingPendingChange()"
                    [disabled]="retryingPendingChange() || cancellingPendingChange()"
                    (clicked)="retryPendingChange()"
                  >
                    <app-icon name="credit-card" [size]="16" slot="icon"></app-icon>
                    Completar pago
                  </app-button>
                  <app-button
                    variant="ghost"
                    [loading]="cancellingPendingChange()"
                    [disabled]="retryingPendingChange() || cancellingPendingChange()"
                    (clicked)="cancelPendingChange()"
                  >
                    Cancelar cambio
                  </app-button>
                </div>
              </div>
            </div>
          }
        }

        <!-- Loading -->
        @if (loading()) {
          <div class="space-y-4 animate-pulse" aria-busy="true">
            <div class="h-44 bg-gray-200 rounded-2xl"></div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div class="h-24 bg-gray-200 rounded-xl"></div>
              <div class="h-24 bg-gray-200 rounded-xl"></div>
              <div class="h-24 bg-gray-200 rounded-xl"></div>
            </div>
            <div class="h-72 bg-gray-200 rounded-2xl"></div>
          </div>
        }

        <!-- Active subscription -->
        @if (!loading() && current() && !isNoPlan()) {
          <!-- Hero Card -->
          <div
            class="relative overflow-hidden rounded-2xl shadow-xl text-white p-6 md:p-8"
            [style.background]="heroGradient()"
          >
            <!-- Decorative pattern -->
            <div class="absolute inset-0 opacity-10 pointer-events-none">
              <div class="absolute top-0 right-0 w-72 h-72 rounded-full bg-white blur-3xl -translate-y-24 translate-x-24"></div>
              <div class="absolute bottom-0 left-0 w-56 h-56 rounded-full bg-white blur-3xl translate-y-20 -translate-x-20"></div>
            </div>

            <app-icon
              name="crown"
              [size]="140"
              class="absolute -top-6 -right-6 text-white opacity-15 pointer-events-none"
            ></app-icon>

            <div class="relative space-y-5">
              <div class="flex items-start gap-4 flex-wrap">
                <!-- Plan avatar -->
                <div class="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur border border-white/30 flex items-center justify-center shrink-0">
                  <app-icon
                    [name]="isTerminal() || isSuspendedOrBlocked() ? 'alert-octagon' : (currentPlanUnavailable() || isGrace() ? 'alert-triangle' : (isTrial() ? 'hourglass' : 'sparkles'))"
                    [size]="28"
                    class="text-white"
                  ></app-icon>
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-[11px] uppercase tracking-widest text-white/70 font-bold mb-1">
                    Mi plan actual
                  </p>
                  <h2 class="text-3xl md:text-4xl font-extrabold leading-tight truncate">
                    {{ planName() }}
                  </h2>
                </div>
                <span
                  class="inline-flex items-center gap-1.5 bg-white/20 backdrop-blur border border-white/30 px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide shrink-0"
                >
                  <span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                  {{ currentPlanUnavailable() ? 'Plan no disponible' : getStatusLabel() }}
                </span>
              </div>

              <!-- Price -->
              <div class="flex items-baseline gap-2 pt-1">
                <span class="text-4xl md:text-5xl font-extrabold tracking-tight">
                  {{ (current()?.effective_price || 0) | currency }}
                </span>
                <span class="text-base text-white/80 font-medium">/{{ cycleSuffix() }}</span>
              </div>

              <!-- Archived / disabled plan notice. Existing subscriptions can
                    keep pointing to a plan that is no longer sellable; surface
                    that legacy state so the store owner changes plan instead of
                    seeing a healthy green card. -->
              @if (currentPlanUnavailable()) {
                <div class="flex flex-col sm:flex-row sm:items-start gap-3 bg-red-400/25 backdrop-blur border border-red-200/40 rounded-lg px-3 py-2">
                  <div class="flex items-start gap-2 flex-1 min-w-0">
                    <app-icon name="alert-triangle" [size]="16" class="text-red-100 mt-0.5 shrink-0"></app-icon>
                    <span class="text-xs text-red-50 leading-relaxed">
                      <span class="font-bold">Este plan ya no está disponible.</span>
                      No podrá renovarse como una suscripción nueva. Cambia a un plan vigente para evitar interrupciones cuando termine el ciclo.
                    </span>
                  </div>
                  <app-button
                    variant="primary"
                    size="sm"
                    (clicked)="goToPlans()"
                  >
                    <app-icon name="refresh-cw" [size]="14" slot="icon"></app-icon>
                    Cambiar plan
                  </app-button>
                </div>
              }

              <!-- Scheduled cancellation notice — shown when the user
                    triggered "cancel at end of cycle" but the period has not
                    ended yet, so the plan is technically still active. -->
              @if (scheduledCancelAt(); as cancelAt) {
                <div class="flex items-start gap-2 bg-amber-400/20 backdrop-blur border border-amber-200/40 rounded-lg px-3 py-2">
                  <app-icon name="alert-triangle" [size]="16" class="text-amber-100 mt-0.5 shrink-0"></app-icon>
                  <span class="text-xs text-amber-50 leading-relaxed">
                    Cancelación programada para
                    <span class="font-bold">{{ cancelAt | date:'mediumDate' }}</span>.
                    Tu plan seguirá activo hasta esa fecha.
                  </span>
                </div>
              }

              <!-- Grace period notice — shown when payment is overdue and the
                    subscription entered grace_soft or grace_hard. Orange banner
                    inside the hero card to make the urgency impossible to miss. -->
              @if (isGrace()) {
                <div class="flex items-start gap-2 bg-orange-400/25 backdrop-blur border border-orange-200/40 rounded-lg px-3 py-2">
                  <app-icon name="alert-triangle" [size]="16" class="text-orange-100 mt-0.5 shrink-0"></app-icon>
                  <span class="text-xs text-orange-50 leading-relaxed">
                    <span class="font-bold">
                      {{ status() === 'grace_hard' ? 'Período de gracia final' : 'Tu suscripción está en período de gracia' }}.
                    </span>
                    {{ graceDaysOverdue() > 0 ? 'Tienes ' + graceDaysOverdue() + ' día(s) de pago vencido.' : 'Se pasó la fecha de pago.' }}
                    Regulariza tu pago para evitar la suspensión.
                  </span>
                </div>
              }

              <!-- Suspended state notice -->
              @if (status() === 'suspended') {
                <div class="flex flex-col sm:flex-row sm:items-start gap-3 bg-red-400/25 backdrop-blur border border-red-200/40 rounded-lg px-3 py-2">
                  <div class="flex items-start gap-2 flex-1 min-w-0">
                    <app-icon name="pause-circle" [size]="16" class="text-red-100 mt-0.5 shrink-0"></app-icon>
                    <span class="text-xs text-red-50 leading-relaxed">
                      <span class="font-bold">Tu tienda está suspendida por falta de pago.</span>
                      Tus datos están seguros pero el acceso está restringido.
                      Regulariza tu pago para reactivar todos los servicios.
                    </span>
                  </div>
                  <app-button
                    variant="primary"
                    size="sm"
                    (clicked)="goToDunning()"
                  >
                    <app-icon name="credit-card" [size]="14" slot="icon"></app-icon>
                    Pagar ahora
                  </app-button>
                </div>
              }

              <!-- Blocked state notice -->
              @if (status() === 'blocked') {
                <div class="flex flex-col sm:flex-row sm:items-start gap-3 bg-red-400/25 backdrop-blur border border-red-200/40 rounded-lg px-3 py-2">
                  <div class="flex items-start gap-2 flex-1 min-w-0">
                    <app-icon name="shield-alert" [size]="16" class="text-red-100 mt-0.5 shrink-0"></app-icon>
                    <span class="text-xs text-red-50 leading-relaxed">
                      <span class="font-bold">Tu tienda fue bloqueada.</span>
                      El acceso a tu tienda está restringido. Contacta a soporte para más información y restablecer el acceso.
                    </span>
                  </div>
                  <app-button
                    variant="primary"
                    size="sm"
                    (clicked)="goToDunning()"
                  >
                    <app-icon name="headphones" [size]="14" slot="icon"></app-icon>
                    Contactar soporte
                  </app-button>
                </div>
              }

              <!-- Cancelled state notice -->
              @if (status() === 'cancelled') {
                <div class="flex flex-col sm:flex-row sm:items-start gap-3 bg-red-400/25 backdrop-blur border border-red-200/40 rounded-lg px-3 py-2">
                  <div class="flex items-start gap-2 flex-1 min-w-0">
                    <app-icon name="x-circle" [size]="16" class="text-red-100 mt-0.5 shrink-0"></app-icon>
                    <span class="text-xs text-red-50 leading-relaxed">
                      <span class="font-bold">Tu suscripción fue cancelada.</span>
                      Puedes seguir consultando y exportando tus datos en modo lectura.
                      Para volver a operar, reactiva con un plan.
                    </span>
                  </div>
                  <app-button
                    variant="primary"
                    size="sm"
                    (clicked)="goToPlans()"
                  >
                    <app-icon name="refresh-cw" [size]="14" slot="icon"></app-icon>
                    Reactivar suscripción
                  </app-button>
                </div>
              }

              <!-- Expired state notice -->
              @if (status() === 'expired') {
                <div class="flex flex-col sm:flex-row sm:items-start gap-3 bg-red-400/25 backdrop-blur border border-red-200/40 rounded-lg px-3 py-2">
                  <div class="flex items-start gap-2 flex-1 min-w-0">
                    <app-icon name="clock" [size]="16" class="text-red-100 mt-0.5 shrink-0"></app-icon>
                    <span class="text-xs text-red-50 leading-relaxed">
                      <span class="font-bold">Tu plan expiró.</span>
                      El período de tu plan terminó sin renovación.
                      Elige un plan para continuar operando tu tienda.
                    </span>
                  </div>
                  <app-button
                    variant="primary"
                    size="sm"
                    (clicked)="goToPlans()"
                  >
                    <app-icon name="crown" [size]="14" slot="icon"></app-icon>
                    Ver planes
                  </app-button>
                </div>
              }

              <!-- Metadata chips -->
              <div class="flex flex-wrap gap-2 pt-3 border-t border-white/20">
                @if (nextBillingAt() && !scheduledCancelAt()) {
                  <div class="inline-flex items-center gap-2 bg-white/10 backdrop-blur px-3 py-1.5 rounded-lg border border-white/20">
                    <app-icon name="calendar" [size]="14" class="text-white/90"></app-icon>
                    <span class="text-xs text-white/90">
                      Próximo cobro: <span class="font-semibold">{{ nextBillingAt() | date:'mediumDate' }}</span>
                    </span>
                  </div>
                }
                <div class="inline-flex items-center gap-2 bg-white/10 backdrop-blur px-3 py-1.5 rounded-lg border border-white/20">
                  <app-icon name="repeat" [size]="14" class="text-white/90"></app-icon>
                  <span class="text-xs text-white/90">
                    Ciclo: <span class="font-semibold">{{ cycleLabel() }}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Quick stats row (mobile horizontal scroll, desktop grid) -->
          <div class="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-2 snap-x snap-mandatory">
            <!-- Trial card (only when trial) -->
            @if (isTrial() && current()?.trial_ends_at) {
              <app-card customClasses="h-full border-l-4 border-amber-500 min-w-[260px] sm:min-w-0 snap-start">
                <div class="p-2 space-y-1.5 h-full flex flex-col justify-between">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <div class="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
                        <app-icon name="hourglass" [size]="14" class="text-amber-600"></app-icon>
                      </div>
                      <span class="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
                        Período de Prueba
                      </span>
                    </div>
                  </div>
                  <div class="flex items-baseline gap-1.5">
                    <p class="text-3xl font-extrabold text-amber-600 leading-none">{{ daysRemaining() }}</p>
                    <p class="text-xs text-text-secondary">días</p>
                  </div>
                  <div class="w-full bg-amber-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      class="h-1.5 rounded-full transition-all bg-gradient-to-r from-amber-400 to-amber-600"
                      [style.width.%]="trialProgress()"
                    ></div>
                  </div>
                </div>
              </app-card>
            }

            <!-- Cycle consumption card (active subs only — analogue of trial card).
                 Tier-driven palette: green while fresh, amber past 75%, red in
                 the last 7 days so the renewal cue is impossible to miss. -->
            @if (isActive() && !isTrial() && cycleTotalDays() > 0) {
              <app-card
                [customClasses]="
                  'h-full border-l-4 min-w-[260px] sm:min-w-0 snap-start ' +
                  (cycleProgressTier() === 'critical'
                    ? 'border-red-500'
                    : cycleProgressTier() === 'warn'
                      ? 'border-amber-500'
                      : 'border-emerald-500')
                "
              >
                <div class="p-2 space-y-1.5 h-full flex flex-col justify-between">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <div
                        class="w-7 h-7 rounded-lg flex items-center justify-center"
                        [class]="
                          cycleProgressTier() === 'critical'
                            ? 'bg-red-50'
                            : cycleProgressTier() === 'warn'
                              ? 'bg-amber-50'
                              : 'bg-emerald-50'
                        "
                      >
                        <app-icon
                          name="activity"
                          [size]="14"
                          [class]="
                            cycleProgressTier() === 'critical'
                              ? 'text-red-600'
                              : cycleProgressTier() === 'warn'
                                ? 'text-amber-600'
                                : 'text-emerald-600'
                          "
                        ></app-icon>
                      </div>
                      <span class="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
                      {{ cycleIsOverdue() ? 'Ciclo vencido' : 'Consumo del Ciclo' }}
                      </span>
                    </div>
                  </div>
                  <div class="flex items-baseline gap-1.5">
                    <p
                      class="text-3xl font-extrabold leading-none"
                      [class]="
                        cycleProgressTier() === 'critical'
                          ? 'text-red-600'
                          : cycleProgressTier() === 'warn'
                            ? 'text-amber-600'
                            : 'text-emerald-600'
                      "
                    >
                      {{ cycleDaysConsumed() }}
                    </p>
                    <p class="text-xs text-text-secondary">
                      {{ cycleIsOverdue() ? 'renovación pendiente' : 'de ' + cycleTotalDays() + ' días' }}
                    </p>
                  </div>
                  <div
                    class="w-full rounded-full h-1.5 overflow-hidden"
                    [class]="
                      cycleProgressTier() === 'critical'
                        ? 'bg-red-100'
                        : cycleProgressTier() === 'warn'
                          ? 'bg-amber-100'
                          : 'bg-emerald-100'
                    "
                  >
                    <div
                      class="h-1.5 rounded-full transition-all bg-gradient-to-r"
                      [class]="
                        cycleProgressTier() === 'critical'
                          ? 'from-red-400 to-red-600'
                          : cycleProgressTier() === 'warn'
                            ? 'from-amber-400 to-amber-600'
                            : 'from-emerald-400 to-emerald-600'
                      "
                      [style.width.%]="cycleProgress()"
                    ></div>
                  </div>
                </div>
              </app-card>
            }

            <!-- Next billing card -->
            @if (nextBillingAt(); as next) {
              <app-card customClasses="h-full min-w-[260px] sm:min-w-0 snap-start">
                <div class="p-2 space-y-1.5 h-full flex flex-col justify-between">
                  <div class="flex items-center gap-2">
                    <div class="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                      <app-icon name="calendar" [size]="14" class="text-blue-600"></app-icon>
                    </div>
                    <span class="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
                      {{ cycleIsOverdue() ? 'Cobro pendiente' : 'Próximo cobro' }}
                    </span>
                  </div>
                  <div>
                    <p class="text-base font-bold text-text-primary leading-tight">
                      {{ next | date:'mediumDate' }}
                    </p>
                    <p class="text-xs text-text-secondary mt-0.5">
                      {{ nextBillingHelperText() }}
                    </p>
                  </div>
                  <div class="text-xs text-text-secondary">
                    <span class="font-semibold text-text-primary">{{ (current()?.effective_price || 0) | currency }}</span>
                    /{{ cycleSuffix() }}
                  </div>
                </div>
              </app-card>
            }

            <!-- Status filler when no trial and no next billing (rare) -->
            @if (!isTrial() && !nextBillingAt()) {
              <app-card customClasses="h-full min-w-[260px] sm:min-w-0 snap-start">
                <div class="p-2 h-full flex flex-col justify-between">
                  <div class="flex items-center gap-2">
                    <div class="w-7 h-7 rounded-lg bg-green-50 flex items-center justify-center">
                      <app-icon name="check-circle" [size]="14" class="text-green-600"></app-icon>
                    </div>
                    <span class="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
                      Estado
                    </span>
                  </div>
                  <p class="text-base font-bold text-text-primary leading-tight">
                    {{ getStatusLabel() }}
                  </p>
                </div>
              </app-card>
            }
          </div>

          <!-- Feature usage detail -->
          <app-card>
            <div class="p-5 md:p-6 space-y-5">
              <div class="flex items-center justify-between flex-wrap gap-2">
                <div class="flex items-center gap-2">
                  <app-icon name="bar-chart-3" [size]="20" class="text-text-primary"></app-icon>
                  <h3 class="text-base font-bold text-text-primary">Uso de funciones IA</h3>
                </div>
                <span class="text-xs text-text-secondary">
                  {{ enabledCount() }} de {{ featuresList().length }} habilitadas
                </span>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                @for (feature of featuresList(); track feature.key) {
                  <div
                    class="p-4 rounded-xl border-2 space-y-3 transition-all hover:shadow-sm"
                    [class.bg-green-50/40]="feature.enabled"
                    [class.border-green-200]="feature.enabled"
                    [class.bg-gray-50]="!feature.enabled"
                    [class.border-gray-200]="!feature.enabled"
                    [class.opacity-60]="!feature.enabled"
                  >
                    <div class="flex items-start justify-between gap-2">
                      <div class="flex items-center gap-2 min-w-0">
                        <div
                          class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                          [class.bg-green-100]="feature.enabled"
                          [class.bg-gray-100]="!feature.enabled"
                        >
                          <app-icon
                            [name]="feature.icon"
                            [size]="18"
                            [class.text-green-600]="feature.enabled"
                            [class.text-gray-400]="!feature.enabled"
                          ></app-icon>
                        </div>
                        <div class="min-w-0">
                          <p
                            class="text-sm font-semibold truncate"
                            [class.text-text-primary]="feature.enabled"
                            [class.text-text-secondary]="!feature.enabled"
                          >
                            {{ feature.label }}
                          </p>
                          @if (feature.enabled && feature.limit !== null) {
                            <p class="text-[11px] text-text-secondary">
                              {{ feature.used }} / {{ feature.limit }} {{ feature.unit || '' }}
                            </p>
                          } @else if (feature.enabled) {
                            <p class="text-[11px] text-green-700 font-medium">Sin límite</p>
                          } @else {
                            <p class="text-[11px] text-text-secondary">No incluido</p>
                          }
                        </div>
                      </div>
                      <app-icon
                        [name]="feature.enabled ? 'check-circle' : 'lock'"
                        [size]="16"
                        [class.text-green-600]="feature.enabled"
                        [class.text-gray-400]="!feature.enabled"
                        class="shrink-0"
                      ></app-icon>
                    </div>

                    @if (feature.enabled && feature.limit !== null && feature.limit > 0) {
                      <div class="space-y-1">
                        <div class="w-full bg-white rounded-full h-1.5 overflow-hidden border border-gray-200">
                          <div
                            class="h-1.5 rounded-full transition-all"
                            [class.bg-green-500]="usagePercent(feature) < 70"
                            [class.bg-amber-500]="usagePercent(feature) >= 70 && usagePercent(feature) < 90"
                            [class.bg-red-500]="usagePercent(feature) >= 90"
                            [style.width.%]="usagePercent(feature)"
                          ></div>
                        </div>
                        <p class="text-[10px] text-text-secondary text-right font-medium">
                          {{ usagePercent(feature) | number:'1.0-0' }}%
                        </p>
                      </div>
                    }
                  </div>
                }
              </div>
            </div>
          </app-card>

          <!-- Opt-in link to manage renewal-enabled payment methods. Discreet by design:
               the canonical pay-now flow is the pending-invoice retry (Wompi
               widget) which enables the PM on success. This page only lets
               the user audit/remove methods enabled through Wompi. -->
          @if (showPaymentMethodsLink()) {
            <div class="flex justify-center pt-2">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-primary-600 transition-colors underline-offset-2 hover:underline"
                (click)="goToPaymentMethods()"
              >
                <app-icon name="credit-card" [size]="14"></app-icon>
                Ver métodos de pago para renovaciones automáticas
              </button>
            </div>
          }
        }

        <!-- Empty state — shown when there is no subscription row OR when
             the row is in no_plan state (RNC-39: additional stores of orgs
             that already consumed their trial). In both cases the user must
             pick a plan to operate the store. -->
        @if (!loading() && (!current() || isNoPlan())) {
          <app-empty-state
            icon="sparkles"
            iconColor="primary"
            title="Selecciona tu plan"
            [description]="isNoPlan()
              ? 'Tu organización ya consumió su período de prueba. Esta tienda necesita un plan activo para operar.'
              : 'Desbloquea funciones de IA, automatización y más eligiendo el plan ideal para tu negocio.'"
            actionButtonText="Ver Planes"
            actionButtonIcon="arrow-right"
            (actionClick)="goToPicker()"
          ></app-empty-state>
        }
      </div>

      <!-- Cancellation flow modal (wizard 3 pasos) -->
      <app-cancellation-flow-modal
        [(isOpen)]="cancelModalOpen"
        [planName]="planName()"
        [currentPeriodEnd]="cancellationPeriodEnd()"
        [loading]="loading()"
        (confirmed)="onCancellationConfirmed($event)"
        (closed)="onCancellationModalClosed()"
      ></app-cancellation-flow-modal>
    </div>
  `,
})
export class MySubscriptionComponent implements OnInit {
  private router = inject(Router);
  private facade = inject(SubscriptionFacade);
  private toastService = inject(ToastService);
  private subscriptionService = inject(StoreSubscriptionService);
  private wompiCheckoutService = inject(WompiCheckoutService);
  private accessService = inject(SubscriptionAccessService);
  private destroyRef = inject(DestroyRef);

  /**
   * Tracks the last subscription state that already triggered the paywall
   * modal during this lifecycle of the component. We rely on the access
   * service's own `isPaywallOpen` signal to dedupe concurrent opens, but we
   * also want to remember the state we already showed the modal for so we
   * don't reopen it after the user closes it manually for the same state.
   * On state change (e.g. payment confirmed → active) we reset, so the next
   * blocking state will surface a fresh modal.
   */
  private readonly lastStatePresented = signal<string | null>(null);

  /**
   * Tracks the previous status observed by the success-transition effect so
   * we can detect the `pending_payment → active` edge and trigger the
   * celebratory paywall microinteraction exactly once per transition.
   */
  private readonly previousStatus = signal<string | null>(null);

  /** Active timer id for the auto-dismiss of the success modal. */
  private successDismissTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Auto-open the paywall modal whenever the subscription enters a
    // blocking or informational state. The modal is informative — the user
    // can close it and continue browsing the panel in read-only mode — so
    // we only re-open when the state actually changes (not on every
    // re-entry to the page). This keeps the modal from spamming the user
    // who already closed it once.
    effect(() => {
      const state = this.status();
      if (!state) return;
      if (this.loading()) return;
      const variantKey = STATE_PAYWALL_MAP[state];
      if (!variantKey) {
        // active / trialing / unknown → no modal, reset memo
        this.lastStatePresented.set(null);
        return;
      }
      if (this.lastStatePresented() === state) return;
      const sub: any = this.current();
      this.accessService.openPaywallForState(state, {
        subscription_state: state,
        plan_id: sub?.plan_id ?? null,
        plan_name: sub?.plan_name ?? sub?.plan?.name ?? null,
        lock_reason: sub?.lock_reason ?? null,
        grace_period_end:
          sub?.grace_period_end ??
          sub?.current_period_end ??
          sub?.next_billing_at ??
          null,
      });
      this.lastStatePresented.set(state);
    });

    // Payment-success microinteraction. Detects the `pending_payment →
    // active` transition (driven by polling /sync-from-gateway) and shows a
    // brief celebratory paywall variant before auto-dismissing in 2.5s.
    // First-load with status === 'active' (no prior pending_payment seen)
    // does NOT trigger because previousStatus starts null.
    effect(() => {
      const current = this.status();
      // Read/write `previousStatus` outside the tracking context to avoid
      // a self-triggering loop — the effect should re-run only when
      // `status()` changes.
      const previous = untracked(() => this.previousStatus());
      if (
        current === 'active' &&
        previous === 'pending_payment'
      ) {
        const sub: any = untracked(() => this.current());
        const planName: string =
          sub?.plan_name ?? sub?.plan?.name ?? 'tu plan';
        this.accessService.openPaywallForPaymentSuccess(planName);
        // Clear any prior pending dismiss before scheduling a new one.
        if (this.successDismissTimer !== null) {
          clearTimeout(this.successDismissTimer);
        }
        this.successDismissTimer = setTimeout(() => {
          this.accessService.closePaywall();
          this.successDismissTimer = null;
        }, 2500);
      }
      // Always update at the end so the next run sees the latest value.
      untracked(() => this.previousStatus.set(current));
    });

    this.destroyRef.onDestroy(() => {
      if (this.successDismissTimer !== null) {
        clearTimeout(this.successDismissTimer);
        this.successDismissTimer = null;
      }
    });
  }

  /** Phase 4 — local UI state for the retry-payment CTA so the button can
   * surface a loading state while the backend mints a fresh widget config. */
  readonly retryingPayment = signal(false);

  /** RNC-PaidPlan — UI state para los CTAs del panel de cambio pendiente. */
  readonly retryingPendingChange = signal(false);
  readonly cancellingPendingChange = signal(false);

  /**
   * RNC-PaidPlan — Tracks whether the most recent Wompi widget session
   * produced a terminal payment outcome (APPROVED or PENDING). Used by the
   * `onClosed` handler to decide whether the user truly abandoned the
   * payment — in which case the pending change is wiped server-side.
   */
  private readonly paymentSucceeded = signal(false);

  readonly current = this.facade.current;
  readonly loading = this.facade.loading;
  readonly status = this.facade.status;
  readonly featureMatrix = this.facade.featureMatrix;
  readonly isActive = this.facade.isActive;
  readonly isTrial = this.facade.isTrial;
  /** RNC-PaidPlan — Unified UI state, see SubscriptionFacade.subscriptionUiState. */
  readonly uiState = this.facade.subscriptionUiState;

  /** Banner label helpers — narrow the discriminated union for the template. */
  readonly pendingPlanLabel = computed(() => {
    const ui = this.uiState();
    return ui.kind === 'pending_initial_payment' ? ui.planName : '';
  });
  readonly pendingChangeFromLabel = computed(() => {
    const ui = this.uiState();
    return ui.kind === 'pending_change_abandoned' ? ui.fromPlanName : '';
  });
  readonly pendingChangeToLabel = computed(() => {
    const ui = this.uiState();
    return ui.kind === 'pending_change_abandoned' ? ui.toPlanName : '';
  });

  readonly activeGradient =
    'linear-gradient(135deg, #7ED7A5 0%, #2F6F4E 60%, #1f4f37 100%)';
  readonly trialGradient =
    'linear-gradient(135deg, #fbbf24 0%, #d97706 60%, #92400e 100%)';
  // Red gradient for terminal states (cancelled / expired) — signals to the
  // user that the subscription is no longer providing access.
  readonly cancelledGradient =
    'linear-gradient(135deg, #f87171 0%, #b91c1c 60%, #7f1d1d 100%)';
  readonly graceGradient =
    'linear-gradient(135deg, #fb923c 0%, #ea580c 60%, #9a3412 100%)';
  readonly unavailableGradient =
    'linear-gradient(135deg, #f97316 0%, #dc2626 62%, #7f1d1d 100%)';

  readonly currentPlanUnavailable = computed(() => {
    const sub: any = this.current();
    const plan = sub?.plan ?? sub?.paid_plan;
    return !!plan && (plan.archived_at != null || plan.state !== 'active');
  });

  readonly isGrace = computed(() => {
    const s = this.status();
    return s === 'grace_soft' || s === 'grace_hard';
  });

  readonly graceDaysOverdue = computed(() => {
    const sub: any = this.current();
    if (!sub) return 0;
    const periodEnd = sub.current_period_end;
    if (!periodEnd) return 0;
    const diff = Date.now() - new Date(periodEnd).getTime();
    return Math.max(0, Math.ceil(diff / this.DAY_MS));
  });

  readonly isTerminal = computed(() => {
    const s = this.status();
    return s === 'cancelled' || s === 'expired';
  });

  readonly isSuspendedOrBlocked = computed(() => {
    const s = this.status();
    return s === 'suspended' || s === 'blocked';
  });

  /**
   * RNC-39 — Subscription row exists but the store has no active plan.
   * Common case: additional stores of organizations that already consumed
   * their trial. The hero card / quick stats / feature usage UI must NOT
   * render plan info (because the persisted `plan_id` is a placeholder
   * reference, not a plan the user actually has). Empty-state takes over.
   */
  readonly isNoPlan = computed(() => this.status() === 'no_plan');

  // Surfaces backend's `scheduled_cancel_at` so the user retains a persistent
  // visual reminder that they triggered an end-of-cycle cancel — the toast
  // only flashes once. Only relevant while the plan is still in a non-terminal
  // state (active/trial); after the actual cancel happens the banner takes over.
  readonly scheduledCancelAt = computed<string | null>(() => {
    const sub: any = this.current();
    if (!sub) return null;
    if (this.isTerminal()) return null;
    return sub.scheduled_cancel_at ?? null;
  });

  readonly heroGradient = computed(() => {
    if (this.isTerminal()) return this.cancelledGradient;
    if (this.isSuspendedOrBlocked()) return this.cancelledGradient;
    if (this.currentPlanUnavailable()) return this.unavailableGradient;
    if (this.isGrace()) return this.graceGradient;
    if (this.isTrial()) return this.trialGradient;
    return this.activeGradient;
  });

  readonly planName = computed(() => {
    if (this.isNoPlan()) return 'Sin Plan';
    const sub: any = this.current();
    return sub?.plan_name ?? sub?.plan?.name ?? 'Sin Plan';
  });

  // `billing_cycle` lives on the related plan, not on the subscription row
  // itself. Read both shapes so older mappers and direct Prisma includes work.
  // Normalize 'annual' → 'yearly' so downstream checks have a single canonical
  // value; backend enum exposes 'annual' but the rest of the codebase (DTOs,
  // proration, plans listing) standardizes on 'yearly'.
  private readonly billingCycle = computed<string | undefined>(() => {
    const sub: any = this.current();
    const raw = sub?.billing_cycle ?? sub?.plan?.billing_cycle ?? sub?.paid_plan?.billing_cycle;
    return raw === 'annual' ? 'yearly' : raw;
  });

  readonly cycleSuffix = computed(() => {
    return this.billingCycle() === 'yearly' ? 'año' : 'mes';
  });

  readonly cycleLabel = computed(() => {
    return this.billingCycle() === 'yearly' ? 'Anual' : 'Mensual';
  });

  readonly daysRemaining = computed(() => {
    const trialEnd = this.current()?.trial_ends_at;
    if (!trialEnd) return 0;
    const diff = new Date(trialEnd).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  });

  // Single source of truth for "next billing date": `current_period_end`.
  // The `next_billing_at` column drifts whenever plan changes happen
  // mid-cycle (it's recalculated only on confirmed payments), and using it
  // produced a card showing "365 días restantes" while the cycle bar showed
  // "20 días" — same concept, two different timestamps. Reading from
  // `current_period_end` ties this card to the same field that drives the
  // cycle progress bar and proration math.
  readonly nextBillingAt = computed(
    () => this.current()?.current_period_end ?? null,
  );

  readonly daysToNextBilling = computed(() => {
    return Math.max(0, this.cycleTotalDays() - this.cycleDaysConsumed());
  });

  readonly cycleIsOverdue = computed(() => {
    const end = this.current()?.current_period_end;
    return !!end && new Date(end).getTime() <= Date.now();
  });

  readonly cycleOverdueLabel = computed(() => {
    const end = this.current()?.current_period_end;
    if (!end) return '0 h';
    const diffMs = Math.max(0, Date.now() - new Date(end).getTime());
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    if (hours < 1) return 'menos de 1 h';
    if (hours < 24) return `${hours} h`;
    const days = Math.floor(hours / 24);
    const extraHours = hours % 24;
    const dayLabel = `${days} día${days === 1 ? '' : 's'}`;
    return extraHours > 0 ? `${dayLabel} ${extraHours} h` : dayLabel;
  });

  readonly nextBillingHelperText = computed(() => {
    if (this.cycleIsOverdue()) {
      return `Vencido hace ${this.cycleOverdueLabel()}`;
    }
    return `${this.daysToNextBilling()} días restantes`;
  });

  readonly trialProgress = computed(() => {
    const trialEnd = this.current()?.trial_ends_at;
    const periodStart = this.current()?.current_period_start;
    if (!trialEnd || !periodStart) return 0;
    const total = new Date(trialEnd).getTime() - new Date(periodStart).getTime();
    const elapsed = Date.now() - new Date(periodStart).getTime();
    return Math.min(100, Math.max(0, (elapsed / total) * 100));
  });

  // Cycle consumption — derivado de la ventana real (current_period_start →
  // current_period_end). Antes se hardcodeaba 30/365 según billing_cycle, lo
  // que rompía el cálculo cuando proration o swaps trial→free dejaban
  // current_period_end fuera del rango contractual. Fallback al ciclo
  // contractual solo si faltan los timestamps.
  private readonly DAY_MS = 1000 * 60 * 60 * 24;

  readonly cycleTotalDays = computed(() => {
    const start = this.current()?.current_period_start;
    const end = this.current()?.current_period_end;
    if (start && end) {
      const ms = new Date(end).getTime() - new Date(start).getTime();
      const days = Math.round(ms / this.DAY_MS);
      if (days > 0) return days;
    }
    const cycle = this.billingCycle();
    if (cycle === 'yearly') return 365;
    if (cycle === 'monthly') return 30;
    return 0;
  });

  readonly cycleDaysConsumed = computed(() => {
    const total = this.cycleTotalDays();
    const start = this.current()?.current_period_start;
    if (!total || !start) return 0;
    const elapsedMs = Date.now() - new Date(start).getTime();
    const elapsed = Math.floor(elapsedMs / this.DAY_MS);
    return Math.min(total, Math.max(0, elapsed));
  });

  // Continuous percentage in ms over la ventana real del periodo
  // (current_period_start → current_period_end). Esto evita que proration o
  // estados inconsistentes empujen current_period_end fuera del rango
  // contractual y dejen la barra en 0%.
  readonly cycleProgress = computed(() => {
    const total = this.cycleTotalDays();
    const start = this.current()?.current_period_start;
    if (!total || !start) return 0;
    const totalMs = total * this.DAY_MS;
    const elapsedMs = Date.now() - new Date(start).getTime();
    return Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100));
  });

  // Color tier — driven by % to behave correctly for short cycles too. The
  // 7-day rule kicks in only when the cycle itself is at least 14 days long,
  // so a 5-day test cycle does not get pinned to critical from day 0.
  readonly cycleProgressTier = computed<'fresh' | 'warn' | 'critical'>(() => {
    const progress = this.cycleProgress();
    if (progress >= 90) return 'critical';
    if (progress >= 75) return 'warn';
    const total = this.cycleTotalDays();
    if (total >= 14 && total - this.cycleDaysConsumed() <= 7) return 'critical';
    return 'fresh';
  });

  readonly featuresList = computed(() => {
    const matrix = this.featureMatrix();
    const featureMeta: Record<string, { label: string; icon: string }> = {
      text_generation: { label: 'Generación de Texto', icon: 'pen-line' },
      streaming_chat: { label: 'Chat en Streaming', icon: 'message-square' },
      conversations: { label: 'Conversaciones', icon: 'message-circle' },
      tool_agents: { label: 'Agentes con Herramientas', icon: 'bot' },
      rag_embeddings: { label: 'RAG / Embeddings', icon: 'database' },
      async_queue: { label: 'Procesamiento Asíncrono', icon: 'layers' },
    };
    return Object.entries(featureMeta).map(([key, meta]) => {
      const feature = matrix?.[key];
      const enabled = feature?.enabled === true;
      return {
        key,
        label: meta.label,
        icon: meta.icon,
        enabled,
        used: feature?.used ?? 0,
        limit: enabled
          ? (feature.monthly_tokens_cap ??
              feature.daily_messages_cap ??
              feature.indexed_docs_cap ??
              feature.monthly_jobs_cap ??
              null)
          : null,
        unit: enabled && feature?.monthly_tokens_cap
          ? 'tokens'
          : enabled && feature?.daily_messages_cap
            ? 'msgs'
            : enabled && feature?.indexed_docs_cap
              ? 'docs'
              : enabled && feature?.monthly_jobs_cap
                ? 'jobs'
                : null,
      };
    });
  });

  readonly enabledCount = computed(() => this.featuresList().filter((f) => f.enabled).length);

  readonly featureCoverage = computed(() => {
    const total = this.featuresList().length;
    if (!total) return 0;
    return (this.enabledCount() / total) * 100;
  });

  // ─── Sticky header bindings ────────────────────────────────────────────────

  readonly headerSubtitle = computed(() => {
    if (this.loading()) return 'Cargando información...';
    if (!this.current() || this.isNoPlan())
      return 'Selecciona un plan para activar esta tienda';
    if (this.currentPlanUnavailable()) return 'Tu plan actual ya no está disponible';
    if (this.isTrial()) return `${this.daysRemaining()} días de prueba restantes`;
    return 'Plan activo y uso de funciones IA';
  });

  readonly headerIcon = computed(() => {
    if (this.isNoPlan()) return 'sparkles';
    if (this.currentPlanUnavailable()) return 'alert-triangle';
    if (this.isTrial()) return 'hourglass';
    if (this.isActive()) return 'crown';
    return 'sparkles';
  });

  readonly badgeLabel = computed(() => {
    if (!this.current()) return '';
    return this.getStatusLabel();
  });

  readonly needsAttention = computed(() => {
    const s = this.status();
    if (this.currentPlanUnavailable()) return true;
    return (
      this.isTrial() ||
      s === 'past_due' ||
      s === 'pending_payment' ||
      s === 'grace_soft' ||
      s === 'grace_hard' ||
      s === 'suspended' ||
      s === 'blocked' ||
      s === 'cancelled' ||
      s === 'expired'
    );
  });

  readonly badgeColor = computed<StickyHeaderBadgeColor>(() => {
    const s = this.status();
    if (this.currentPlanUnavailable()) return 'red';
    if (s === 'active') return 'green';
    if (s === 'trial' || s === 'trialing') return 'yellow';
    if (
      s === 'past_due' ||
      s === 'pending_payment' ||
      s === 'grace_soft' ||
      s === 'grace_hard'
    )
      return 'yellow';
    if (
      s === 'cancelled' ||
      s === 'expired' ||
      s === 'blocked' ||
      s === 'suspended'
    )
      return 'red';
    if (s === 'no_plan') return 'gray';
    return 'gray';
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    // RNC-39 — `no_plan` is functionally the same as "no subscription" from
    // the user's perspective: only action is to pick a plan. Routes to the
    // soft picker instead of the plan catalog.
    if (!this.current() || this.isNoPlan()) {
      return [
        { id: 'picker', label: 'Ver Planes', variant: 'primary', icon: 'arrow-right' },
      ];
    }
    const status = this.status();
    const isTerminal = status === 'cancelled' || status === 'expired';

    // Terminal lifecycle: only allow re-subscribing + reading audit trail.
    // Hide "Cancelar" (already cancelled) and "Cambiar Plan" (proration on a
    // dead subscription is meaningless — checkout treats it as a fresh
    // purchase via Path D).
    if (isTerminal) {
      return [
        { id: 'history', label: 'Facturas', variant: 'outline', icon: 'file-text' },
        { id: 'timeline', label: 'Historial', variant: 'outline', icon: 'history' },
        { id: 'plans', label: 'Reactivar suscripción', variant: 'primary', icon: 'refresh-cw' },
      ];
    }

    const list: StickyHeaderActionButton[] = [];
    if (this.isActive()) {
      list.push({
        id: 'cancel',
        label: 'Cancelar',
        variant: 'outline-danger',
        icon: 'x-circle',
      });
    }
    list.push(
      { id: 'history', label: 'Facturas', variant: 'outline', icon: 'file-text' },
      { id: 'timeline', label: 'Historial', variant: 'outline', icon: 'history' },
      { id: 'change', label: 'Cambiar Plan', variant: 'primary', icon: 'refresh-cw' },
    );
    return list;
  });

  // ─── Cancel confirmation modal (wizard) ────────────────────────────────────

  readonly cancelModalOpen = signal(false);

  /** Fecha de fin del periodo actual, expuesta al wizard de cancelación. */
  readonly cancellationPeriodEnd = computed(
    () => this.current()?.current_period_end ?? this.current()?.next_billing_at ?? null,
  );

  ngOnInit(): void {
    this.facade.loadCurrent();
    this.facade.loadAccess();
  }

  usagePercent(feature: { used: number; limit: number | null }): number {
    if (!feature.limit || feature.limit <= 0) return 0;
    return Math.min(100, Math.max(0, (feature.used / feature.limit) * 100));
  }

  onHeaderAction(id: string): void {
    switch (id) {
      case 'picker':
        this.goToPicker();
        break;
      case 'plans':
      case 'change':
        this.goToPlans();
        break;
      case 'history':
        this.goToHistory();
        break;
      case 'timeline':
        this.goToTimeline();
        break;
      case 'cancel':
        this.cancelSubscription();
        break;
    }
  }

  goToPlans(): void {
    this.router.navigate(['/admin/subscription/plans']);
  }

  /** RNC-39 — Navigate to the soft picker for stores in `no_plan`. */
  goToPicker(): void {
    this.router.navigate(['/admin/subscription/picker']);
  }

  /**
   * Phase 4 — Retry the pending invoice. Calls the idempotent backend
   * endpoint to mint a fresh Wompi widget config and re-opens the widget.
   * Same callback handling as the initial checkout: loadCurrent + polling
   * on success/pending, error toast on failure.
   */
  retryPayment(): void {
    if (this.retryingPayment()) return;
    this.retryingPayment.set(true);
    const returnUrl = `${window.location.origin}/admin/subscription`;
    this.subscriptionService
      .retryPayment({ returnUrl })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.retryingPayment.set(false);
          // Pull-fallback: Wompi retry-payment response carries the invoice
          // id whose pending payment we are re-charging, so the polling
          // loop can call /sync-from-gateway each cycle.
          const invoiceId =
            typeof data?.invoice?.id === 'number' ? data.invoice.id : null;
          this.paymentSucceeded.set(false);
          this.wompiCheckoutService.openWidget(data.widget, {
            onApproved: () => {
              this.paymentSucceeded.set(true);
              this.facade.loadCurrent();
              this.facade.pollSubscriptionUntilActive({ invoiceId });
              this.toastService.info('Verificando confirmación de pago…');
            },
            onDeclined: () => {
              this.facade.loadCurrent();
              this.toastService.error(
                'El pago fue rechazado. Intenta con otro método de pago.',
              );
            },
            onPending: () => {
              this.paymentSucceeded.set(true);
              this.facade.loadCurrent();
              this.facade.pollSubscriptionUntilActive({ invoiceId });
              this.toastService.info(
                'Pago pendiente de confirmación. Verificando…',
              );
            },
            onClosed: () => {
              if (this.paymentSucceeded()) {
                this.facade.loadCurrent();
                return;
              }
              this.subscriptionService
                .cancelPendingChange()
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
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
              this.facade.loadCurrent();
              this.toastService.error(
                'No se pudo abrir el widget de pago. Intenta de nuevo.',
              );
            },
          });
        },
        error: (err) => {
          this.retryingPayment.set(false);
          // Backend may have already resolved the invoice asynchronously
          // (SUBSCRIPTION_010 / DUNNING_001) — refresh state so the banner
          // disappears if so.
          this.facade.loadCurrent();
          this.toastService.error(extractApiErrorMessage(err));
        },
      });
  }

  /**
   * RNC-PaidPlan — Reintenta el pago del cambio de plan pendiente.
   * Usa el mismo endpoint de retry-payment que el pending_payment banner,
   * ya que backend asocia el invoice al pending_change_invoice_id.
   */
  retryPendingChange(): void {
    if (this.retryingPendingChange()) return;
    this.retryingPendingChange.set(true);
    const returnUrl = `${window.location.origin}/admin/subscription`;
    this.subscriptionService
      .retryPayment({ returnUrl })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.retryingPendingChange.set(false);
          const invoiceId =
            typeof data?.invoice?.id === 'number' ? data.invoice.id : null;
          this.paymentSucceeded.set(false);
          this.wompiCheckoutService.openWidget(data.widget, {
            onApproved: () => {
              this.paymentSucceeded.set(true);
              this.facade.loadCurrent();
              this.facade.pollSubscriptionUntilActive({ invoiceId });
              this.toastService.info('Verificando confirmación de pago…');
            },
            onDeclined: () => {
              this.facade.loadCurrent();
              this.toastService.error(
                'El pago fue rechazado. Intenta con otro método de pago.',
              );
            },
            onPending: () => {
              this.paymentSucceeded.set(true);
              this.facade.loadCurrent();
              this.facade.pollSubscriptionUntilActive({ invoiceId });
              this.toastService.info(
                'Pago pendiente de confirmación. Verificando…',
              );
            },
            onClosed: () => {
              if (this.paymentSucceeded()) {
                this.facade.loadCurrent();
                return;
              }
              this.subscriptionService
                .cancelPendingChange()
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
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
              this.facade.loadCurrent();
              this.toastService.error(
                'No se pudo abrir el widget de pago. Intenta de nuevo.',
              );
            },
          });
        },
        error: (err) => {
          this.retryingPendingChange.set(false);
          this.facade.loadCurrent();
          this.toastService.error(extractApiErrorMessage(err));
        },
      });
  }

  /**
   * RNC-PaidPlan — Cancela el cambio de plan pendiente.
   * Anula el pending_plan_id y el invoice asociado en el backend.
   */
  cancelPendingChange(): void {
    if (this.cancellingPendingChange()) return;
    this.cancellingPendingChange.set(true);
    this.subscriptionService
      .cancelPendingChange()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.cancellingPendingChange.set(false);
          this.facade.loadCurrent();
          this.toastService.success('Cambio de plan cancelado. Continúas con tu plan actual.');
        },
        error: (err) => {
          this.cancellingPendingChange.set(false);
          this.toastService.error(extractApiErrorMessage(err));
        },
      });
  }

  goToHistory(): void {
    this.router.navigate(['/admin/subscription/history']);
  }

  /**
   * Opt-in navigation to the read-only payment-methods page. Only relevant
   * when the user has (or recently had) an active/trial/past_due plan that
   * actually saves cards on file. In `no_plan`/terminal states there is
   * nothing meaningful to manage there, so we hide the entry.
   */
  readonly showPaymentMethodsLink = computed(() => {
    if (this.isNoPlan()) return false;
    if (this.isTerminal()) return false;
    if (!this.current()) return false;
    return true;
  });

  goToPaymentMethods(): void {
    this.router.navigate(['/admin/subscription/payment']);
  }

  goToTimeline(): void {
    this.router.navigate(['/admin/subscription/timeline']);
  }

  goToDunning(): void {
    this.router.navigate(['/admin/subscription/dunning']);
  }

  cancelSubscription(): void {
    this.cancelModalOpen.set(true);
  }

  onCancellationModalClosed(): void {
    this.cancelModalOpen.set(false);
  }

  onCancellationConfirmed(payload: CancellationConfirmedPayload): void {
    if (payload.immediate) {
      this.facade.cancel(payload.reason);
      this.toastService.success('Suscripción cancelada');
    } else {
      this.facade.scheduleCancel(payload.reason);
      this.toastService.success('Cancelación programada al final del ciclo');
    }
    this.cancelModalOpen.set(false);
  }

  getStatusLabel(): string {
    // RNC-PaidPlan — `pending_change_abandoned` keeps the paid plan active;
    // the canonical label is "Activa". This override ensures the badge does
    // not flip to "Pago Pendiente" while the user still holds their plan.
    if (this.uiState().kind === 'pending_change_abandoned') {
      return 'Activa';
    }
    const labels: Record<string, string> = {
      active: 'Activa',
      trialing: 'En Prueba',
      trial: 'En Prueba',
      past_due: 'Vencida',
      pending_payment: 'Pago Pendiente',
      cancelled: 'Cancelada',
      expired: 'Expirada',
      blocked: 'Bloqueada',
      suspended: 'Suspendida',
      grace_soft: 'En Gracia',
      grace_hard: 'Gracia Final',
      draft: 'Borrador',
      no_plan: 'Sin Plan',
      none: 'Sin Plan',
    };
    return labels[this.status()] || this.status();
  }
}
