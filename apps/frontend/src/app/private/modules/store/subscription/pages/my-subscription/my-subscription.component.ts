import { Component, OnInit, inject, computed } from '@angular/core';
import { DatePipe, CurrencyPipe } from '@angular/common';
import { Router } from '@angular/router';
import {
  CardComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { SubscriptionFacade } from '../../../../../../core/store/subscription/subscription.facade';

@Component({
  selector: 'app-my-subscription',
  standalone: true,
  imports: [CardComponent, ButtonComponent, IconComponent, DatePipe, CurrencyPipe],
  template: `
    <div class="w-full space-y-6">
      @if (loading()) {
        <div class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Cargando suscripción...</p>
        </div>
      }

      @if (!loading() && current()) {
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-card>
            <div class="p-4 space-y-3">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-semibold text-text-secondary uppercase tracking-wide">Mi Plan</h3>
                <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold {{ getStatusBadgeClass() }}">
                  {{ getStatusLabel() }}
                </span>
              </div>
              <div class="flex items-center gap-3">
                <div class="p-4 bg-primary/10 rounded-xl">
                  <app-icon name="crown" [size]="32" class="text-primary"></app-icon>
                </div>
                <div>
                  <p class="text-2xl font-extrabold text-text-primary">{{ current()?.plan_name || 'Sin Plan' }}</p>
                  <p class="text-lg font-bold text-primary">
                    {{ (current()?.effective_price || 0) | currency }}
                    <span class="text-sm font-normal text-text-secondary">/{{ current()?.billing_cycle === 'yearly' ? 'año' : 'mes' }}</span>
                  </p>
                </div>
              </div>
              @if (current()?.next_billing_at) {
                <p class="text-xs text-text-secondary mt-2">
                  Próximo cobro: {{ current()?.next_billing_at | date:'mediumDate' }}
                </p>
              }
            </div>
          </app-card>

          @if (status() === 'trial' && current()?.trial_ends_at) {
            <app-card>
              <div class="p-4 space-y-3">
                <h3 class="text-sm font-semibold text-text-secondary uppercase tracking-wide">Período de Prueba</h3>
                <div class="flex items-center gap-3">
                  <div class="p-4 bg-amber-100 rounded-xl">
                    <app-icon name="hourglass" [size]="32" class="text-amber-600"></app-icon>
                  </div>
                  <div>
                    <p class="text-2xl font-extrabold text-amber-600">{{ daysRemaining() }} días</p>
                    <p class="text-sm text-text-secondary">restantes de prueba</p>
                  </div>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-2 mt-2">
                  <div class="bg-amber-500 h-2 rounded-full transition-all" [style.width.%]="trialProgress()"></div>
                </div>
              </div>
            </app-card>
          }
        </div>

        <div class="grid grid-cols-1 gap-4">
          <app-card>
            <div class="p-4">
              <h3 class="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-4">Uso de Funciones IA</h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                @for (feature of featuresList(); track feature.key) {
                  <div class="flex items-center justify-between p-3 rounded-lg border border-border {{ feature.enabled ? 'bg-green-50 border-green-200' : 'bg-gray-50' }}">
                    <div class="flex items-center gap-2">
                      <app-icon
                        name="{{ feature.enabled ? 'check-circle' : 'x-circle' }}"
                        [size]="18"
                        class="{{ feature.enabled ? 'text-green-600' : 'text-gray-400' }}"
                      ></app-icon>
                      <span class="text-sm font-medium {{ feature.enabled ? 'text-text-primary' : 'text-text-secondary' }}">{{ feature.label }}</span>
                    </div>
                    @if (feature.enabled && feature.limit !== null) {
                      <span class="text-xs text-text-secondary">{{ feature.used }}/{{ feature.limit }}</span>
                    }
                  </div>
                }
              </div>
            </div>
          </app-card>
        </div>

        <div class="flex flex-wrap gap-3">
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

      @if (!loading() && !current()) {
        <div class="text-center p-8 space-y-4">
          <app-icon name="credit-card" [size]="64" class="text-text-secondary"></app-icon>
          <h2 class="text-xl font-bold text-text-primary">Sin suscripción activa</h2>
          <p class="text-text-secondary">Selecciona un plan para comenzar</p>
          <app-button variant="primary" (clicked)="goToPlans()">
            <app-icon name="arrow-right" [size]="16" slot="icon"></app-icon>
            Ver Planes
          </app-button>
        </div>
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
    return Object.entries(matrix).map(([key, feature]: [string, any]) => ({
      key,
      label: feature.label || key,
      enabled: feature.enabled || false,
      used: feature.used || 0,
      limit: feature.limit || null,
      unit: feature.unit || null,
    }));
  });

  ngOnInit(): void {
    this.facade.loadCurrent();
    this.facade.loadAccess();
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

  getStatusBadgeClass(): string {
    const classes: Record<string, string> = {
      active: 'bg-green-100 text-green-700',
      trialing: 'bg-blue-100 text-blue-700',
      past_due: 'bg-red-100 text-red-700',
      cancelled: 'bg-gray-100 text-gray-700',
      blocked: 'bg-red-100 text-red-700',
      grace_soft: 'bg-yellow-100 text-yellow-700',
      none: 'bg-gray-100 text-gray-700',
      trial: 'bg-blue-100 text-blue-700',
    };
    return classes[this.status()] || 'bg-gray-100 text-gray-700';
  }
}
