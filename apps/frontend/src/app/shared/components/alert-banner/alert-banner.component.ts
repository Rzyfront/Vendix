import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';

export type AlertBannerVariant = 'warning' | 'info' | 'danger' | 'success';

@Component({
  selector: 'app-alert-banner',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div
      class="rounded-xl p-3 flex items-center gap-3 border"
      [ngClass]="variantClasses"
    >
      <app-icon
        [name]="icon"
        size="18"
        [ngClass]="iconClasses"
        class="flex-shrink-0"
      ></app-icon>
      <span class="text-sm font-medium" [ngClass]="textClasses">
        <ng-content></ng-content>
      </span>
    </div>
  `,
})
export class AlertBannerComponent {
  @Input() variant: AlertBannerVariant = 'info';
  @Input() icon = 'info';

  get variantClasses(): string {
    const map: Record<AlertBannerVariant, string> = {
      warning: 'bg-yellow-50 border-yellow-200',
      info: 'bg-blue-50 border-blue-200',
      danger: 'bg-red-50 border-red-200',
      success: 'bg-green-50 border-green-200',
    };
    return map[this.variant];
  }

  get iconClasses(): string {
    const map: Record<AlertBannerVariant, string> = {
      warning: 'text-yellow-600',
      info: 'text-blue-600',
      danger: 'text-red-600',
      success: 'text-green-600',
    };
    return map[this.variant];
  }

  get textClasses(): string {
    const map: Record<AlertBannerVariant, string> = {
      warning: 'text-yellow-800',
      info: 'text-blue-800',
      danger: 'text-red-800',
      success: 'text-green-800',
    };
    return map[this.variant];
  }
}
