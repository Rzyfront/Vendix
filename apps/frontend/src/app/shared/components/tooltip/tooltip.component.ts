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
  | 'order-pending'
  | 'order-processing'
  | 'order-ready'
  | 'order-delivered'
  | 'order-cancelled'
  | 'ai';

@Component({
  selector: 'app-tooltip',
  standalone: true,
  imports: [],
  template: `
    <ng-content></ng-content>
    <div
      #tooltipContainer
      [id]="tooltipId"
      role="tooltip"
      [attr.aria-hidden]="isVisible() ? null : 'true'"
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
        max-width: min(18rem, calc(100vw - 32px));
        transition:
          opacity 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94),
          transform 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94),
          visibility 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
        transform: translate3d(0, -2px, 0) scale(0.95);
        pointer-events: none;
        filter: drop-shadow(0 4px 12px color-mix(in srgb, var(--color-neutral-900, #111827) 15%, transparent));
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
          0 4px 12px color-mix(in srgb, var(--color-neutral-900, #111827) 15%, transparent),
          0 2px 4px color-mix(in srgb, var(--color-neutral-900, #111827) 10%, transparent);
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

      @media (max-width: 480px) {
        .tooltip-container {
          max-width: calc(100vw - 32px);
        }

        .tooltip-content {
          width: auto;
          max-width: 100%;
          overflow-wrap: anywhere;
          white-space: normal;
        }
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
          color-mix(in srgb, var(--color-surface, #fff) 10%, transparent) 0%,
          color-mix(in srgb, var(--color-surface, #fff) 5%, transparent) 50%,
          transparent 100%
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
        /* Tokenizado: rgba neutral-900 con alpha */
        --tooltip-bg: rgba(var(--color-neutral-900-rgb), 0.95);
        --tooltip-text: var(--color-neutral-50);
        --tooltip-arrow-color: rgba(var(--color-neutral-900-rgb), 0.95);
      }

      .tooltip-container[data-color='primary'] {
        /* Gradiente usa tokens primarios (sobrescrito por .tooltip-content) */
        --tooltip-bg: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary) 100%);
        --tooltip-text: var(--color-neutral-900);
        --tooltip-arrow-color: var(--color-primary);
      }

      .tooltip-container[data-color='secondary'] {
        --tooltip-bg: linear-gradient(135deg, var(--color-secondary) 0%, var(--color-secondary) 100%);
        --tooltip-text: #ffffff;
        --tooltip-arrow-color: var(--color-secondary);
      }

      .tooltip-container[data-color='accent'] {
        --tooltip-bg: linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent) 100%);
        --tooltip-text: #ffffff;
        --tooltip-arrow-color: var(--color-accent);
      }

      .tooltip-container[data-color='destructive'] {
        --tooltip-bg: linear-gradient(135deg, var(--color-error) 0%, var(--color-error) 100%);
        --tooltip-text: #ffffff;
        --tooltip-arrow-color: var(--color-error);
      }

      .tooltip-container[data-color='warning'] {
        --tooltip-bg: linear-gradient(135deg, var(--color-warning-500) 0%, var(--color-warning-600) 100%);
        --tooltip-text: #ffffff;
        --tooltip-arrow-color: var(--color-warning-500);
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
        /* Tokenizado: warning-500 */
        background: var(--color-warning-500);
        color: white;
        border-color: var(--color-warning-500);
      }

      .tooltip-container[data-color='order-pending'] { --tooltip-arrow-color: #f3f4f6; }
      .tooltip-container[data-color='order-processing'] { --tooltip-arrow-color: #fef3c7; }
      .tooltip-container[data-color='order-ready'] { --tooltip-arrow-color: #d1fae5; }
      .tooltip-container[data-color='order-delivered'] { --tooltip-arrow-color: #e0f2fe; }
      .tooltip-container[data-color='order-cancelled'] { --tooltip-arrow-color: #fee2e2; }
      .tooltip-container[data-color='order-pending'] .tooltip-content { background: #f3f4f6; color: #374151; }
      .tooltip-container[data-color='order-processing'] .tooltip-content { background: #fef3c7; color: #92400e; }
      .tooltip-container[data-color='order-ready'] .tooltip-content { background: #d1fae5; color: #065f46; }
      .tooltip-container[data-color='order-delivered'] .tooltip-content { background: #e0f2fe; color: #075985; }
      .tooltip-container[data-color='order-cancelled'] .tooltip-content { background: #fee2e2; color: #b91c1c; }

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
          color-mix(in srgb, var(--color-surface, #fff) 94%, var(--color-primary, #6d28d9)) 0%,
          color-mix(in srgb, var(--color-surface, #fff) 90%, var(--color-primary, #6d28d9)) 50%,
          color-mix(in srgb, var(--color-surface, #fff) 94%, var(--color-primary, #6d28d9)) 100%
        );
        background-size: 200% 200%;
        animation: ai-tooltip-shimmer 3s ease-in-out infinite;
        color: var(--color-text-primary, #111827);
        border: 1px solid color-mix(in srgb, var(--color-primary, #6d28d9) 24%, transparent);
        border-radius: 8px;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
        box-shadow:
          0 4px 12px color-mix(in srgb, var(--color-neutral-900, #111827) 25%, transparent),
          inset 0 1px 1px color-mix(in srgb, var(--color-surface, #fff) 15%, transparent);
      }

      .tooltip-container[data-color='ai'] .tooltip-content::before {
        display: none;
      }

      @media (prefers-reduced-motion: reduce) {
        .tooltip-container,
        .tooltip-container[data-color='ai'] .tooltip-content {
          animation: none;
          transition: none;
        }
      }

      /* Arrow */
      .tooltip-arrow {
        position: absolute;
        width: 0;
        height: 0;
        border: 6px solid transparent;
        filter: drop-shadow(0 2px 4px color-mix(in srgb, var(--color-neutral-900, #111827) 10%, transparent));
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
        --tooltip-arrow-color: var(--color-warning-500);
      }

      /* Dark theme: invierte tooltip default (fondo claro, texto oscuro) — específico del tooltip, no cubierto por global */
      [data-theme='dark'] .tooltip-container[data-color='default'] {
        /* Tokenizado: rgba neutral-50 con alpha + neutral-900 para texto */
        --tooltip-bg: rgba(var(--color-neutral-50-rgb), 0.95);
        --tooltip-text: var(--color-neutral-900);
        --tooltip-arrow-color: rgba(var(--color-neutral-50-rgb), 0.95);
      }

      [data-theme='dark'] .tooltip-container[data-color='default'] {
        --tooltip-arrow-color: var(--color-border);
      }
    `,
  ],
})
export class TooltipComponent implements AfterViewInit {
  readonly tooltipId = `tooltip-${Math.random().toString(36).slice(2, 11)}`;
  readonly content = input('');
  readonly size = input<TooltipSize>('md');
  readonly position = input<TooltipPosition>('top');
  readonly color = input<TooltipColor>('ai');
  readonly delay = input(200);
  readonly visible = input<boolean | undefined>(undefined);

  private _visible = signal(false);
  readonly isVisible = computed(() => {
    const ext = this.visible();
    return (ext !== undefined ? ext : this._visible()) && !this.escapeDismissed();
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
  private isHovered = false;
  private hasFocus = false;
  private escapeDismissed = signal(false);
  private activeTrigger: HTMLElement | null = null;
  private visualViewport: VisualViewport | null = null;
  private readonly visualViewportChange = () => this.onViewportChange();

  constructor() {
    effect(() => {
      if (this.visible() === false) this.escapeDismissed.set(false);
    });

    this.destroyRef.onDestroy(() => {
      this.removeDescribedBy();
      if (this.showTimeout) {
        clearTimeout(this.showTimeout);
      }
      if (this.positionFrame !== undefined) {
        cancelAnimationFrame(this.positionFrame);
      }
      this.visualViewport?.removeEventListener('resize', this.visualViewportChange);
      this.visualViewport?.removeEventListener('scroll', this.visualViewportChange);
      this.tooltipContainer()?.nativeElement.remove();
    });

    effect(() => {
      if (this.isVisible()) {
        this.applyDescribedBy();
        this.position();
        this.content();
        this.size();
        this.schedulePositionUpdate();
      } else {
        this.removeDescribedBy();
        this.isPositioned.set(false);
      }
    });
  }

  @HostBinding('attr.data-tooltip')
  get tooltipAttr() {
    return '';
  }

  ngAfterViewInit() {
    if (typeof window === 'undefined') return;
    this.visualViewport = window.visualViewport;
    this.visualViewport?.addEventListener('resize', this.visualViewportChange);
    this.visualViewport?.addEventListener('scroll', this.visualViewportChange);

    const tooltip = this.tooltipContainer()?.nativeElement;
    if (tooltip && tooltip.parentElement !== this.document.body) {
      this.document.body.appendChild(tooltip);
    }

    if (this.isVisible()) {
      this.schedulePositionUpdate();
    }
  }

  @HostListener('mouseenter', ['$event'])
  onMouseEnter(event: MouseEvent) {
    this.isHovered = true;
    this.escapeDismissed.set(false);
    this.setActiveTrigger(event.target);
    if (this.showTimeout) {
      clearTimeout(this.showTimeout);
    }
    this.showTimeout = setTimeout(() => {
      this.showTimeout = undefined;
      this._visible.set(true);
      this.schedulePositionUpdate();
    }, this.delay());
  }

  @HostListener('mouseleave')
  onMouseLeave() {
    this.isHovered = false;
    if (this.showTimeout) {
      clearTimeout(this.showTimeout);
      this.showTimeout = undefined;
    }
    if (!this.hasFocus) {
      this._visible.set(false);
      this.removeDescribedBy();
    }
  }

  @HostListener('focusin', ['$event'])
  onFocusIn(event: FocusEvent) {
    this.hasFocus = true;
    this.escapeDismissed.set(false);
    this.setActiveTrigger(event.target);
    if (this.showTimeout) {
      clearTimeout(this.showTimeout);
      this.showTimeout = undefined;
    }
    this._visible.set(true);
    this.schedulePositionUpdate();
  }

  @HostListener('focusout')
  onFocusOut() {
    this.hasFocus = false;
    if (!this.isHovered) {
      this._visible.set(false);
      this.removeDescribedBy();
    }
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.isVisible()) return;
    event.preventDefault();
    event.stopPropagation();
    if (this.showTimeout) {
      clearTimeout(this.showTimeout);
      this.showTimeout = undefined;
    }
    this._visible.set(false);
    this.escapeDismissed.set(true);
    this.removeDescribedBy();
  }

  private setActiveTrigger(target: EventTarget | null): void {
    const element = target instanceof Element ? target : null;
    const trigger = element?.closest<HTMLElement>('button, a, input, select, [tabindex]')
      ?? this.hostRef.nativeElement;
    if (this.activeTrigger !== trigger) this.removeDescribedBy();
    this.activeTrigger = trigger;
    if (this.isVisible()) this.applyDescribedBy();
  }

  private applyDescribedBy(): void {
    if (!this.activeTrigger) return;
    const ids = (this.activeTrigger.getAttribute('aria-describedby') ?? '')
      .split(/\s+/).filter(Boolean);
    if (!ids.includes(this.tooltipId)) {
      this.activeTrigger.setAttribute('aria-describedby', [...ids, this.tooltipId].join(' '));
    }
  }

  private removeDescribedBy(): void {
    if (!this.activeTrigger) return;
    const ids = (this.activeTrigger.getAttribute('aria-describedby') ?? '')
      .split(/\s+/).filter((id) => id && id !== this.tooltipId);
    if (ids.length) this.activeTrigger.setAttribute('aria-describedby', ids.join(' '));
    else this.activeTrigger.removeAttribute('aria-describedby');
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
    const minWidth = 0;
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
    const padding = 16;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;

    return {
      left: left + padding,
      top: top + padding,
      right: left + width - padding,
      bottom: top + height - padding,
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
