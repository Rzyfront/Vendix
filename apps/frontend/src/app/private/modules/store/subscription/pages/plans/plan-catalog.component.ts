import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  EmptyStateComponent,
  PricingCardComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { SubscriptionFacade } from '../../../../../../core/store/subscription/subscription.facade';
import { StoreSubscriptionService } from '../../services/store-subscription.service';
import { SubscriptionPlan } from '../../interfaces/store-subscription.interface';

@Component({
  selector: 'app-plan-catalog',
  standalone: true,
  imports: [EmptyStateComponent, PricingCardComponent],
  template: `
    <div class="w-full max-w-7xl mx-auto px-4 py-6 lg:py-10 space-y-8">
      <!-- Hero header -->
      <header class="text-center space-y-3 max-w-2xl mx-auto">
        <span class="inline-block bg-primary-100 text-primary-700 text-xs font-bold uppercase tracking-wide px-3 py-1 rounded-full">
          Planes y precios
        </span>
        <h1 class="text-3xl md:text-4xl font-extrabold text-text-primary leading-tight">
          Elige el plan ideal para tu negocio
        </h1>
        <p class="text-base text-text-secondary">
          Escala con confianza. Cambia o cancela cuando quieras.
        </p>
      </header>

      <!-- Loading: skeletons -->
      @if (loading()) {
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8 items-stretch pt-4">
          @for (i of [0, 1, 2]; track i) {
            <app-pricing-card [plan]="skeletonPlan" [loading]="true"></app-pricing-card>
          }
        </div>
      }

      <!-- Empty -->
      @if (!loading() && plans().length === 0) {
        <app-empty-state
          icon="package"
          iconColor="primary"
          title="No hay planes disponibles"
          description="Contacta a tu partner o al equipo de Vendix para activar planes en tu cuenta."
          [showActionButton]="false"
        ></app-empty-state>
      }

      <!-- Catalog -->
      @if (!loading() && plans().length > 0) {
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8 items-stretch pt-4">
          @for (plan of plans(); track plan.id) {
            <app-pricing-card
              [plan]="plan"
              ctaLabel="Seleccionar plan"
              (select)="selectPlan($event)"
            ></app-pricing-card>
          }
        </div>
      }
    </div>
  `,
})
export class PlanCatalogComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private router = inject(Router);
  private facade = inject(SubscriptionFacade);
  private subscriptionService = inject(StoreSubscriptionService);
  private toastService = inject(ToastService);

  readonly plans = signal<SubscriptionPlan[]>([]);
  readonly loading = signal(false);

  readonly skeletonPlan = {
    id: 0,
    name: '',
    code: '',
    description: '',
    base_price: 0,
    currency: 'COP',
    billing_cycle: 'monthly' as const,
    features: [],
    is_current: false,
    is_popular: false,
    sort_order: 0,
  };

  ngOnInit(): void {
    if (!this.facade.isLoaded() && !this.facade.isLoading()) {
      this.facade.loadCurrent();
    }
    this.loadPlans();
  }

  private loadPlans(): void {
    this.loading.set(true);
    this.subscriptionService.getPlans()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            const currentSub = this.facade.current();
            const plans = res.data.map((p: any) => ({
              ...p,
              is_current:
                p.is_current === true ||
                currentSub?.plan_id === p.id ||
                currentSub?.plan_id === String(p.id),
            }));
            this.plans.set(plans);
          }
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toastService.error('Error al cargar planes');
        },
      });
  }

  selectPlan(plan: { id: number | string }): void {
    this.router.navigate(['/admin/subscription/checkout', plan.id]);
  }
}
