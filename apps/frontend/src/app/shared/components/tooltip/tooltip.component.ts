import {
  Component,
  Input,
  HostBinding,
  ChangeDetectionStrategy,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';

export type TooltipSize = 'sm' | 'md' | 'lg';
export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';
export type TooltipColor =
  | 'default'
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'destructive';

@Component({
  selector: 'app-tooltip',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="tooltip-container"
      [attr.data-position]="position"
      [attr.data-size]="size"
      [attr.data-color]="color"
      [class.visible]="visible"
    >
      <div class="tooltip-content">
        <ng-content></ng-content>
      </div>
      <div class="tooltip-arrow"></div>
    </div>
  `,
  styles: [
    `
      :host {
        display: inline-block;
        position: relative;
      }

      .tooltip-container {
        position: absolute;
        z-index: var(--z-tooltip);
        opacity: 0;
        visibility: hidden;
        transition: all 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
        transform: translateY(-2px) scale(0.95);
        pointer-events: none;
        filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.15));
      }

      .tooltip-container.visible {
        opacity: 1;
        visibility: visible;
        transform: translateY(0) scale(1);
      }

      /* Positioning */
      .tooltip-container[data-position='top'] {
        bottom: calc(100% + 8px);
        left: 50%;
        transform: translateX(-50%) translateY(-4px);
      }

      .tooltip-container[data-position='top'].visible {
        transform: translateX(-50%) translateY(0);
      }

      .tooltip-container[data-position='bottom'] {
        top: calc(100% + 8px);
        left: 50%;
        transform: translateX(-50%) translateY(4px);
      }

      .tooltip-container[data-position='bottom'].visible {
        transform: translateX(-50%) translateY(0);
      }

      .tooltip-container[data-position='left'] {
        right: calc(100% + 8px);
        top: 50%;
        transform: translateY(-50%) translateX(-4px);
      }

      .tooltip-container[data-position='left'].visible {
        transform: translateY(-50%) translateX(0);
      }

      .tooltip-container[data-position='right'] {
        left: calc(100% + 8px);
        top: 50%;
        transform: translateY(-50%) translateX(4px);
      }

      .tooltip-container[data-position='right'].visible {
        transform: translateY(-50%) translateX(0);
      }

      /* Content */
      .tooltip-content {
        background: var(--tooltip-bg);
        color: var(--tooltip-text);
        border: none;
        box-shadow:
          0 4px 12px rgba(0, 0, 0, 0.15),
          0 2px 4px rgba(0, 0, 0, 0.1);
        border-radius: 6px;
        padding: var(--tooltip-padding);
        font-size: var(--tooltip-font-size);
        font-weight: var(--fw-medium);
        line-height: 1.3;
        max-width: 180px;
        word-wrap: break-word;
        white-space: nowrap;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        position: relative;
        overflow: hidden;
      }

      .tooltip-content::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(
          135deg,
          rgba(255, 255, 255, 0.1) 0%,
          rgba(255, 255, 255, 0.05) 50%,
          rgba(255, 255, 255, 0) 100%
        );
        pointer-events: none;
      }

      /* Sizes */
      .tooltip-container[data-size='sm'] {
        --tooltip-padding: 4px 8px;
        --tooltip-font-size: var(--fs-xs);
      }

      .tooltip-container[data-size='md'] {
        --tooltip-padding: 6px 12px;
        --tooltip-font-size: var(--fs-sm);
      }

      .tooltip-container[data-size='lg'] {
        --tooltip-padding: 8px 16px;
        --tooltip-font-size: var(--fs-base);
      }

      /* Colors */
      .tooltip-container[data-color='default'] {
        --tooltip-bg: rgba(15, 23, 42, 0.95);
        --tooltip-text: #f8fafc;
        --tooltip-arrow-color: rgba(15, 23, 42, 0.95);
      }

      .tooltip-container[data-color='primary'] {
        --tooltip-bg: linear-gradient(135deg, #7ed7a5 0%, #6fc58a 100%);
        --tooltip-text: #0f172a;
        --tooltip-arrow-color: #7ed7a5;
      }

      .tooltip-container[data-color='secondary'] {
        --tooltip-bg: linear-gradient(135deg, #2f6f4e 0%, #245d3f 100%);
        --tooltip-text: #ffffff;
        --tooltip-arrow-color: #2f6f4e;
      }

      .tooltip-container[data-color='accent'] {
        --tooltip-bg: linear-gradient(135deg, #06b6d4 0%, #0891b2 100%);
        --tooltip-text: #ffffff;
        --tooltip-arrow-color: #06b6d4;
      }

      .tooltip-container[data-color='destructive'] {
        --tooltip-bg: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
        --tooltip-text: #ffffff;
        --tooltip-arrow-color: #ef4444;
      }

      .tooltip-container[data-color='primary'] .tooltip-content {
        background: var(--color-primary);
        color: var(--color-text-on-primary);
        border-color: var(--color-primary);
      }

      .tooltip-container[data-color='secondary'] .tooltip-content {
        background: var(--color-secondary);
        color: var(--color-text-on-primary);
        border-color: var(--color-secondary);
      }

      .tooltip-container[data-color='accent'] .tooltip-content {
        background: var(--color-accent);
        color: white;
        border-color: var(--color-accent);
      }

      .tooltip-container[data-color='destructive'] .tooltip-content {
        background: var(--color-destructive);
        color: white;
        border-color: var(--color-destructive);
      }

      /* Arrow */
      .tooltip-arrow {
        position: absolute;
        width: 0;
        height: 0;
        border: 6px solid transparent;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
      }

      .tooltip-container[data-position='top'] .tooltip-arrow {
        bottom: -12px;
        left: 50%;
        transform: translateX(-50%);
        border-top-color: var(--tooltip-arrow-color);
      }

      .tooltip-container[data-position='bottom'] .tooltip-arrow {
        top: -12px;
        left: 50%;
        transform: translateX(-50%);
        border-bottom-color: var(--tooltip-arrow-color);
      }

      .tooltip-container[data-position='left'] .tooltip-arrow {
        right: -12px;
        top: 50%;
        transform: translateY(-50%);
        border-left-color: var(--tooltip-arrow-color);
      }

      .tooltip-container[data-position='right'] .tooltip-arrow {
        left: -12px;
        top: 50%;
        transform: translateY(-50%);
        border-right-color: var(--tooltip-arrow-color);
      }

      .tooltip-container[data-position='top'] .tooltip-arrow {
        bottom: -10px;
        left: 50%;
        transform: translateX(-50%);
        border-top-color: var(--tooltip-arrow-color);
      }

      .tooltip-container[data-position='bottom'] .tooltip-arrow {
        top: -10px;
        left: 50%;
        transform: translateX(-50%);
        border-bottom-color: var(--tooltip-arrow-color);
      }

      .tooltip-container[data-position='left'] .tooltip-arrow {
        right: -10px;
        top: 50%;
        transform: translateY(-50%);
        border-left-color: var(--tooltip-arrow-color);
      }

      .tooltip-container[data-position='right'] .tooltip-arrow {
        left: -10px;
        top: 50%;
        transform: translateY(-50%);
        border-right-color: var(--tooltip-arrow-color);
      }

      /* Arrow colors */
      .tooltip-container[data-color='default'] {
        --tooltip-arrow-color: var(--color-border);
      }

      .tooltip-container[data-color='primary'] {
        --tooltip-arrow-color: var(--color-primary);
      }

      .tooltip-container[data-color='secondary'] {
        --tooltip-arrow-color: var(--color-secondary);
      }

      .tooltip-container[data-color='accent'] {
        --tooltip-arrow-color: var(--color-accent);
      }

      .tooltip-container[data-color='destructive'] {
        --tooltip-arrow-color: var(--color-destructive);
      }

      /* Dark theme adjustments */
      [data-theme='dark'] .tooltip-container[data-color='default'] {
        --tooltip-bg: rgba(248, 250, 252, 0.95);
        --tooltip-text: #0f172a;
        --tooltip-arrow-color: rgba(248, 250, 252, 0.95);
      }

      [data-theme='dark'] .tooltip-container[data-color='default'] {
        --tooltip-arrow-color: var(--color-border);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TooltipComponent {
  @Input() size: TooltipSize = 'md';
  @Input() position: TooltipPosition = 'top';
  @Input() color: TooltipColor = 'default';
  @Input() visible = false;
  @Input() delay = 200;

  private showTimeout: any;

  @HostBinding('attr.data-tooltip')
  get tooltipAttr() {
    return '';
  }

  @HostListener('mouseenter')
  onMouseEnter() {
    if (this.showTimeout) {
      clearTimeout(this.showTimeout);
    }
    this.showTimeout = setTimeout(() => {
      this.visible = true;
    }, this.delay);
  }

  @HostListener('mouseleave')
  onMouseLeave() {
    if (this.showTimeout) {
      clearTimeout(this.showTimeout);
    }
    this.visible = false;
  }

  ngOnDestroy() {
    if (this.showTimeout) {
      clearTimeout(this.showTimeout);
    }
  }
}
