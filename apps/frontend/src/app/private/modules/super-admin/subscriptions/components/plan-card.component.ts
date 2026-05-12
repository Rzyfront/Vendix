import { Component, input, output } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SubscriptionPlan } from '../interfaces/subscription-admin.interface';
import { IconComponent, BadgeComponent } from '../../../../../shared/components';
import { CurrencyPipe } from '../../../../../shared/pipes/currency';

@Component({
  selector: 'app-plan-card',
  standalone: true,
  imports: [RouterModule, IconComponent, BadgeComponent, CurrencyPipe],
  template: `
    <div class="bg-surface border border-border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
         [routerLink]="['/super-admin/subscriptions/plans', plan().id]">
      <div class="flex items-start justify-between mb-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <app-icon name="clipboard-list" [size]="20" class="text-primary"></app-icon>
          </div>
          <div>
            <h3 class="font-semibold text-text-primary">{{ plan().name }}</h3>
            <p class="text-xs text-text-secondary">{{ plan().slug }}</p>
          </div>
        </div>
        <div class="flex gap-1.5">
          @if (plan().is_active) {
            <app-badge variant="success" size="sm">Active</app-badge>
          } @else {
                        <app-badge variant="neutral" size="sm">Inactive</app-badge>
          }
          @if (plan().is_public) {
            <app-badge variant="primary" size="sm">Public</app-badge>
          }
        </div>
      </div>

      <p class="text-sm text-text-secondary mb-3 line-clamp-2">{{ plan().description }}</p>

      <div class="flex items-center justify-between text-sm">
        <div class="flex items-center gap-3">
          <span class="text-text-secondary">
            <app-icon name="credit-card" [size]="14" class="inline mr-1"></app-icon>
            {{ plan().pricing.length }} cycles
          </span>
          <span class="text-text-secondary">
            <app-icon name="clock" [size]="14" class="inline mr-1"></app-icon>
            {{ plan().grace_threshold_days }}d grace
          </span>
        </div>
        <span class="font-medium text-text-primary">
          @if (defaultPrice() > 0) {
            {{ defaultPrice() | currency }}
          } @else {
            -
          }
        </span>
      </div>
    </div>
  `,
})
export class PlanCardComponent {
  readonly plan = input.required<SubscriptionPlan>();
  readonly clicked = output<SubscriptionPlan>();

  defaultPrice(): number {
    const p = this.plan().pricing.find((x) => x.is_default);
    return p ? p.price : this.plan().pricing[0]?.price ?? 0;
  }
}
