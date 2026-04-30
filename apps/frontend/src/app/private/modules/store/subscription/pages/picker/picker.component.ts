import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import {
  ButtonComponent,
  EmptyStateComponent,
  IconComponent,
  PricingCardComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { PricingCardSelectEvent } from '../../../../../../shared/components/pricing-card/pricing-card.component';
import { SubscriptionFacade } from '../../../../../../core/store/subscription/subscription.facade';
import { StoreSubscriptionService } from '../../services/store-subscription.service';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { SubscriptionPlan } from '../../interfaces/store-subscription.interface';

/**
 * RNC-39 — "Soft picker" landing for stores in `no_plan` state.
 *
 * Stores adicionales de organizaciones que ya consumieron su trial llegan a
 * este estado. La UI debe ser amable (no paywall agresivo) y enfocada en
 * elegir un plan disponible. Reutilizamos `PricingCardComponent`.
 *
 * Skills: vendix-frontend-component, vendix-frontend-routing,
 * vendix-zoneless-signals, vendix-subscription-gate, vendix-ui-ux,
 * vendix-frontend-state.
 */
@Component({
  selector: 'app-subscription-picker',
  standalone: true,
  imports: [
    EmptyStateComponent,
    PricingCardComponent,
    ButtonComponent,
    IconComponent,
  ],
  templateUrl: './picker.component.html',
  styleUrl: './picker.component.css',
})
export class PickerComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly facade = inject(SubscriptionFacade);
  private readonly subscriptionService = inject(StoreSubscriptionService);
  private readonly toast = inject(ToastService);

  readonly plans = signal<SubscriptionPlan[]>([]);
  readonly loading = signal(false);
  readonly subscriptionStatus = this.facade.status;

  /**
   * Filtro local: el backend ya excluye archivados y cuando entra al picker
   * sólo se muestran planes resellable + active. Si en el futuro se expone
   * `show_in_picker` por plan, esto extiende la regla:
   *   plan_type !== 'promotional' OR show_in_picker === true.
   */
  readonly visiblePlans = computed(() =>
    this.plans().filter((p) => {
      const planType =
        (p as unknown as { plan_type?: string | null }).plan_type ?? null;
      const showInPicker =
        (p as unknown as { show_in_picker?: boolean }).show_in_picker ??
        false;
      if (planType === 'promotional' && !showInPicker) return false;
      return true;
    }),
  );

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
    this.subscriptionService
      .getPlans()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.plans.set(res.data);
          }
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.toast.error(extractApiErrorMessage(err));
        },
      });
  }

  selectPlan(event: PricingCardSelectEvent): void {
    this.router.navigate(['/admin/subscription/checkout', event.plan.id]);
  }

  goToPlansCatalog(): void {
    this.router.navigateByUrl('/admin/subscription/plans');
  }
}
