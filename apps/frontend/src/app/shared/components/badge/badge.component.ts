import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type BadgeVariant =
  | 'success'
  | 'neutral'
  | 'error'
  | 'primary'
  | 'warning';

@Component({
  selector: 'app-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span
      class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
      [ngClass]="{
        'bg-green-100 text-green-800': variant === 'success',
        'bg-gray-100 text-gray-800': variant === 'neutral',
        'bg-red-100 text-red-800': variant === 'error',
        'bg-blue-100 text-blue-800': variant === 'primary',
        'bg-yellow-100 text-yellow-800': variant === 'warning',
      }"
    >
      <ng-content></ng-content>
    </span>
  `,
})
export class BadgeComponent {
  @Input() variant: BadgeVariant = 'neutral';
}
