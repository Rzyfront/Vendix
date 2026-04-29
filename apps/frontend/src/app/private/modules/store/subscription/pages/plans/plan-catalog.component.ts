import { Component, OnInit, computed, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  ButtonComponent,
  EmptyStateComponent,
  IconComponent,
  PricingCardComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { SubscriptionFacade } from '../../../../../../core/store/subscription/subscription.facade';
import { StoreSubscriptionService } from '../../services/store-subscription.service';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { SubscriptionPlan } from '../../interfaces/store-subscription.interface';

// S2.1 — Same reason → copy mapping as in checkout component.
const COUPON_REASON_COPY: Record<string, string> = {
  not_found: 'Cupón no encontrado',
  expired: 'Cupón expirado o aún no vigente',
  already_used: 'Este cupón ya fue redimido en esta tienda',
  not_eligible: 'Tu tienda no cumple los requisitos del cupón',
  invalid_state: 'El cupón está deshabilitado',
  network_error: 'Error de red al validar el cupón',
};

@Component({
  selector: 'app-plan-catalog',
  standalone: true,
  imports: [
    EmptyStateComponent,
    PricingCardComponent,
    ButtonComponent,
    IconComponent,
    ReactiveFormsModule,
  ],
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
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8 items-stretch pt-6">
          @for (i of [0, 1, 2]; track i) {
            <app-pricing-card [plan]="skeletonPlan" [loading]="true"></app-pricing-card>
          }
        </div>
      }

      <!-- S2.1 — Coupon entry. Discreet link expands a small input that
           validates the code against the backend, then routes to the
           checkout for the matching promotional plan with the code in the
           query string. -->
      <div class="text-center">
        @if (!couponOpen()) {
          <button
            type="button"
            (click)="couponOpen.set(true)"
            class="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            <app-icon name="tag" [size]="14"></app-icon>
            ¿Tienes un cupón?
          </button>
        } @else {
          <div class="max-w-md mx-auto bg-white border border-border rounded-xl p-4 space-y-3">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-semibold text-text-primary">Aplicar cupón</h3>
              <button
                type="button"
                (click)="closeCoupon()"
                class="text-xs text-text-secondary hover:text-text-primary"
              >
                Cerrar
              </button>
            </div>
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
                (clicked)="redeemCoupon()"
              >
                Aplicar
              </app-button>
            </div>
            @if (couponErrorCopy(); as err) {
              <p class="text-xs text-red-700 flex items-center justify-center gap-1">
                <app-icon name="alert-circle" [size]="14"></app-icon>
                {{ err }}
              </p>
            }
          </div>
        }
      </div>

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
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8 items-stretch pt-6">
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

  // S2.1 — Coupon UI state. Local to this component (no NgRx) since the
  // catalog dispatch only routes to checkout; the checkout page reads the
  // applied coupon from the facade.
  readonly couponOpen = signal(false);
  readonly couponControl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(64)],
  });
  readonly couponValidating = this.facade.couponValidating;
  readonly couponError = this.facade.couponError;
  readonly couponErrorCopy = computed(() => {
    const err = this.couponError();
    if (!err) return null;
    return COUPON_REASON_COPY[err as string] ?? `No se pudo aplicar el cupón (${err})`;
  });

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
        error: (err) => {
          this.loading.set(false);
          // S3.7 — Canonical error helper. Reads backend error_code and
          // resolves to the UX message in core/utils/error-messages.ts.
          this.toastService.error(extractApiErrorMessage(err));
        },
      });
  }

  selectPlan(plan: { id: number | string }): void {
    this.router.navigate(['/admin/subscription/checkout', plan.id]);
  }

  /**
   * S2.1 — Validate the coupon against the backend. On success the facade
   * stores `appliedCoupon` and we route the user to the checkout for the
   * promotional plan it resolved to (which the user can still pair with
   * any base plan). The checkout page picks up the applied coupon from the
   * facade signal and forwards it to preview/commit.
   */
  redeemCoupon(): void {
    const code = (this.couponControl.value ?? '').trim();
    if (!code) return;

    this.facade.validateCoupon(code);

    // Subscribe once for the next applied-coupon emission to navigate.
    const sub = this.facade.appliedCoupon$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((ac) => {
        if (!ac || ac.code !== code) return;
        // Route into checkout pre-selecting the promo plan; the checkout
        // page will read the applied coupon from the facade and forward it.
        this.router.navigate(['/admin/subscription/checkout', ac.plan.id], {
          queryParams: { coupon: ac.code },
        });
        sub.unsubscribe();
      });
  }

  closeCoupon(): void {
    this.couponOpen.set(false);
    this.couponControl.reset('');
    this.facade.clearCoupon();
  }
}
