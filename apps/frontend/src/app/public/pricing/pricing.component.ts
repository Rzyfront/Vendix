import { Component, computed, effect, inject, signal, DestroyRef } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { CommonModule, DOCUMENT } from '@angular/common';
import { PublicPlansService, PublicPlan } from './services/public-plans.service';
import { PricingCardComponent } from '../../shared/components';
import {
  PricingCardPlan,
  PricingCardSelectEvent,
} from '../../shared/components/pricing-card/pricing-card.component';
import { PlanComparisonTableComponent } from './components/plan-comparison-table/plan-comparison-table.component';
import { Meta, Title } from '@angular/platform-browser';
import { applyMarketingPageMetadata, MARKETING_PAGES } from '../marketing-page-metadata';

type PricingViewMode = 'cards' | 'compare';

/** SEO-OPS-18: ciclos de cobro que se muestran por separado, en este orden. */
export type PricingCycle = 'monthly' | 'quarterly' | 'annual';
export const PRICING_CYCLES: readonly { value: PricingCycle; label: string }[] = [
  { value: 'monthly', label: 'Mensual' },
  { value: 'quarterly', label: 'Trimestral' },
  { value: 'annual', label: 'Anual' },
];

/** `yearly` y `annual` son el mismo ciclo; cualquier otro valor queda fuera del selector. */
export function normalizePricingCycle(cycle: string | null | undefined): PricingCycle | null {
  if (cycle === 'monthly' || cycle === 'quarterly') return cycle;
  if (cycle === 'annual' || cycle === 'yearly') return 'annual';
  return null;
}
const VIEW_MODE_STORAGE_KEY = 'pricingViewMode';

@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [CommonModule, RouterLink, PricingCardComponent, PlanComparisonTableComponent],
  templateUrl: './pricing.component.html',
  styleUrls: ['./pricing.component.scss'],
})
export class PricingComponent {
  // SEO-TECH-04: título, descripción, robots y canonical propios en el host comercial.
  private readonly restoreMarketingMetadata = applyMarketingPageMetadata(
    inject(DOCUMENT),
    inject(Title),
    inject(Meta),
    MARKETING_PAGES.pricing,
  );
  private readonly marketingMetadataCleanup = inject(DestroyRef).onDestroy(
    this.restoreMarketingMetadata,
  );

  private publicPlansService = inject(PublicPlansService);
  private router = inject(Router);

  readonly response = toSignal(this.publicPlansService.list$);
  readonly plans = computed<PublicPlan[]>(() => this.response()?.data ?? []);
  readonly loading = computed(() => this.response() === undefined);
  readonly hasPlans = computed(() => this.plans().length > 0);

  readonly viewMode = signal<PricingViewMode>(this.readStoredViewMode());

  /**
   * SEO-OPS-18: antes se mostraban los 12 planes (mensual, trimestral y anual)
   * mezclados en una sola lista. Ahora se elige el ciclo y solo se ven sus planes.
   */
  readonly cycle = signal<PricingCycle>('monthly');
  readonly availableCycles = computed(() =>
    PRICING_CYCLES.filter((c) => this.plans().some((p) => normalizePricingCycle(p.billing_cycle) === c.value)),
  );
  readonly visiblePlans = computed<PublicPlan[]>(() => {
    const all = this.plans();
    const inCycle = all.filter((p) => normalizePricingCycle(p.billing_cycle) === this.cycle());
    return inCycle.length > 0 ? inCycle : all;
  });

  setCycle(cycle: PricingCycle): void {
    this.cycle.set(cycle);
  }

  readonly dummyPlan = {
    id: 0,
    code: 'dummy',
    name: '',
    base_price: 0,
    currency: 'COP',
    billing_cycle: 'monthly',
    features: [],
  } as PricingCardPlan;

  constructor() {
    // Persist view mode preference across visits
    effect(() => {
      const mode = this.viewMode();
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
        }
      } catch {
        // localStorage unavailable (SSR / private mode) — silently ignore
      }
    });
  }

  setViewMode(mode: PricingViewMode): void {
    this.viewMode.set(mode);
  }

  onSelectPlan(
    event: PricingCardSelectEvent | PricingCardPlan | PublicPlan,
  ): void {
    // Pricing-card now emits `{ plan, retry }`; the comparison table still
    // emits a bare plan. Accept both shapes so we don't force a refactor of
    // the table for this change.
    const plan: { id: number | string } =
      'plan' in event ? (event as PricingCardSelectEvent).plan : event;
    this.router.navigate(['/auth/register'], { queryParams: { plan: plan.id } });
  }

  private readStoredViewMode(): PricingViewMode {
    try {
      if (typeof window === 'undefined') return 'cards';
      const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      return stored === 'compare' ? 'compare' : 'cards';
    } catch {
      return 'cards';
    }
  }
}
