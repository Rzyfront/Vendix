import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type BadgeVariant =
  | 'success'
  | 'neutral'
  | 'error'
  | 'primary'
  | 'warning';

export type BadgeSize = 'xsm' | 'sm' | 'md';

@Component({
  selector: 'app-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span
      class="inline-flex items-center rounded-full font-medium"
      [ngClass]="[sizeClasses, variantClasses]"
    >
      <ng-content></ng-content>
    </span>
  `,
})
export class BadgeComponent {
  @Input() variant: BadgeVariant = 'neutral';
  @Input() size: BadgeSize = 'sm';

  get sizeClasses(): string {
    const sizes = {
      xsm: 'px-1.5 py-0.5 text-[10px]',
      sm: 'px-2.5 py-0.5 text-xs',
      md: 'px-3 py-1 text-sm',
    };
    return sizes[this.size];
  }

  get variantClasses(): string {
    const variants = {
      success: 'bg-green-100 text-green-800',
      neutral: 'bg-gray-100 text-gray-800',
      error: 'bg-red-100 text-red-800',
      primary: 'bg-blue-100 text-blue-800',
      warning: 'bg-yellow-100 text-yellow-800',
    };
    return variants[this.variant];
  }
}
