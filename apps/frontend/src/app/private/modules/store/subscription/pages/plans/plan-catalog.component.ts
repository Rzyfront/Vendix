import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { CurrencyPipe } from '@angular/common';
import {
  CardComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { StoreSubscriptionService } from '../../services/store-subscription.service';
import { SubscriptionPlan } from '../../interfaces/store-subscription.interface';

@Component({
  selector: 'app-plan-catalog',
  standalone: true,
  imports: [CardComponent, ButtonComponent, IconComponent, CurrencyPipe],
  template: `
    <div class="w-full space-y-6">
      <div class="text-center">
        <h1 class="text-2xl font-bold text-text-primary">Planes Disponibles</h1>
        <p class="text-text-secondary mt-1">Elige el plan que mejor se adapte a tu negocio</p>
      </div>

      @if (loading()) {
        <div class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      }

      @if (!loading()) {
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          @for (plan of plans(); track plan.id) {
            <div class="relative">
              @if (plan.is_popular) {
                <div class="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                  <span class="bg-primary text-white text-xs font-bold px-3 py-1 rounded-full">Popular</span>
                </div>
              }
              <app-card customClasses="{{ plan.is_current ? 'ring-2 ring-primary' : '' }} h-full">
                <div class="p-6 flex flex-col h-full">
                  <div class="space-y-2 flex-1">
                    <h3 class="text-xl font-bold text-text-primary">{{ plan.name }}</h3>
                    <p class="text-sm text-text-secondary">{{ plan.description }}</p>
                    <div class="mt-4">
                      <span class="text-3xl font-extrabold text-text-primary">{{ plan.base_price | currency }}</span>
                      <span class="text-sm text-text-secondary">/{{ plan.billing_cycle === 'yearly' ? 'año' : 'mes' }}</span>
                    </div>
                    <div class="mt-4 space-y-2">
                      @for (feature of plan.features; track feature.key) {
                        <div class="flex items-center gap-2">
                          <app-icon
                            name="{{ feature.enabled ? 'check' : 'minus' }}"
                            [size]="16"
                            class="{{ feature.enabled ? 'text-green-600' : 'text-gray-400' }}"
                          ></app-icon>
                          <span class="text-sm {{ feature.enabled ? 'text-text-primary' : 'text-text-secondary' }}">
                            {{ feature.label }}
                          </span>
                          @if (feature.enabled && feature.limit !== null) {
                            <span class="text-xs text-text-secondary">({{ feature.limit }}{{ feature.unit ? ' ' + feature.unit : '' }})</span>
                          }
                        </div>
                      }
                    </div>
                  </div>
                  <div class="mt-6">
                    @if (plan.is_current) {
                      <app-button variant="outline" [disabled]="true" customClasses="w-full">
                        Plan Actual
                      </app-button>
                    } @else {
                      <app-button
                        [variant]="plan.is_popular ? 'primary' : 'outline'"
                        customClasses="w-full"
                        (clicked)="selectPlan(plan)"
                      >
                        Seleccionar
                      </app-button>
                    }
                  </div>
                </div>
              </app-card>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class PlanCatalogComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private router = inject(Router);
  private subscriptionService = inject(StoreSubscriptionService);
  private toastService = inject(ToastService);

  readonly plans = signal<SubscriptionPlan[]>([]);
  readonly loading = signal(false);

  ngOnInit(): void {
    this.loadPlans();
  }

  private loadPlans(): void {
    this.loading.set(true);
    this.subscriptionService.getPlans()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) this.plans.set(res.data);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toastService.error('Error al cargar planes');
        },
      });
  }

  selectPlan(plan: SubscriptionPlan): void {
    this.router.navigate(['/admin/subscription/checkout', plan.id]);
  }
}
