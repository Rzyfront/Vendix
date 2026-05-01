import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  HostBinding,
  HostListener,
  effect,
  inject,
  input,
  viewChild,
  signal,
  computed,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';

export type TooltipSize = 'sm' | 'md' | 'lg';
export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';
export type TooltipColor =
  | 'default'
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'destructive'
  | 'warning'
  | 'ai';

@Component({
  selector: 'app-tooltip',
  standalone: true,
  imports: [],
  template: `
    <ng-content></ng-content>
    <div
      #tooltipContainer
      class="tooltip-container"
      [attr.data-position]="resolvedPosition()"
      [attr.data-size]="size()"
      [attr.data-color]="color()"
      [class.visible]="isVisible()"
      [class.positioned]="isPositioned()"
      [style.left.px]="tooltipLeft()"
      [style.top.px]="tooltipTop()"
      [style.max-width.px]="tooltipMaxWidth()"
      [style.--tooltip-arrow-left]="tooltipArrowLeft()"
      [style.--tooltip-arrow-top]="tooltipArrowTop()"
    >
      <div class="tooltip-content">
        {{ content() }}
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
        position: fixed;
        top: 0;
        left: 0;
        z-index: var(--z-tooltip);
        opacity: 0;
        visibility: hidden;
        width: max-content;
        max-width: min(18rem, calc(100vw - 24px));
        transition:
          opacity 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94),
          transform 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94),
          visibility 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
        transform: translate3d(0, -2px, 0) scale(0.95);
        pointer-events: none;
        filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.15));
        box-sizing: border-box;
      }

      .tooltip-container.visible {
        visibility: visible;
      }

      .tooltip-container.visible.positioned {
        opacity: 1;
        transform: translate3d(0, 0, 0) scale(1);
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
        width: max-content;
        max-width: 100%;
        overflow-wrap: anywhere;
        white-space: normal;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        position: relative;
        overflow: visible;
        box-sizing: border-box;
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

      .tooltip-container[data-color='warning'] {
        --tooltip-bg: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
        --tooltip-text: #ffffff;
        --tooltip-arrow-color: #f59e0b;
      }

      .tooltip-container[data-color='ai'] {
        --tooltip-arrow-color: rgba(var(--color-primary-rgb), 0.9);
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

      .tooltip-container[data-color='warning'] .tooltip-content {
        background: #f59e0b;
        color: white;
        border-color: #f59e0b;
      }

      @keyframes ai-tooltip-shimmer {
        0% {
          background-position: 0% 50%;
        }
        50% {
          background-position: 100% 50%;
        }
        100% {
          background-position: 0% 50%;
        }
      }

      .tooltip-container[data-color='ai'] .tooltip-content {
        padding: 6px 12px;
        font-size: 11px;
        font-weight: 400;
        line-height: normal;
        max-width: 100%;
        white-space: normal;
        background: linear-gradient(
          135deg,
          rgba(var(--color-primary-rgb), 0.85) 0%,
          rgba(var(--color-primary-rgb), 0.95) 50%,
          rgba(var(--color-primary-rgb), 0.85) 100%
        );
        background-size: 200% 200%;
        animation: ai-tooltip-shimmer 3s ease-in-out infinite;
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
        box-shadow:
          0 4px 12px rgba(0, 0, 0, 0.25),
          inset 0 1px 1px rgba(255, 255, 255, 0.15);
      }

      .tooltip-container[data-color='ai'] .tooltip-content::before {
        display: none;
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
        left: var(--tooltip-arrow-left, 50%);
        transform: translateX(-50%);
        border-top-color: var(--tooltip-arrow-color);
      }

      .tooltip-container[data-position='bottom'] .tooltip-arrow {
        top: -12px;
        left: var(--tooltip-arrow-left, 50%);
        transform: translateX(-50%);
        border-bottom-color: var(--tooltip-arrow-color);
      }

      .tooltip-container[data-position='left'] .tooltip-arrow {
        right: -12px;
        top: var(--tooltip-arrow-top, 50%);
        transform: translateY(-50%);
        border-left-color: var(--tooltip-arrow-color);
      }

      .tooltip-container[data-position='right'] .tooltip-arrow {
        left: -12px;
        top: var(--tooltip-arrow-top, 50%);
        transform: translateY(-50%);
        border-right-color: var(--tooltip-arrow-color);
      }

      .tooltip-container[data-position='top'] .tooltip-arrow {
        bottom: -10px;
        left: var(--tooltip-arrow-left, 50%);
        transform: translateX(-50%);
        border-top-color: var(--tooltip-arrow-color);
      }

      .tooltip-container[data-position='bottom'] .tooltip-arrow {
        top: -10px;
        left: var(--tooltip-arrow-left, 50%);
        transform: translateX(-50%);
        border-bottom-color: var(--tooltip-arrow-color);
      }

      .tooltip-container[data-position='left'] .tooltip-arrow {
        right: -10px;
        top: var(--tooltip-arrow-top, 50%);
        transform: translateY(-50%);
        border-left-color: var(--tooltip-arrow-color);
      }

      .tooltip-container[data-position='right'] .tooltip-arrow {
        left: -10px;
        top: var(--tooltip-arrow-top, 50%);
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

      .tooltip-container[data-color='warning'] {
        --tooltip-arrow-color: #f59e0b;
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
})
export class TooltipComponent implements AfterViewInit {
  readonly content = input('');
  readonly size = input<TooltipSize>('md');
  readonly position = input<TooltipPosition>('top');
  readonly color = input<TooltipColor>('ai');
  readonly delay = input(200);
  readonly visible = input<boolean | undefined>(undefined);

  private _visible = signal(false);
  readonly isVisible = computed(() => {
    const ext = this.visible();
    return ext !== undefined ? ext : this._visible();
  });

  readonly resolvedPosition = signal<TooltipPosition>('top');
  readonly isPositioned = signal(false);
  readonly tooltipLeft = signal(0);
  readonly tooltipTop = signal(0);
  readonly tooltipMaxWidth = signal(288);
  readonly tooltipArrowLeft = signal('50%');
  readonly tooltipArrowTop = signal('50%');

  private readonly tooltipContainer =
    viewChild<ElementRef<HTMLDivElement>>('tooltipContainer');
  private readonly hostRef = inject(ElementRef) as ElementRef<HTMLElement>;
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);

  private showTimeout: ReturnType<typeof setTimeout> | undefined;
  private positionFrame: number | undefined;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.showTimeout) {
        clearTimeout(this.showTimeout);
      }
      if (this.positionFrame !== undefined) {
        cancelAnimationFrame(this.positionFrame);
      }
      this.tooltipContainer()?.nativeElement.remove();
    });

    effect(() => {
      if (this.isVisible()) {
        this.position();
        this.content();
        this.size();
        this.schedulePositionUpdate();
      } else {
        this.isPositioned.set(false);
      }
    });
  }

  @HostBinding('attr.data-tooltip')
  get tooltipAttr() {
    return '';
  }

  ngAfterViewInit() {
    const tooltip = this.tooltipContainer()?.nativeElement;
    if (tooltip && tooltip.parentElement !== this.document.body) {
      this.document.body.appendChild(tooltip);
    }

    if (this.isVisible()) {
      this.schedulePositionUpdate();
    }
  }

  @HostListener('mouseenter')
  onMouseEnter() {
    if (this.showTimeout) {
      clearTimeout(this.showTimeout);
    }
    this.showTimeout = setTimeout(() => {
      this._visible.set(true);
      this.schedulePositionUpdate();
    }, this.delay());
  }

  @HostListener('mouseleave')
  onMouseLeave() {
    if (this.showTimeout) {
      clearTimeout(this.showTimeout);
    }
    this._visible.set(false);
  }

  @HostListener('window:resize')
  @HostListener('window:scroll')
  onViewportChange() {
    if (this.isVisible()) {
      this.schedulePositionUpdate();
    }
  }

  private schedulePositionUpdate() {
    if (typeof window === 'undefined') {
      return;
    }

    this.isPositioned.set(false);

    if (this.positionFrame !== undefined) {
      cancelAnimationFrame(this.positionFrame);
    }

    const bounds = this.getViewportBounds();
    const hostRect = this.hostRef.nativeElement.getBoundingClientRect();
    const position = this.resolvePosition(hostRect, bounds);

    this.resolvedPosition.set(position);
    this.tooltipMaxWidth.set(this.getMaxWidth(position, hostRect, bounds));

    this.positionFrame = requestAnimationFrame(() => {
      this.updatePosition(position, hostRect, bounds);
    });
  }

  private updatePosition(
    position: TooltipPosition,
    hostRect: DOMRect,
    bounds: TooltipBounds,
  ) {
    const tooltip = this.tooltipContainer()?.nativeElement;
    if (!tooltip) {
      return;
    }

    const gap = 8;
    const arrowPadding = 12;
    const tooltipRect = tooltip.getBoundingClientRect();
    const width = tooltipRect.width;
    const height = tooltipRect.height;
    const hostCenterX = hostRect.left + hostRect.width / 2;
    const hostCenterY = hostRect.top + hostRect.height / 2;

    let left = hostCenterX - width / 2;
    let top = hostRect.top - height - gap;

    if (position === 'bottom') {
      top = hostRect.bottom + gap;
    }

    if (position === 'left') {
      left = hostRect.left - width - gap;
      top = hostCenterY - height / 2;
    }

    if (position === 'right') {
      left = hostRect.right + gap;
      top = hostCenterY - height / 2;
    }

    left = this.clamp(left, bounds.left, bounds.right - width);
    top = this.clamp(top, bounds.top, bounds.bottom - height);

    this.tooltipLeft.set(Math.round(left));
    this.tooltipTop.set(Math.round(top));
    this.tooltipArrowLeft.set(
      `${Math.round(
        this.clamp(hostCenterX - left, arrowPadding, width - arrowPadding),
      )}px`,
    );
    this.tooltipArrowTop.set(
      `${Math.round(
        this.clamp(hostCenterY - top, arrowPadding, height - arrowPadding),
      )}px`,
    );
    this.isPositioned.set(true);
  }

  private resolvePosition(hostRect: DOMRect, bounds: TooltipBounds) {
    const preferred = this.position();
    const gap = 8;
    const minSideWidth = 140;
    const spaces: Record<TooltipPosition, number> = {
      top: hostRect.top - bounds.top - gap,
      bottom: bounds.bottom - hostRect.bottom - gap,
      left: hostRect.left - bounds.left - gap,
      right: bounds.right - hostRect.right - gap,
    };

    if (
      (preferred === 'left' || preferred === 'right') &&
      spaces[preferred] < minSideWidth
    ) {
      const opposite = preferred === 'left' ? 'right' : 'left';
      if (spaces[opposite] >= minSideWidth) {
        return opposite;
      }

      return spaces.bottom >= spaces.top ? 'bottom' : 'top';
    }

    if (
      (preferred === 'top' || preferred === 'bottom') &&
      spaces[preferred] < 40
    ) {
      const opposite = preferred === 'top' ? 'bottom' : 'top';
      if (spaces[opposite] > spaces[preferred]) {
        return opposite;
      }
    }

    return preferred;
  }

  private getMaxWidth(
    position: TooltipPosition,
    hostRect: DOMRect,
    bounds: TooltipBounds,
  ) {
    const gap = 8;
    const preferredMaxWidth = 288;
    const minWidth = 64;
    let availableWidth = bounds.right - bounds.left;

    if (position === 'left') {
      availableWidth = hostRect.left - bounds.left - gap;
    }

    if (position === 'right') {
      availableWidth = bounds.right - hostRect.right - gap;
    }

    return Math.floor(this.clamp(availableWidth, minWidth, preferredMaxWidth));
  }

  private getViewportBounds(): TooltipBounds {
    const padding = 12;

    return {
      left: padding,
      top: padding,
      right: window.innerWidth - padding,
      bottom: window.innerHeight - padding,
    };
  }

  private clamp(value: number, min: number, max: number) {
    if (max < min) {
      return min;
    }

    return Math.min(Math.max(value, min), max);
  }
}

interface TooltipBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
