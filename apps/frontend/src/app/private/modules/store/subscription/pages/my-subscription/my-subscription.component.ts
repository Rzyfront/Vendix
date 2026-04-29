import { Component, OnInit, inject, computed, signal } from '@angular/core';
import { DatePipe, CurrencyPipe, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import {
  CardComponent,
  IconComponent,
  EmptyStateComponent,
  StickyHeaderComponent,
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
  ToastService,
} from '../../../../../../shared/components/index';
import { SubscriptionFacade } from '../../../../../../core/store/subscription/subscription.facade';
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
        @if (!loading() && current()) {
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
                    [name]="isTerminal() ? 'alert-octagon' : (isTrial() ? 'hourglass' : 'sparkles')"
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
                  {{ getStatusLabel() }}
                </span>
              </div>

              <!-- Price -->
              <div class="flex items-baseline gap-2 pt-1">
                <span class="text-4xl md:text-5xl font-extrabold tracking-tight">
                  {{ (current()?.effective_price || 0) | currency }}
                </span>
                <span class="text-base text-white/80 font-medium">/{{ cycleSuffix() }}</span>
              </div>

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

              <!-- Metadata chips -->
              <div class="flex flex-wrap gap-2 pt-3 border-t border-white/20">
                @if (current()?.next_billing_at && !scheduledCancelAt()) {
                  <div class="inline-flex items-center gap-2 bg-white/10 backdrop-blur px-3 py-1.5 rounded-lg border border-white/20">
                    <app-icon name="calendar" [size]="14" class="text-white/90"></app-icon>
                    <span class="text-xs text-white/90">
                      Próximo cobro: <span class="font-semibold">{{ current()?.next_billing_at | date:'mediumDate' }}</span>
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
          <div class="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-3 snap-x snap-mandatory">
            <!-- Trial card (only when trial) -->
            @if (isTrial() && current()?.trial_ends_at) {
              <app-card customClasses="border-l-4 border-amber-500 min-w-[260px] sm:min-w-0 snap-start">
                <div class="p-4 space-y-3">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <div class="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                        <app-icon name="hourglass" [size]="16" class="text-amber-600"></app-icon>
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
                  <div class="w-full bg-amber-100 rounded-full h-2 overflow-hidden">
                    <div
                      class="h-2 rounded-full transition-all bg-gradient-to-r from-amber-400 to-amber-600"
                      [style.width.%]="trialProgress()"
                    ></div>
                  </div>
                </div>
              </app-card>
            }

            <!-- Features active -->
            <app-card customClasses="min-w-[260px] sm:min-w-0 snap-start">
              <div class="p-4 space-y-3">
                <div class="flex items-center gap-2">
                  <div class="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center">
                    <app-icon name="sparkles" [size]="16" class="text-primary-600"></app-icon>
                  </div>
                  <span class="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
                    Funciones IA
                  </span>
                </div>
                <div class="flex items-baseline gap-1.5">
                  <p class="text-3xl font-extrabold text-primary-600 leading-none">{{ enabledCount() }}</p>
                  <p class="text-xs text-text-secondary">de {{ featuresList().length }} activas</p>
                </div>
                <div class="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div
                    class="h-2 rounded-full transition-all bg-gradient-to-r from-primary-400 to-primary-600"
                    [style.width.%]="featureCoverage()"
                  ></div>
                </div>
              </div>
            </app-card>

            <!-- Next billing card -->
            @if (current()?.next_billing_at; as next) {
              <app-card customClasses="min-w-[260px] sm:min-w-0 snap-start">
                <div class="p-4 space-y-3">
                  <div class="flex items-center gap-2">
                    <div class="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                      <app-icon name="calendar" [size]="16" class="text-blue-600"></app-icon>
                    </div>
                    <span class="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
                      Próximo cobro
                    </span>
                  </div>
                  <div>
                    <p class="text-base font-bold text-text-primary leading-tight">
                      {{ next | date:'mediumDate' }}
                    </p>
                    <p class="text-xs text-text-secondary mt-0.5">
                      {{ daysToNextBilling() }} días restantes
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
            @if (!isTrial() && !current()?.next_billing_at) {
              <app-card customClasses="min-w-[260px] sm:min-w-0 snap-start">
                <div class="p-4 space-y-3">
                  <div class="flex items-center gap-2">
                    <div class="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                      <app-icon name="check-circle" [size]="16" class="text-green-600"></app-icon>
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
        }

        <!-- Empty state -->
        @if (!loading() && !current()) {
          <app-empty-state
            icon="sparkles"
            iconColor="primary"
            title="Activa tu suscripción"
            description="Desbloquea funciones de IA, automatización y más eligiendo el plan ideal para tu negocio."
            actionButtonText="Ver Planes"
            actionButtonIcon="arrow-right"
            (actionClick)="goToPlans()"
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

  readonly current = this.facade.current;
  readonly loading = this.facade.loading;
  readonly status = this.facade.status;
  readonly featureMatrix = this.facade.featureMatrix;
  readonly isActive = this.facade.isActive;
  readonly isTrial = this.facade.isTrial;

  readonly activeGradient =
    'linear-gradient(135deg, #7ED7A5 0%, #2F6F4E 60%, #1f4f37 100%)';
  readonly trialGradient =
    'linear-gradient(135deg, #fbbf24 0%, #d97706 60%, #92400e 100%)';
  // Red gradient for terminal states (cancelled / expired) — signals to the
  // user that the subscription is no longer providing access.
  readonly cancelledGradient =
    'linear-gradient(135deg, #f87171 0%, #b91c1c 60%, #7f1d1d 100%)';

  readonly isTerminal = computed(() => {
    const s = this.status();
    return s === 'cancelled' || s === 'expired';
  });

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
    if (this.isTrial()) return this.trialGradient;
    return this.activeGradient;
  });

  readonly planName = computed(() => {
    const sub: any = this.current();
    return sub?.plan_name ?? sub?.plan?.name ?? 'Sin Plan';
  });

  readonly cycleSuffix = computed(() => {
    const cycle = this.current()?.billing_cycle;
    return cycle === 'yearly' ? 'año' : 'mes';
  });

  readonly cycleLabel = computed(() => {
    const cycle = this.current()?.billing_cycle;
    return cycle === 'yearly' ? 'Anual' : 'Mensual';
  });

  readonly daysRemaining = computed(() => {
    const trialEnd = this.current()?.trial_ends_at;
    if (!trialEnd) return 0;
    const diff = new Date(trialEnd).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  });

  readonly daysToNextBilling = computed(() => {
    const next = this.current()?.next_billing_at;
    if (!next) return 0;
    const diff = new Date(next).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  });

  readonly trialProgress = computed(() => {
    const trialEnd = this.current()?.trial_ends_at;
    const periodStart = this.current()?.current_period_start;
    if (!trialEnd || !periodStart) return 0;
    const total = new Date(trialEnd).getTime() - new Date(periodStart).getTime();
    const elapsed = Date.now() - new Date(periodStart).getTime();
    return Math.min(100, Math.max(0, (elapsed / total) * 100));
  });

  readonly featuresList = computed(() => {
    const matrix = this.featureMatrix();
    if (!matrix || typeof matrix !== 'object') return [];
    const featureMeta: Record<string, { label: string; icon: string }> = {
      text_generation: { label: 'Generación de Texto', icon: 'pen-line' },
      streaming_chat: { label: 'Chat en Streaming', icon: 'message-square' },
      conversations: { label: 'Conversaciones', icon: 'message-circle' },
      tool_agents: { label: 'Agentes con Herramientas', icon: 'bot' },
      rag_embeddings: { label: 'RAG / Embeddings', icon: 'database' },
      async_queue: { label: 'Procesamiento Asíncrono', icon: 'layers' },
    };
    return Object.entries(matrix).map(([key, feature]: [string, any]) => {
      const meta = featureMeta[key] || { label: key, icon: 'sparkles' };
      return {
        key,
        label: meta.label,
        icon: meta.icon,
        enabled: feature.enabled === true,
        used: feature.used ?? 0,
        limit:
          feature.monthly_tokens_cap ??
          feature.daily_messages_cap ??
          feature.indexed_docs_cap ??
          feature.monthly_jobs_cap ??
          null,
        unit: feature.monthly_tokens_cap
          ? 'tokens'
          : feature.daily_messages_cap
            ? 'msgs'
            : feature.indexed_docs_cap
              ? 'docs'
              : feature.monthly_jobs_cap
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
    if (!this.current()) return 'Activa tu plan para desbloquear funciones';
    if (this.isTrial()) return `${this.daysRemaining()} días de prueba restantes`;
    return 'Plan activo y uso de funciones IA';
  });

  readonly headerIcon = computed(() => {
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
    return (
      this.isTrial() ||
      s === 'past_due' ||
      s === 'pending_payment' ||
      s === 'grace_soft' ||
      s === 'grace_hard'
    );
  });

  readonly badgeColor = computed<StickyHeaderBadgeColor>(() => {
    const s = this.status();
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
    return 'gray';
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    if (!this.current()) {
      return [
        { id: 'plans', label: 'Ver Planes', variant: 'primary', icon: 'arrow-right' },
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

  goToHistory(): void {
    this.router.navigate(['/admin/subscription/history']);
  }

  goToTimeline(): void {
    this.router.navigate(['/admin/subscription/timeline']);
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
      none: 'Sin Plan',
    };
    return labels[this.status()] || this.status();
  }
}
