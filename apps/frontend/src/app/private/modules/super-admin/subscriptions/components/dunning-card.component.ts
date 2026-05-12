import { DatePipe } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { DunningSubscription } from '../interfaces/subscription-admin.interface';
import { IconComponent, BadgeComponent, ButtonComponent } from '../../../../../shared/components';
import { CurrencyPipe } from '../../../../../shared/pipes/currency';

@Component({
  selector: 'app-dunning-card',
  standalone: true,
  imports: [IconComponent, BadgeComponent, ButtonComponent, CurrencyPipe, DatePipe],
  template: `
    <div class="bg-surface border border-border rounded-lg p-4">
      <div class="flex items-start justify-between mb-3">
        <div>
          <h3 class="font-semibold text-text-primary">{{ subscription().store_name }}</h3>
          <p class="text-xs text-text-secondary">{{ subscription().organization_name }}</p>
        </div>
        <app-badge [variant]="badgeVariant()" size="sm">
          {{ subscription().status }}
        </app-badge>
      </div>

      <div class="space-y-2 mb-4">
        <div class="flex justify-between text-sm">
          <span class="text-text-secondary">Plan</span>
          <span class="text-text-primary">{{ subscription().plan_name }}</span>
        </div>
        <div class="flex justify-between text-sm">
          <span class="text-text-secondary">Amount</span>
          <span class="font-medium text-text-primary">{{ subscription().price | currency }}</span>
        </div>
        <div class="flex justify-between text-sm">
          <span class="text-text-secondary">Period End</span>
          <span class="text-text-primary">{{ subscription().current_period_end | date:'shortDate' }}</span>
        </div>
        <div class="flex justify-between text-sm">
          <span class="text-text-secondary">Days Overdue</span>
          <span class="font-medium text-destructive">{{ subscription().days_overdue }}</span>
        </div>
        <div class="flex justify-between text-sm">
          <span class="text-text-secondary">Attempts</span>
          <span class="text-text-primary">{{ subscription().payment_attempts }}</span>
        </div>
      </div>

      <div class="flex gap-2">
        <app-button variant="outline" size="sm" class="flex-1" (clicked)="retryPayment.emit(subscription())">
          <app-icon name="refresh" [size]="14" slot="icon"></app-icon>
          Retry
        </app-button>
        <app-button variant="ghost" size="sm" class="flex-1" (clicked)="viewDetails.emit(subscription())">
          Details
        </app-button>
      </div>
    </div>
  `,
})
export class DunningCardComponent {
  readonly subscription = input.required<DunningSubscription>();
  readonly retryPayment = output<DunningSubscription>();
  readonly viewDetails = output<DunningSubscription>();

  badgeVariant(): 'warning' | 'error' | 'neutral' {
    switch (this.subscription().status) {
      case 'grace':
        return 'warning';
      case 'suspended':
        return 'error';
      default:
        return 'neutral';
    }
  }
}
