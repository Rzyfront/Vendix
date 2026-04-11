import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MetricStatus } from '../../interfaces';

@Component({
  selector: 'app-status-indicator',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="inline-flex items-center gap-1.5">
      <span
        class="w-2.5 h-2.5 rounded-full"
        [ngClass]="dotClass"
      ></span>
      <span
        *ngIf="label"
        class="text-sm font-medium"
        style="color: var(--color-text-secondary);"
      >{{ label }}</span>
    </span>
  `,
})
export class StatusIndicatorComponent {
  @Input() status: MetricStatus = 'healthy';
  @Input() label?: string;

  get dotClass(): string {
    switch (this.status) {
      case 'healthy':
        return 'bg-green-500';
      case 'warning':
        return 'bg-yellow-500';
      case 'critical':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  }
}
