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

@Component({
  selector: 'app-pricing-card',
  standalone: true,
  imports: [ButtonComponent, IconComponent, CurrencyPipe],
  template: `
    <article
      class="relative flex flex-col h-full rounded-2xl transition-all duration-300"
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
        <div class="p-6 space-y-4 animate-pulse">
          <div class="h-6 w-1/2 bg-gray-200 rounded"></div>
          <div class="h-3 w-3/4 bg-gray-200 rounded"></div>
          <div class="h-10 w-2/3 bg-gray-200 rounded mt-6"></div>
          <div class="space-y-2 mt-4">
            <div class="h-3 bg-gray-200 rounded"></div>
            <div class="h-3 bg-gray-200 rounded"></div>
            <div class="h-3 w-5/6 bg-gray-200 rounded"></div>
            <div class="h-3 w-4/6 bg-gray-200 rounded"></div>
          </div>
          <div class="h-10 bg-gray-200 rounded mt-6"></div>
        </div>
      } @else {
        <!-- Ribbon for popular -->
        @if (isPopular()) {
          <span class="absolute -top-3 right-6 z-10 bg-amber-400 text-amber-900 text-[10px] uppercase tracking-wide font-bold px-3 py-1 rounded-full shadow-md">
            Recomendado
          </span>
        }

        <!-- Header -->
        <div class="p-6 pb-4 space-y-2">
          <div class="flex items-center gap-2 flex-wrap">
            <h3
              class="text-xl font-extrabold"
              [class.text-text-primary]="!isPopular()"
              [class.text-white]="isPopular()"
            >
              {{ plan().name }}
            </h3>
            @if (isCurrent()) {
              <span
                class="text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full"
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
                class="text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full"
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
              class="text-sm leading-relaxed"
              [class.text-text-secondary]="!isPopular()"
              [class.text-white\\/85]="isPopular()"
            >
              {{ plan().description }}
            </p>
          }
        </div>

        <!-- Price -->
        <div class="px-6 py-2">
          <div class="flex items-baseline gap-2">
            <span
              class="text-4xl font-extrabold leading-none"
              [class.text-text-primary]="!isPopular()"
              [class.text-white]="isPopular()"
            >
              {{ asNumber(plan().base_price) | currency:plan().currency:'symbol':'1.0-0' }}
            </span>
            <span
              class="text-sm"
              [class.text-text-secondary]="!isPopular()"
              [class.text-white\\/80]="isPopular()"
            >
              /{{ cycleSuffix() }}
            </span>
          </div>
        </div>

        <!-- Features -->
        <ul class="px-6 py-4 space-y-2.5 flex-1">
          @for (f of plan().features; track f.key) {
            <li class="flex items-start gap-2 text-sm">
              <app-icon
                [name]="f.enabled ? 'check' : 'minus'"
                [size]="16"
                [class.text-primary-600]="f.enabled && !isPopular()"
                [class.text-white]="f.enabled && isPopular()"
                [class.opacity-40]="!f.enabled"
                class="mt-0.5 shrink-0"
              ></app-icon>
              <span
                class="flex-1"
                [class.text-text-primary]="f.enabled && !isPopular()"
                [class.text-white]="f.enabled && isPopular()"
                [class.text-text-secondary]="!f.enabled && !isPopular()"
                [class.text-white\\/60]="!f.enabled && isPopular()"
              >
                {{ f.label }}
              </span>
              @if (f.limit !== null && f.limit !== undefined) {
                <span
                  class="text-[11px] px-2 py-0.5 rounded-md font-medium"
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
        <div class="p-6 pt-2">
          <app-button
            [variant]="isPopular() ? 'secondary' : isCurrent() ? 'outline' : 'primary'"
            [disabled]="isCurrent()"
            [fullWidth]="true"
            [customClasses]="isPopular() ? 'bg-white text-primary-700 hover:bg-gray-50' : ''"
            (clicked)="onSelect()"
          >
            {{ isCurrent() ? 'Plan actual' : ctaLabel() }}
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

  readonly select = output<PricingCardPlan>();

  readonly popularGradient =
    'linear-gradient(135deg, #7ED7A5 0%, #2F6F4E 60%, #1f4f37 100%)';

  readonly isPopular = computed(() => this.plan().is_popular === true);
  readonly isCurrent = computed(() => this.plan().is_current === true);

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
    if (this.isCurrent() || this.loading()) return;
    this.select.emit(this.plan());
  }
}
