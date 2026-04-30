import { Component, computed, input, output } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';

export interface PricingCardFeature {
  key: string;
  label: string;
  enabled: boolean;
  limit?: number | null;
  unit?: string | null;
}

export interface PricingCardPlan {
  id: number | string;
  name: string;
  code: string;
  description?: string | null;
  base_price: number | string;
  currency: string;
  billing_cycle: 'monthly' | 'yearly' | 'quarterly' | 'semiannual' | 'annual' | 'lifetime' | string;
  features: PricingCardFeature[];
  trial_days?: number;
  is_current?: boolean;
  is_popular?: boolean;
}

/** Emitted on CTA click. `retry=true` indicates the user clicked the
 * "Completar pago" CTA on a card flagged as the current plan but with a
 * `pending_payment` subscription status. Consumers should route to the
 * retry-payment flow instead of the regular checkout. */
export interface PricingCardSelectEvent {
  plan: PricingCardPlan;
  retry: boolean;
}

@Component({
  selector: 'app-pricing-card',
  standalone: true,
  imports: [ButtonComponent, IconComponent, CurrencyPipe],
  template: `
    <article
      class="relative flex flex-col h-full min-w-0 rounded-2xl overflow-hidden transition-all duration-300"
      [class.shadow-sm]="!isPopular()"
      [class.shadow-2xl]="isPopular()"
      [class.bg-white]="!isPopular() && !loading()"
      [class.text-text-primary]="!isPopular()"
      [class.text-white]="isPopular()"
      [class.border]="!isPopular()"
      [class.border-border]="!isPopular() && !isCurrent()"
      [class.border-primary-600]="isCurrent() && !isPopular()"
      [class.ring-2]="isPopular() || isCurrent()"
      [class.ring-primary-500]="isPopular()"
      [class.ring-primary-600]="isCurrent() && !isPopular()"
      [class.ring-offset-2]="isPopular()"
      [class.lg:scale-105]="isPopular()"
      [class.hover:-translate-y-1]="!loading()"
      [class.hover:shadow-lg]="!isPopular() && !loading()"
      [class.hover:shadow-2xl]="isPopular() && !loading()"
      [style.background]="isPopular() ? popularGradient : null"
    >
      <!-- Loading skeleton -->
      @if (loading()) {
        <div class="p-4 md:p-6 space-y-3 animate-pulse">
          <div class="h-5 w-1/2 bg-gray-200 rounded"></div>
          <div class="h-3 w-3/4 bg-gray-200 rounded"></div>
          <div class="h-8 w-2/3 bg-gray-200 rounded mt-4"></div>
          <div class="space-y-2 mt-3">
            <div class="h-3 bg-gray-200 rounded"></div>
            <div class="h-3 bg-gray-200 rounded"></div>
            <div class="h-3 w-5/6 bg-gray-200 rounded"></div>
            <div class="h-3 w-4/6 bg-gray-200 rounded"></div>
          </div>
          <div class="h-9 bg-gray-200 rounded mt-4"></div>
        </div>
      } @else {
        <!-- Ribbon for popular -->
        @if (isPopular()) {
          <span class="absolute top-2 right-4 md:top-3 md:right-6 z-10 bg-amber-400 text-amber-900 text-[9px] md:text-[10px] uppercase tracking-wide font-bold px-2 md:px-3 py-0.5 md:py-1 rounded-full shadow-md">
            Recomendado
          </span>
        }

        <!-- Header -->
        <div class="p-4 md:p-6 pb-3 md:pb-4 pt-8 md:pt-10 space-y-1.5 md:space-y-2">
          <div class="flex items-center gap-1.5 md:gap-2 flex-wrap min-w-0">
            <h3
              class="text-base md:text-xl font-extrabold truncate min-w-0"
              [class.text-text-primary]="!isPopular()"
              [class.text-white]="isPopular()"
            >
              {{ plan().name }}
            </h3>
            @if (isCurrent()) {
              <span
                class="text-[9px] md:text-[10px] uppercase tracking-wide font-bold px-1.5 md:px-2 py-0.5 rounded-full shrink-0"
                [class.bg-primary-100]="!isPopular()"
                [class.text-primary-700]="!isPopular()"
                [class.bg-white\\/20]="isPopular()"
                [class.text-white]="isPopular()"
              >
                Plan actual
              </span>
            }
            @if ((plan().trial_days ?? 0) > 0) {
              <span
                class="text-[9px] md:text-[10px] uppercase tracking-wide font-bold px-1.5 md:px-2 py-0.5 rounded-full shrink-0"
                [class.bg-amber-100]="!isPopular()"
                [class.text-amber-800]="!isPopular()"
                [class.bg-white\\/20]="isPopular()"
                [class.text-white]="isPopular()"
              >
                {{ plan().trial_days }} días gratis
              </span>
            }
          </div>
          @if (plan().description) {
            <p
              class="text-xs md:text-sm leading-relaxed line-clamp-2"
              [class.text-text-secondary]="!isPopular()"
              [class.text-white\\/85]="isPopular()"
            >
              {{ plan().description }}
            </p>
          }
        </div>

        <!-- Price -->
        <div class="px-4 md:px-6 py-1.5 md:py-2">
          <div class="flex items-baseline gap-1.5 md:gap-2 min-w-0">
            <span
              class="text-2xl md:text-4xl font-extrabold leading-none truncate"
              [class.text-text-primary]="!isPopular()"
              [class.text-white]="isPopular()"
            >
              {{ asNumber(plan().base_price) | currency:plan().currency:'symbol':'1.0-0' }}
            </span>
            <span
              class="text-xs md:text-sm shrink-0"
              [class.text-text-secondary]="!isPopular()"
              [class.text-white\\/80]="isPopular()"
            >
              /{{ cycleSuffix() }}
            </span>
          </div>
        </div>

        <!-- Features -->
        <ul class="px-4 md:px-6 py-3 md:py-4 space-y-2 md:space-y-2.5 flex-1">
          @for (f of plan().features; track f.key) {
            <li class="flex items-start gap-1.5 md:gap-2 text-xs md:text-sm min-w-0">
              <app-icon
                [name]="f.enabled ? 'check' : 'minus'"
                [size]="14"
                [class.text-primary-600]="f.enabled && !isPopular()"
                [class.text-white]="f.enabled && isPopular()"
                [class.opacity-40]="!f.enabled"
                class="mt-0.5 shrink-0"
              ></app-icon>
              <span
                class="flex-1 min-w-0 truncate"
                [class.text-text-primary]="f.enabled && !isPopular()"
                [class.text-white]="f.enabled && isPopular()"
                [class.text-text-secondary]="!f.enabled && !isPopular()"
                [class.text-white\\/60]="!f.enabled && isPopular()"
              >
                {{ f.label }}
              </span>
              @if (f.limit !== null && f.limit !== undefined) {
                <span
                  class="text-[10px] md:text-[11px] px-1.5 md:px-2 py-0.5 rounded-md font-medium shrink-0"
                  [class.bg-gray-100]="!isPopular()"
                  [class.text-gray-700]="!isPopular()"
                  [class.bg-white\\/20]="isPopular()"
                  [class.text-white]="isPopular()"
                >
                  {{ f.limit }}{{ f.unit ? ' ' + f.unit : '' }}
                </span>
              }
            </li>
          }
        </ul>

        <!-- CTA -->
        <div class="p-4 md:p-6 md:pt-2 pt-2">
          <app-button
            [variant]="isPopular() ? 'secondary' : isPendingRetry() ? 'primary' : isCurrent() ? 'outline' : 'primary'"
            [disabled]="isCurrent() && !isPendingRetry()"
            [fullWidth]="true"
            [customClasses]="isPopular() ? 'bg-white text-primary-700 hover:bg-gray-50' : ''"
            (clicked)="onSelect()"
          >
            {{ effectiveCtaLabel() }}
          </app-button>
        </div>
      }
    </article>
  `,
})
export class PricingCardComponent {
  readonly plan = input.required<PricingCardPlan>();
  readonly loading = input<boolean>(false);
  readonly ctaLabel = input<string>('Seleccionar');
  /**
   * Phase 4 — Status of the currently active subscription, propagated from
   * the parent (typically `plan-catalog`). Combined with `is_current=true`
   * to surface a "Completar pago" CTA when the user landed on
   * `pending_payment` after a Wompi-aborted commit.
   */
  readonly subscriptionStatus = input<string | undefined>(undefined);

  readonly select = output<PricingCardSelectEvent>();

  readonly popularGradient =
    'linear-gradient(135deg, #7ED7A5 0%, #2F6F4E 60%, #1f4f37 100%)';

  readonly isPopular = computed(() => this.plan().is_popular === true);
  readonly isCurrent = computed(() => this.plan().is_current === true);

  /**
   * True when this card represents the current plan and the subscription is
   * stuck in `pending_payment`. Drives the CTA to "Completar pago" instead
   * of the disabled "Plan actual" label.
   */
  readonly isPendingRetry = computed(
    () => this.isCurrent() && this.subscriptionStatus() === 'pending_payment',
  );

  /** Effective CTA label; falls back to "Seleccionar" via the input. */
  readonly effectiveCtaLabel = computed(() => {
    if (this.isPendingRetry()) return 'Completar pago';
    if (this.isCurrent()) return 'Plan actual';
    return this.ctaLabel();
  });

  readonly cycleSuffix = computed(() => {
    const cycle = this.plan().billing_cycle;
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
  });

  asNumber(value: number | string): number {
    if (typeof value === 'number') return value;
    const n = parseFloat(value);
    return isNaN(n) ? 0 : n;
  }

  onSelect(): void {
    if (this.loading()) return;
    if (this.isCurrent() && !this.isPendingRetry()) return;
    this.select.emit({ plan: this.plan(), retry: this.isPendingRetry() });
  }
}
