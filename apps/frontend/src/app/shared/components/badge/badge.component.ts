import { Component, input } from '@angular/core';
import { NgClass, NgStyle } from '@angular/common';

export type BadgeVariant =
  | 'success'
  | 'neutral'
  | 'error'
  | 'primary'
  | 'warning'
  | 'service'
  | 'info';

export type BadgeSize = 'xsm' | 'xs' | 'sm' | 'md';
export type BadgeStyle = 'solid' | 'outline';

const OUTLINE_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  success: { text: '#059669', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.45)' },
  neutral: { text: '#4b5563', bg: 'rgba(107,114,128,0.12)', border: 'rgba(107,114,128,0.45)' },
  error:   { text: '#dc2626', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.45)' },
  primary: { text: '#2563eb', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.45)' },
  warning: { text: '#ea580c', bg: 'rgba(251,146,60,0.12)',  border: 'rgba(251,146,60,0.45)' },
  service: { text: '#7c3aed', bg: 'rgba(139,92,246,0.12)',  border: 'rgba(139,92,246,0.45)' },
  info:    { text: '#2563eb', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.45)' },
};

@Component({
  selector: 'app-badge',
  standalone: true,
  imports: [NgClass, NgStyle],
  template: `
    <span
      class="inline-flex items-center font-medium"
      [class.rounded-full]="true"
      [ngClass]="badgeStyle() === 'solid' ? [sizeClasses, variantClasses] : [outlineSizeClasses, 'badge-outline']"
      [ngStyle]="badgeStyle() === 'outline' ? outlineStyles : null"
    >
      <ng-content></ng-content>
    </span>
  `,
  styles: [`
    .badge-outline {
      border: 1.5px solid;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      white-space: nowrap;
      line-height: 1.2;
      font-weight: 600;
    }
  `],
})
export class BadgeComponent {
  readonly variant = input<BadgeVariant>('neutral');
  readonly size = input<BadgeSize>('sm');
  readonly badgeStyle = input<BadgeStyle>('solid');

  get sizeClasses(): string {
    const sizes: Record<string, string> = {
      xsm: 'px-1.5 py-0.5 text-[10px]',
      xs:  'px-1.5 py-0.5 text-[10px]',
      sm:  'px-2.5 py-0.5 text-xs',
      md:  'px-3 py-1 text-sm',
    };
    return sizes[this.size()];
  }

  get variantClasses(): string {
    const variants: Record<string, string> = {
      success: 'bg-green-100 text-green-800',
      neutral: 'bg-gray-100 text-gray-800',
      error:   'bg-red-100 text-red-800',
      primary: 'bg-blue-100 text-blue-800',
      warning: 'bg-yellow-100 text-yellow-800',
      service: 'bg-purple-100 text-purple-800',
      info:    'bg-blue-100 text-blue-800',
    };
    return variants[this.variant()];
  }

  get outlineSizeClasses(): string {
    const sizes: Record<string, string> = {
      xsm: 'px-[0.35rem] py-[0.15rem] text-[10px]',
      xs:  'px-[0.35rem] py-[0.15rem] text-[10px]',
      sm:  'px-[0.6rem] py-[0.2rem] text-xs',
      md:  'px-3 py-1 text-sm',
    };
    return sizes[this.size()];
  }

  get outlineStyles(): Record<string, string> | null {
    const v = OUTLINE_COLORS[this.variant()];
    if (!v) return null;
    return { color: v.text, background: v.bg, 'border-color': v.border };
  }
}
