import { Component, OnInit, inject, computed } from '@angular/core';
import { DatePipe, CurrencyPipe } from '@angular/common';
import { Router } from '@angular/router';
import {
  CardComponent,
  ButtonComponent,
  IconComponent,
  EmptyStateComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { SubscriptionFacade } from '../../../../../../core/store/subscription/subscription.facade';

@Component({
  selector: 'app-my-subscription',
  standalone: true,
  imports: [CardComponent, ButtonComponent, IconComponent, EmptyStateComponent, DatePipe, CurrencyPipe],
  template: `
    <div class="w-full max-w-6xl mx-auto px-4 py-6 lg:py-8 space-y-6">
      <!-- Loading -->
      @if (loading()) {
        <div class="space-y-4 animate-pulse" aria-busy="true">
          <div class="h-40 bg-gray-200 rounded-2xl"></div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="h-32 bg-gray-200 rounded-xl"></div>
            <div class="h-32 bg-gray-200 rounded-xl"></div>
          </div>
        </div>
      }

      <!-- Active subscription -->
      @if (!loading() && current()) {
        <!-- Hero Card -->
        <div
          class="relative overflow-hidden rounded-2xl shadow-xl text-white p-6 md:p-8"
          [style.background]="isTrial() ? trialGradient : activeGradient"
        >
          <app-icon
            name="crown"
            [size]="120"
            class="absolute -top-4 -right-4 text-white opacity-15 pointer-events-none"
          ></app-icon>

          <div class="relative space-y-4">
            <div class="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p class="text-xs uppercase tracking-wide text-white/80 font-semibold mb-1">Mi plan actual</p>
                <h2 class="text-3xl md:text-4xl font-extrabold leading-tight">
                  {{ planName() }}
                </h2>
              </div>
              <span class="inline-flex items-center bg-white/20 backdrop-blur border border-white/30 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide">
                {{ getStatusLabel() }}
              </span>
            </div>

            <div class="flex items-baseline gap-2">
              <span class="text-2xl md:text-3xl font-bold">
                {{ (current()?.effective_price || 0) | currency }}
              </span>
              <span class="text-sm text-white/80">/{{ cycleSuffix() }}</span>
            </div>

            @if (current()?.next_billing_at; as next) {
              <div class="flex items-center gap-2 pt-2 border-t border-white/20">
                <app-icon name="calendar" [size]="16" class="text-white/90"></app-icon>
                <p class="text-sm text-white/90">
                  Próximo cobro: <span class="font-semibold">{{ next | date:'mediumDate' }}</span>
                </p>
              </div>
            }
          </div>
        </div>

        <!-- Secondary cards grid -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Trial card -->
          @if (isTrial() && current()?.trial_ends_at) {
            <app-card customClasses="border-l-4 border-amber-500">
              <div class="p-5 space-y-4">
                <div class="flex items-center gap-2">
                  <app-icon name="hourglass" [size]="20" class="text-amber-600"></app-icon>
                  <h3 class="text-sm font-semibold text-text-secondary uppercase tracking-wide">Período de Prueba</h3>
                </div>
                <div>
                  <p class="text-4xl font-extrabold text-amber-600">{{ daysRemaining() }}</p>
                  <p class="text-sm text-text-secondary">días restantes</p>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div
                    class="h-3 rounded-full transition-all bg-gradient-to-r from-amber-400 to-amber-600"
                    [style.width.%]="trialProgress()"
                  ></div>
                </div>
                <app-button variant="primary" size="sm" (clicked)="goToPlans()">
                  <app-icon name="arrow-up-circle" [size]="16" slot="icon"></app-icon>
                  Convertir a plan pago
                </app-button>
              </div>
            </app-card>
          }

          <!-- Feature summary -->
          <app-card>
            <div class="p-5 space-y-3">
              <div class="flex items-center gap-2">
                <app-icon name="sparkles" [size]="20" class="text-primary-600"></app-icon>
                <h3 class="text-sm font-semibold text-text-secondary uppercase tracking-wide">Funciones IA</h3>
              </div>
              <div class="flex items-baseline gap-2">
                <p class="text-4xl font-extrabold text-primary-600">{{ enabledCount() }}</p>
                <p class="text-sm text-text-secondary">de {{ featuresList().length }} activas</p>
              </div>
              <p class="text-xs text-text-secondary">
                Detalle por función debajo.
              </p>
            </div>
          </app-card>
        </div>

        <!-- Feature usage detail -->
        <app-card>
          <div class="p-5 md:p-6 space-y-4">
            <h3 class="text-sm font-semibold text-text-secondary uppercase tracking-wide">Uso de funciones IA</h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              @for (feature of featuresList(); track feature.key) {
                <div
                  class="p-3 rounded-lg border space-y-2"
                  [class.bg-green-50]="feature.enabled"
                  [class.border-green-200]="feature.enabled"
                  [class.bg-gray-50]="!feature.enabled"
                  [class.border-border]="!feature.enabled"
                >
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 min-w-0">
                      <app-icon
                        [name]="feature.enabled ? 'check-circle' : 'x-circle'"
                        [size]="18"
                        [class.text-green-600]="feature.enabled"
                        [class.text-gray-400]="!feature.enabled"
                      ></app-icon>
                      <span
                        class="text-sm font-medium truncate"
                        [class.text-text-primary]="feature.enabled"
                        [class.text-text-secondary]="!feature.enabled"
                      >
                        {{ feature.label }}
                      </span>
                    </div>
                    @if (feature.enabled && feature.limit !== null) {
                      <span class="text-xs text-text-secondary whitespace-nowrap">
                        {{ feature.used }}/{{ feature.limit }}
                      </span>
                    }
                  </div>
                  @if (feature.enabled && feature.limit !== null && feature.limit > 0) {
                    <div class="w-full bg-white rounded-full h-1.5 overflow-hidden border border-gray-200">
                      <div
                        class="h-1.5 rounded-full transition-all"
                        [class.bg-green-500]="usagePercent(feature) < 70"
                        [class.bg-amber-500]="usagePercent(feature) >= 70 && usagePercent(feature) < 90"
                        [class.bg-red-500]="usagePercent(feature) >= 90"
                        [style.width.%]="usagePercent(feature)"
                      ></div>
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        </app-card>

        <!-- Action bar -->
        <div class="flex flex-wrap gap-3 pt-2">
          <app-button variant="primary" (clicked)="goToPlans()">
            <app-icon name="refresh-cw" [size]="16" slot="icon"></app-icon>
            Cambiar Plan
          </app-button>
          <app-button variant="outline" (clicked)="goToHistory()">
            <app-icon name="file-text" [size]="16" slot="icon"></app-icon>
            Ver Historial
          </app-button>
          @if (isActive()) {
            <app-button variant="danger" (clicked)="cancelSubscription()">
              <app-icon name="x-circle" [size]="16" slot="icon"></app-icon>
              Cancelar Suscripción
            </app-button>
          }
        </div>
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

  readonly planName = computed(() => {
    const sub: any = this.current();
    return sub?.plan_name ?? sub?.plan?.name ?? 'Sin Plan';
  });

  readonly cycleSuffix = computed(() => {
    const cycle = this.current()?.billing_cycle;
    return cycle === 'yearly' ? 'año' : 'mes';
  });

  readonly daysRemaining = computed(() => {
    const trialEnd = this.current()?.trial_ends_at;
    if (!trialEnd) return 0;
    const diff = new Date(trialEnd).getTime() - Date.now();
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
    const featureLabels: Record<string, string> = {
      text_generation: 'Generación de Texto',
      streaming_chat: 'Chat en Streaming',
      conversations: 'Conversaciones',
      tool_agents: 'Agentes con Herramientas',
      rag_embeddings: 'RAG / Embeddings',
      async_queue: 'Procesamiento Asíncrono',
    };
    return Object.entries(matrix).map(([key, feature]: [string, any]) => ({
      key,
      label: featureLabels[key] || key,
      enabled: feature.enabled === true,
      used: feature.used ?? 0,
      limit:
        feature.monthly_tokens_cap ??
        feature.daily_messages_cap ??
        feature.indexed_docs_cap ??
        feature.monthly_jobs_cap ??
        null,
      unit: feature.monthly_tokens_cap ? 'tokens' : feature.daily_messages_cap ? 'msgs' : null,
    }));
  });

  readonly enabledCount = computed(() => this.featuresList().filter((f) => f.enabled).length);

  ngOnInit(): void {
    this.facade.loadCurrent();
    this.facade.loadAccess();
  }

  usagePercent(feature: { used: number; limit: number | null }): number {
    if (!feature.limit || feature.limit <= 0) return 0;
    return Math.min(100, Math.max(0, (feature.used / feature.limit) * 100));
  }

  goToPlans(): void {
    this.router.navigate(['/admin/subscription/plans']);
  }

  goToHistory(): void {
    this.router.navigate(['/admin/subscription/history']);
  }

  cancelSubscription(): void {
    this.facade.cancel();
    this.toastService.success('Suscripción cancelada');
  }

  getStatusLabel(): string {
    const labels: Record<string, string> = {
      active: 'Activa',
      trialing: 'En Prueba',
      past_due: 'Vencida',
      cancelled: 'Cancelada',
      expired: 'Expirada',
      blocked: 'Bloqueada',
      grace_soft: 'En Gracia',
      grace_hard: 'Gracia Final',
      none: 'Sin Plan',
      trial: 'En Prueba',
    };
    return labels[this.status()] || this.status();
  }
}
