import {
  Component,
  Input,
  Output,
  EventEmitter,
  inject,
  OnInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  NgZone,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../../button/button.component';
import { TourService, TourStep, TourConfig } from '../services/tour.service';
import { POS_TOUR_CONFIG } from '../configs/pos-tour.config';

interface SpotlightPosition {
  top: number;
  left: number;
  width: number;
  height: number;
  visible: boolean;
}

@Component({
  selector: 'app-tour-modal',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  template: `
    <!-- Spotlight Overlay -->
    <div
      *ngIf="isOpen && spotlight.visible && spotlight.width > 0"
      class="tour-spotlight-overlay"
      [style.top.px]="spotlight.top"
      [style.left.px]="spotlight.left"
      [style.width.px]="spotlight.width"
      [style.height.px]="spotlight.height"
    ></div>

    <!-- Tour Tooltip - Different design for mobile and desktop -->
    <div
      *ngIf="isOpen"
      class="tour-tooltip"
      [class.is-mobile]="isMobile"
      [class.is-desktop]="!isMobile"
      [class.is-minimized]="isMinimized"
      [attr.data-position-mode]="isMobile ? 'compact' : 'absolute'"
      [style.top.px]="tooltipPosition.top"
      [style.left.px]="tooltipPosition.left"
    >
      <div class="tooltip-header">
        <h3 class="tooltip-title">{{ currentStep?.title }}</h3>
        <!-- Minimize button for mobile -->
        <button
          *ngIf="isMobile"
          class="minimize-btn"
          (click)="toggleMinimize()"
          [attr.aria-label]="isMinimized ? 'Expandir' : 'Minimizar'"
        >
          <svg [class.rotated]="isMinimized" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
      </div>

      <div class="tooltip-content" [class.expanded]="!isMinimized">
        <p class="tooltip-description">{{ currentStep?.description }}</p>

        <p *ngIf="currentStep?.action" class="tooltip-action">
          👆 {{ currentStep?.action }}
        </p>
      </div>

      <!-- Footer Navigation -->
      <div class="tooltip-footer" [class.expanded]="!isMinimized">
        <div class="footer-left">
          <app-button
            variant="outline"
            [size]="isMobile ? 'xsm' : 'xsm'"
            (clicked)="skipTour()"
            class="skip-btn"
          >
            Saltar
          </app-button>
        </div>

        <!-- Progress indicator (desktop only) -->
        <div class="footer-center" *ngIf="!isMobile">
          <span class="tour-progress">
            {{ currentIndex + 1 }} de {{ totalSteps }}
          </span>
        </div>

        <div class="footer-right">
          <app-button
            variant="primary"
            [size]="isMobile ? 'sm' : 'xsm'"
            (clicked)="nextStep()"
            [disabled]="isProcessing"
            class="next-btn"
          >
            {{ nextButtonText }}
          </app-button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: contents;
    }

    /* Spotlight overlay - consistent across devices */
    .tour-spotlight-overlay {
      position: fixed;
      z-index: 10003;
      pointer-events: none !important;
      border-radius: 8px;
      box-shadow:
        0 0 0 2px var(--color-primary, #10B981),
        0 0 20px var(--color-primary, #10B981),
        0 0 0 9999px rgba(0, 0, 0, 0.75);
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    @media (min-width: 768px) {
      .tour-spotlight-overlay {
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        animation: spotlight-pulse 2s ease-in-out infinite;
      }
    }

    @keyframes spotlight-pulse {
      0%, 100% {
        box-shadow:
          0 0 0 2px var(--color-primary, #10B981),
          0 0 20px var(--color-primary, #10B981),
          0 0 0 9999px rgba(0, 0, 0, 0.75);
      }
      50% {
        box-shadow:
          0 0 0 2px var(--color-primary, #10B981),
          0 0 35px var(--color-primary, #10B981),
          0 0 0 9999px rgba(0, 0, 0, 0.75);
      }
    }

    /* ============================================================
       MOBILE: Ultra-compact tooltip (NOT bottom sheet)
       Small, positioned near target, doesn't block content
       Can be minimized to reduce blocking
       ============================================================ */
    .tour-tooltip.is-mobile {
      position: fixed;
      z-index: 10004;
      max-width: 280px;
      min-width: 200px;
      /* Compact card design */
      background: var(--color-surface, #1e1e1e);
      border: 2px solid var(--color-primary, #10B981);
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      /* Allow dynamic positioning via inline styles */
      display: flex;
      flex-direction: column;
      /* Safe area support */
      padding: 12px;
      /* IMPORTANT: Leave space for mobile footer (checkout button) */
      max-height: calc(100vh - 140px - env(safe-area-inset-bottom, 20px));
      overflow-y: auto;
      /* Fade in animation */
      animation: fade-in-mobile 0.2s ease-out;
      transition: max-height 0.3s ease, opacity 0.3s ease;
    }

    /* Minimized state - shows only header with minimize button */
    .tour-tooltip.is-mobile.is-minimized {
      max-height: 50px;
      min-height: 50px;
      overflow: hidden;
      padding: 8px 12px;
      opacity: 0.9;
    }

    .tour-tooltip.is-mobile.is-minimized .tooltip-content,
    .tour-tooltip.is-mobile.is-minimized .tooltip-footer {
      display: none;
    }

    @keyframes fade-in-mobile {
      from {
        opacity: 0;
        transform: scale(0.95);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }

    /* Mobile header - more compact with minimize button */
    .tour-tooltip.is-mobile .tooltip-header {
      padding: 4px 0;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .tour-tooltip.is-mobile .tooltip-title {
      font-size: 0.875rem;
      font-weight: 600;
      line-height: 1.3;
      min-height: 20px;
      flex: 1;
      margin: 0;
    }

    /* Minimize button for mobile */
    .tour-tooltip.is-mobile .minimize-btn {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      padding: 4px;
      background: rgba(var(--color-primary-rgb, 16, 185, 129), 0.15);
      border: 1px solid var(--color-primary, #10B981);
      border-radius: 6px;
      color: var(--color-primary, #10B981);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    }

    .tour-tooltip.is-mobile .minimize-btn:hover {
      background: rgba(var(--color-primary-rgb, 16, 185, 129), 0.25);
    }

    .tour-tooltip.is-mobile .minimize-btn:active {
      transform: scale(0.95);
    }

    .tour-tooltip.is-mobile .minimize-btn svg {
      transition: transform 0.3s ease;
    }

    .tour-tooltip.is-mobile .minimize-btn svg.rotated {
      transform: rotate(180deg);
    }

    /* Mobile content - concise with smooth expand/collapse */
    .tour-tooltip.is-mobile .tooltip-content {
      padding: 6px 0;
      flex: 1;
      min-height: 0;
      max-height: 200px;
      overflow: hidden;
      opacity: 1;
      transition: max-height 0.3s ease, opacity 0.3s ease, padding 0.3s ease;
    }

    /* Hidden content when minimized */
    .tour-tooltip.is-mobile .tooltip-content:not(.expanded) {
      max-height: 0;
      padding-top: 0;
      padding-bottom: 0;
      opacity: 0;
      margin: 0;
    }

    .tour-tooltip.is-mobile .tooltip-description {
      font-size: 0.8125rem;
      line-height: 1.4;
      margin: 0;
      max-height: 80px;
      overflow-y: auto;
    }

    .tour-tooltip.is-mobile .tooltip-action {
      font-size: 0.75rem;
      margin: 4px 0 0;
    }

    /* Mobile footer - horizontal, 2 buttons only with smooth transition */
    .tour-tooltip.is-mobile .tooltip-footer {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 0 0;
      margin-top: 8px;
      max-height: 60px;
      opacity: 1;
      transition: max-height 0.3s ease, opacity 0.3s ease, margin 0.3s ease;
    }

    /* Hidden footer when minimized */
    .tour-tooltip.is-mobile .tooltip-footer:not(.expanded) {
      max-height: 0;
      padding-top: 0;
      margin-top: 0;
      opacity: 0;
      overflow: hidden;
    }

    .tour-tooltip.is-mobile .footer-left,
    .tour-tooltip.is-mobile .footer-right {
      width: auto;
      flex-shrink: 0;
    }

    .tour-tooltip.is-mobile .footer-left {
      flex: 0 0 auto;
    }

    .tour-tooltip.is-mobile .footer-right {
      flex: 1 1 auto;
      display: flex;
      justify-content: flex-end;
      gap: 6px;
    }

    .tour-tooltip.is-mobile .skip-btn {
      min-width: 60px;
      min-height: 36px;
      padding: 6px 10px;
      font-size: 0.75rem;
    }

    .tour-tooltip.is-mobile .next-btn {
      min-width: 90px;
      min-height: 36px;
      padding: 6px 12px;
      font-size: 0.8125rem;
    }

    /* ============================================================
       DESKTOP: Positioned tooltip (original design)
       ============================================================ */
    .tour-tooltip.is-desktop {
      position: fixed;
      z-index: 10004;
      background: var(--color-surface, #1e1e1e);
      border: 2px solid var(--color-primary, #10B981);
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
      max-width: 380px;
      min-width: 280px;
      padding: 16px;
      animation: tooltip-appear-desktop 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    @keyframes tooltip-appear-desktop {
      from {
        opacity: 0;
        transform: translateY(-10px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    /* Desktop header styling */
    .tour-tooltip.is-desktop .tooltip-header {
      padding: 0 0 12px 0;
      margin-bottom: 12px;
    }

    .tour-tooltip.is-desktop .tooltip-title {
      font-size: 1.125rem;
      font-weight: 600;
      line-height: 1.4;
    }

    /* Desktop content styling */
    .tour-tooltip.is-desktop .tooltip-content {
      padding: 0;
      margin-bottom: 16px;
    }

    .tour-tooltip.is-desktop .tooltip-description {
      font-size: 0.9375rem;
      line-height: 1.6;
      margin-bottom: 12px;
    }

    .tour-tooltip.is-desktop .tooltip-action {
      font-size: 0.875rem;
      margin: 0;
      padding: 8px 12px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 8px;
      display: inline-block;
    }

    /* ============================================================
       Shared base styles
       ============================================================ */
    .tooltip-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .tooltip-title {
      margin: 0;
      font-weight: 600;
      color: var(--color-text-primary, #fff);
    }

    .tooltip-description {
      margin: 0;
      color: var(--color-text-primary, #fff);
    }

    .tooltip-action {
      margin: 0;
      font-weight: 500;
      color: var(--color-primary, #10B981);
    }

    .tooltip-footer {
      display: flex;
    }

    .footer-left,
    .footer-center,
    .footer-right {
      display: flex;
      align-items: center;
    }

    .tour-progress {
      font-size: 0.8125rem;
      color: var(--color-text-secondary, #999);
      font-weight: 600;
    }

    /* Desktop footer */
    @media (min-width: 768px) {
      .tour-tooltip.is-desktop .tooltip-footer {
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 0;
        margin-top: 0;
      }

      .tour-tooltip.is-desktop .footer-left,
      .tour-tooltip.is-desktop .footer-center,
      .tour-tooltip.is-desktop .footer-right {
        width: auto;
      }

      .tour-tooltip.is-desktop .footer-center {
        order: 0;
        flex: 1;
        justify-content: center;
      }

      .tour-tooltip.is-desktop .footer-left {
        flex: 0 0 auto;
      }

      .tour-tooltip.is-desktop .footer-right {
        flex-direction: row;
        gap: 8px;
        width: auto;
        flex: 0 0 auto;
      }

      .tour-tooltip.is-desktop .skip-btn,
      .tour-tooltip.is-desktop .next-btn {
        min-width: auto;
        min-height: 40px;
        padding: 10px 18px;
        font-size: 0.875rem;
      }

      .tour-tooltip.is-desktop .tour-progress {
        padding: 6px 14px;
        background: rgba(255, 255, 255, 0.08);
        border-radius: 20px;
        font-size: 0.8125rem;
      }
    }

    /* Hide progress on mobile to save space */
    .tour-tooltip.is-mobile .footer-center {
      display: none;
    }

    /* Respect prefers-reduced-motion */
    @media (prefers-reduced-motion: reduce) {
      .tour-tooltip.is-mobile,
      .tour-spotlight-overlay {
        animation: none !important;
        transition: none !important;
      }
    }
  `],
})
export class TourModalComponent implements OnInit, OnDestroy, OnChanges {
  private tourService = inject(TourService);
  private ngZone = inject(NgZone);

  @Input() isOpen = false;
  @Input() tourConfig: TourConfig = POS_TOUR_CONFIG;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() completed = new EventEmitter<void>();
  @Output() skipped = new EventEmitter<void>();

  currentIndex = 0;
  currentStep: TourStep | null = null;
  isProcessing = false;
  isMobile = false;
  isMinimized = false;

  spotlight: SpotlightPosition = {
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    visible: false,
  };

  tooltipPosition = { top: 100, left: 100 };

  private resizeObserver: ResizeObserver | null = null;
  private domObserver: MutationObserver | null = null;
  private highlightedElement: HTMLElement | null = null;
  private cleanupFunctions: (() => void)[] = [];
  private recalculateTimeout: any = null;
  private clickListener: ((e: Event) => void) | null = null;

  ngOnInit(): void {
    console.log('[TourModal] Component initialized');
    this.checkMobile();
    this.setupResizeObserver();
    this.setupDOMObserver();
    this.setupPathListener();
    this.setupClickListener();
  }

  private checkMobile(): void {
    this.isMobile = window.innerWidth < 768;
    // Auto-minimize on mobile by default
    if (this.isMobile) {
      this.isMinimized = true;
    }
    console.log('[TourModal] Mobile check:', this.isMobile, 'minimized:', this.isMinimized);
  }

  ngOnDestroy(): void {
    console.log('[TourModal] Component destroyed');
    this.clearSpotlight();
    this.cleanupResizeObserver();
    this.cleanupDOMObserver();
    this.cleanupFunctions.forEach(fn => fn());
    if (this.recalculateTimeout) {
      clearTimeout(this.recalculateTimeout);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && changes['isOpen'].currentValue === true && changes['isOpen'].previousValue === false) {
      console.log('[TourModal] isOpen changed to true, starting tour');
      this.startTour();
    }
  }

  private setupResizeObserver(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.checkMobile();
        this.scheduleRecalculation();
      });
      this.resizeObserver.observe(document.body);
    }
  }

  private setupDOMObserver(): void {
    this.domObserver = new MutationObserver(() => {
      this.scheduleRecalculation();
    });

    this.domObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden'],
    });
  }

  private cleanupResizeObserver(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }

  private cleanupDOMObserver(): void {
    if (this.domObserver) {
      this.domObserver.disconnect();
    }
  }

  private scheduleRecalculation(): void {
    if (this.recalculateTimeout) {
      clearTimeout(this.recalculateTimeout);
    }
    this.recalculateTimeout = setTimeout(() => {
      if (this.isOpen && this.currentStep?.target) {
        this.updateSpotlight(this.currentStep.target);
      }
    }, 100);
  }

  get totalSteps(): number {
    return this.tourConfig?.steps?.length || 0;
  }

  get isLastStep(): boolean {
    return this.currentIndex === this.totalSteps - 1;
  }

  get nextButtonText(): string {
    if (this.isProcessing) return 'Procesando...';
    if (this.currentIndex === 0) return 'Comenzar →';
    return this.isLastStep ? '✓ Terminar' : 'Siguiente →';
  }

  get progressPercentage(): number {
    if (this.totalSteps === 0) return 0;
    return ((this.currentIndex + 1) / this.totalSteps) * 100;
  }

  private setupPathListener(): void {
    this.ngZone.runOutsideAngular(() => {
      let lastPath = window.location.pathname;
      const checkPath = () => {
        const currentPath = window.location.pathname;
        if (currentPath !== lastPath && this.isOpen && this.currentStep) {
          lastPath = currentPath;
          console.log('[TourModal] Path changed:', currentPath);
          this.ngZone.run(() => {
            this.validateCurrentStep();
            setTimeout(() => {
              if (this.currentStep?.target) {
                this.updateSpotlight(this.currentStep.target);
              }
            }, 300);
          });
        }
      };

      window.addEventListener('popstate', checkPath);
      const interval = setInterval(checkPath, 500);

      this.cleanupFunctions.push(() => {
        window.removeEventListener('popstate', checkPath);
        clearInterval(interval);
      });
    });
  }

  private setupClickListener(): void {
    this.ngZone.runOutsideAngular(() => {
      this.clickListener = async (e: Event) => {
        if (!this.isOpen || !this.currentStep || this.isProcessing) return;

        // Skip click detection for first and last steps
        if (this.currentIndex === 0 || this.isLastStep) return;

        // Check both target (for spotlight) and autoAdvanceTarget (for click detection only)
        const target = this.getDeviceSelector(this.currentStep.target || '');
        const autoAdvanceTarget = this.getDeviceAutoAdvanceTarget();

        if (!target && !autoAdvanceTarget) return;

        const clickedElement = e.target as HTMLElement;
        if (!clickedElement) return;

        // Combine selectors from both target and autoAdvanceTarget
        const allSelectors = [];
        if (target) allSelectors.push(...target.split(',').map(s => s.trim()));
        if (autoAdvanceTarget) allSelectors.push(...autoAdvanceTarget.split(',').map(s => s.trim()));

        let isTargetClicked = false;

        for (const sel of allSelectors) {
          // Check if the clicked element or any of its parents match the selector
          const matched = clickedElement.closest(sel);
          if (matched) {
            isTargetClicked = true;
            console.log('[TourModal] Click detected on:', sel);
            break;
          }
        }

        if (isTargetClicked) {
          // Mobile: Close sidebar after clicking sidebar link
          if (this.isMobile && target?.includes('app-sidebar')) {
            setTimeout(() => this.closeMobileSidebarForTour(), 100);
          }

          // Wait a moment for the action to take effect
          await new Promise(resolve => setTimeout(resolve, 200));

          // Validate and advance if valid
          this.ngZone.run(() => {
            this.validateCurrentStep().then(isValid => {
              if (isValid) {
                console.log('[TourModal] Action completed, advancing to next step');
                if (this.isLastStep) {
                  this.completeTour();
                } else {
                  this.loadStep(this.currentIndex + 1);
                }
              }
            });
          });
        }
      };

      // Use capture phase to catch clicks before they're handled by other components
      document.addEventListener('click', this.clickListener, { capture: true });

      this.cleanupFunctions.push(() => {
        if (this.clickListener) {
          document.removeEventListener('click', this.clickListener, { capture: true });
        }
      });
    });
  }

  async loadStep(index: number): Promise<void> {
    if (index < 0 || index >= this.totalSteps) return;

    this.isProcessing = true;
    this.currentIndex = index;
    this.currentStep = this.tourConfig.steps[index];

    console.log(`[TourModal] Loading step ${index + 1}/${this.totalSteps}:`, {
      title: this.currentStep?.title,
      target: this.currentStep?.target
    });

    this.clearSpotlight();

    // Mobile: Open sidebar if target is in sidebar
    const deviceSelector = this.getDeviceSelector(this.currentStep?.target);
    if (this.isMobile && deviceSelector?.includes('app-sidebar')) {
      await this.openMobileSidebarForTour();
      // Wait for sidebar animation to complete
      await this.delay(200);
    }

    if (this.currentStep?.beforeShow) {
      try {
        await this.currentStep.beforeShow();
      } catch (error) {
        console.error('[TourModal] beforeShow error:', error);
      }
    }

    if (this.currentStep?.target || this.currentStep?.targetMobile || this.currentStep?.targetDesktop) {
      const deviceSelector = this.getDeviceSelector(this.currentStep.target);
      if (deviceSelector) {
        

        // On mobile, DON'T scroll to top for dynamic elements - they need to be in viewport
        if (this.isMobile ) {
          window.scrollTo({ top: 0, behavior: 'instant' });
          await this.delay(150);
        }

       
        const found = await this.waitForElement(deviceSelector);
        if (found) {
          await this.delay(100);
          this.updateSpotlight(deviceSelector);
        } else {
          console.warn('[TourModal] Element not found, centering tooltip');
          this.centerTooltip();
        }
      } else {
        this.centerTooltip();
      }
    } else {
      this.centerTooltip();
    }

    this.isProcessing = false;
  }

  private async waitForElement(selector: string, timeout = 8000): Promise<boolean> {
    return new Promise((resolve) => {
      console.log('[TourModal] Waiting for element:', selector, 'isMobile:', this.isMobile);

      // Check if this is a dynamic element
      const isDynamicElement = selector.includes('.product-card') ||
                               selector.includes('pos-product-selection');

      const check = () => {
        // Support multiple selectors separated by comma
        const selectors = selector.split(',').map(s => s.trim());
        console.log('[TourModal] Checking selectors:', selectors);

        for (const sel of selectors) {
          const el = document.querySelector(sel) as HTMLElement;
          if (el) {
            const isVisible = el.offsetWidth > 0 && el.offsetHeight > 0;
            const isDisplayed = window.getComputedStyle(el).display !== 'none';

            console.log('[TourModal] Found element:', sel, {
              visible: isVisible,
              displayed: isDisplayed,
              offsetWidth: el.offsetWidth,
              offsetHeight: el.offsetHeight,
              display: window.getComputedStyle(el).display,
            });

            if (isVisible && isDisplayed) {
              console.log('[TourModal] Element found and visible:', sel);
              resolve(true);
              return true;
            }
          }
        }
        return false;
      };

      if (check()) return;

      let attempts = 0;
      // For dynamic elements, check more frequently (every 50ms instead of 100ms)
      const checkInterval = isDynamicElement ? 50 : 100;
      const maxAttempts = timeout / checkInterval;

      // On mobile, scroll down periodically ONLY for non-dynamic elements
      let scrollInterval: any = null;
      if (this.isMobile && !isDynamicElement) {
        let scrollY = 0;
        const maxScroll = document.body.scrollHeight - window.innerHeight;
        scrollInterval = setInterval(() => {
          if (scrollY < maxScroll) {
            scrollY += 200;
            window.scrollTo({ top: scrollY, behavior: 'instant' });
            console.log(`[TourModal] Scrolling to find elements, y=${scrollY}`);
          }
        }, 1000);
      }

      const observer = new MutationObserver(() => {
        attempts++;
        console.log(`[TourModal] DOM changed, checking element (attempt ${attempts}/${maxAttempts})`);
        if (check()) {
          if (scrollInterval) clearInterval(scrollInterval);
          observer.disconnect();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style'],
      });

      setTimeout(() => {
        if (scrollInterval) clearInterval(scrollInterval);
        observer.disconnect();
        console.log('[TourModal] Timeout waiting for element:', selector);
        resolve(false);
      }, timeout);
    });
  }

  private updateSpotlight(selector: string): void {
    // Get device-specific selector if available
    const deviceSelector = this.getDeviceSelector(selector);

    // If no selector available, center tooltip
    if (!deviceSelector) {
      console.warn('[TourModal] No selector available for this step');
      this.spotlight.visible = false;
      this.centerTooltip();
      return;
    }

    // Support multiple selectors separated by comma - use the first one found
    const selectors = deviceSelector.split(',').map(s => s.trim());
    let element: HTMLElement | null = null;
    let foundSelector = deviceSelector;

    for (const sel of selectors) {
      const el = document.querySelector(sel) as HTMLElement;
      if (el) {
        element = el;
        foundSelector = sel;
        break;
      }
    }

    if (!element) {
      console.warn('[TourModal] Element not found:', deviceSelector);
      this.spotlight.visible = false;
      this.centerTooltip();
      return;
    }

    const rect = element.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) {
      console.warn('[TourModal] Element has no dimensions:', deviceSelector);
      this.spotlight.visible = false;
      this.centerTooltip();
      return;
    }

    this.spotlight = {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      visible: true,
    };

    this.highlightedElement = element;
    this.positionTooltip(rect);

    console.log('[TourModal] Spotlight:', {
      device: this.isMobile ? 'mobile' : 'desktop',
      selector: foundSelector,
      rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) }
    });

    if (rect.top < 50 || rect.bottom > window.innerHeight - 50) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /**
   * Get the device-specific selector for the current step
   * Falls back to the generic `target` if device-specific target is not provided
   */
  private getDeviceSelector(baseSelector: string | undefined): string | undefined {
    if (!this.currentStep) return baseSelector;

    // If no base selector, check device-specific first
    if (!baseSelector) {
      return this.isMobile ? this.currentStep.targetMobile : this.currentStep.targetDesktop;
    }

    // Use device-specific target if available, otherwise fall back to base selector
    if (this.isMobile && this.currentStep.targetMobile) {
      return this.currentStep.targetMobile;
    }
    if (!this.isMobile && this.currentStep.targetDesktop) {
      return this.currentStep.targetDesktop;
    }

    return baseSelector;
  }

  private positionTooltip(elementRect: DOMRect): void {
    const tooltipWidth = this.isMobile ? 280 : 380;
    const tooltipHeight = this.isMobile ? 180 : 220;
    const margin = this.isMobile ? 12 : 20;

    if (this.isMobile) {
      // Mobile: Smart positioning - place tooltip to NOT overlap the target element
      const safeAreaTop = this.env('safe-area-inset-top', 0);
      const safeAreaLeft = this.env('safe-area-inset-left', 0);
      const safeAreaBottom = this.env('safe-area-inset-bottom', 0);
      const safeAreaRight = this.env('safe-area-inset-right', 0);

      // Available viewport area
      const availableTop = margin + safeAreaTop;
      const availableBottom = window.innerHeight - margin - safeAreaBottom;
      const availableLeft = margin + safeAreaLeft;
      const availableRight = window.innerWidth - margin - safeAreaRight;

      // Check if target is in bottom footer (checkout button) by checking selector
      const deviceSelector = this.getDeviceSelector(this.currentStep?.target);
      const isFooterTarget = deviceSelector?.includes('pos-mobile-footer') || deviceSelector?.includes('checkout-btn');

      let top: number;
      let left: number;

      if (isFooterTarget && elementRect.bottom > availableBottom - 100) {
        // Footer checkout button - place tooltip ABOVE to avoid blocking
        top = elementRect.top - tooltipHeight - margin;
        left = elementRect.left + (elementRect.width / 2) - (tooltipWidth / 2);
        console.log('[TourModal] Footer checkout button detected, positioning above');
      } else if (elementRect.bottom + tooltipHeight + margin < availableBottom) {
        // DEFAULT: Place BELOW target first (better for sidebar, products, etc.)
        top = elementRect.bottom + margin;
        left = elementRect.left + (elementRect.width / 2) - (tooltipWidth / 2);
      } else if (elementRect.top - tooltipHeight - margin > availableTop) {
        // Place above target if no space below
        top = elementRect.top - tooltipHeight - margin;
        left = elementRect.left + (elementRect.width / 2) - (tooltipWidth / 2);
      } else if (elementRect.right + tooltipWidth + margin < availableRight) {
        // Place to the right of target
        top = elementRect.top;
        left = elementRect.right + margin;
      } else if (elementRect.left - tooltipWidth - margin > availableLeft) {
        // Place to the left of target
        top = elementRect.top;
        left = elementRect.left - tooltipWidth - margin;
      } else {
        // Target is too large or screen too small - place at top, center horizontally
        top = availableTop;
        left = availableLeft + ((availableRight - availableLeft - tooltipWidth) / 2);
      }

      // Ensure tooltip stays within viewport bounds
      left = Math.max(availableLeft, Math.min(left, availableRight - tooltipWidth));
      top = Math.max(availableTop, Math.min(top, availableBottom - tooltipHeight));

      this.tooltipPosition = { top, left };
      console.log('[TourModal] Mobile smart positioning:', { top, left, targetRect: elementRect, isFooterTarget });
      return;
    }

    // Desktop: Position near the highlighted element
    let top = elementRect.bottom + margin;
    let left = elementRect.left + (elementRect.width / 2) - (tooltipWidth / 2);

    if (top + tooltipHeight > window.innerHeight - margin) {
      top = elementRect.top - tooltipHeight - margin;
    }

    if (left < margin) left = margin;
    if (left + tooltipWidth > window.innerWidth - margin) {
      left = window.innerWidth - tooltipWidth - margin;
    }

    this.tooltipPosition = {
      top: Math.max(margin, top),
      left: Math.max(margin, left)
    };
  }

  // Helper to get safe area inset value
  private env(property: string, fallback: number): number {
    try {
      const value = getComputedStyle(document.documentElement)
        .getPropertyValue(property.replace('env(', '').replace(')', ''));
      return value ? parseInt(value, 10) || fallback : fallback;
    } catch {
      return fallback;
    }
  }

  private centerTooltip(): void {
    const tooltipWidth = this.isMobile ? 280 : 380;
    const tooltipHeight = this.isMobile ? 180 : 260;
    const margin = this.isMobile ? 12 : 20;

    if (this.isMobile) {
      // Mobile: Center in upper portion of screen, avoid blocking important content
      const safeAreaTop = this.env('safe-area-inset-top', 0);
      const safeAreaLeft = this.env('safe-area-inset-left', 0);

      // Position in upper-center area (top 20% of screen), centered horizontally
      // This leaves most of the screen accessible for user interaction
      const top = safeAreaTop + margin;
      const left = safeAreaLeft + ((window.innerWidth - (safeAreaLeft * 2) - tooltipWidth) / 2);

      this.tooltipPosition = {
        top: Math.max(margin, top),
        left: Math.max(margin, left)
      };
      console.log('[TourModal] Mobile centered positioning:', this.tooltipPosition);
      return;
    }

    // Desktop: Bottom-right corner
    this.tooltipPosition = {
      top: Math.max(margin, window.innerHeight - tooltipHeight - margin),
      left: Math.max(margin, window.innerWidth - tooltipWidth - margin)
    };
  }

  /**
   * Get the device-specific auto-advance target selector
   * Falls back to the generic `autoAdvanceTarget` if device-specific target is not provided
   */
  private getDeviceAutoAdvanceTarget(): string | undefined {
    if (!this.currentStep) return undefined;

    // Use device-specific target if available, otherwise fall back to base selector
    if (this.isMobile && this.currentStep.autoAdvanceTargetMobile) {
      return this.currentStep.autoAdvanceTargetMobile;
    }
    if (!this.isMobile && this.currentStep.autoAdvanceTargetDesktop) {
      return this.currentStep.autoAdvanceTargetDesktop;
    }

    return this.currentStep.autoAdvanceTarget;
  }

  private clearSpotlight(): void {
    this.spotlight = {
      top: 0,
      left: 0,
      width: 0,
      height: 0,
      visible: false,
    };
    this.highlightedElement = null;
  }

  private async validateCurrentStep(): Promise<boolean> {
    if (!this.currentStep?.beforeNext) return true;

    try {
      const canProceed = await this.currentStep.beforeNext();
      return canProceed;
    } catch (error) {
      console.error('[TourModal] Validation error:', error);
      return false;
    }
  }

  async nextStep(): Promise<void> {
    if (this.isProcessing) return;

    if (this.currentIndex === 0) {
      await this.loadStep(1);
      return;
    }

    const isValid = await this.validateCurrentStep();
    if (!isValid) {
      console.log('[TourModal] Cannot proceed - action not completed');
      return;
    }

    if (this.isLastStep) {
      this.completeTour();
    } else {
      await this.loadStep(this.currentIndex + 1);
    }
  }

  async previousStep(): Promise<void> {
    if (this.currentIndex > 0 && !this.isProcessing) {
      await this.loadStep(this.currentIndex - 1);
    }
  }

  completeTour(): void {
    console.log('[TourModal] Tour completed');
    this.clearSpotlight();
    this.tourService.completeTour(this.tourConfig.id);
    this.isOpen = false;
    this.isOpenChange.emit(false);
    this.completed.emit();
  }

  skipTour(): void {
    console.log('[TourModal] Tour skipped');
    this.clearSpotlight();
    this.tourService.skipTour(this.tourConfig.id);
    this.isOpen = false;
    this.isOpenChange.emit(false);
    this.skipped.emit();
  }

  async startTour(): Promise<void> {
    console.log('[TourModal] Starting tour');
    this.currentIndex = 0;
    this.currentStep = this.tourConfig.steps[0];

    console.log(`[TourModal] Loading step 1/${this.totalSteps}:`, {
      title: this.currentStep?.title,
      target: this.currentStep?.target
    });

    // Clear any existing spotlight
    this.clearSpotlight();

    // Position tooltip first
    this.centerTooltip();

    // Show the tooltip
    this.isOpen = true;
    this.isOpenChange.emit(true);

    // Wait for Angular to render, then run hooks
    await this.delay(100);

    if (this.currentStep?.beforeShow) {
      try {
        await this.currentStep.beforeShow();
      } catch (error) {
        console.error('[TourModal] beforeShow error:', error);
      }
    }

    // If there's a target, wait for it and update spotlight
    if (this.currentStep?.target || this.currentStep?.targetMobile || this.currentStep?.targetDesktop) {
      const deviceSelector = this.getDeviceSelector(this.currentStep.target);
      if (deviceSelector) {
        // Check if this is a dynamic element (generated by ngFor like product cards)
        const isDynamicElement = deviceSelector.includes('.product-card') ||
                                 deviceSelector.includes('pos-product-selection');

        // On mobile, DON'T scroll to top for dynamic elements - they need to be in viewport
        if (this.isMobile && !isDynamicElement) {
          window.scrollTo({ top: 0, behavior: 'instant' });
          await this.delay(150);
        }

        // Use longer timeout for dynamic elements (API call + Angular rendering)
        const timeout = this.isMobile ? (isDynamicElement ? 10000 : 6000) : 8000;
        const found = await this.waitForElement(deviceSelector, timeout);
        if (found) {
          await this.delay(100);
          this.updateSpotlight(deviceSelector);
        } else {
          console.warn('[TourModal] Element not found in startTour, centering tooltip');
        }
      }
    }

    this.isProcessing = false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async openMobileSidebarForTour(): Promise<void> {
    // Try multiple selectors for the hamburger button
    const selectors = [
      'button[aria-label="Abrir menú"]',           // Mobile button with logo
      'button[aria-label="Toggle sidebar"]',       // Desktop hamburger
      'header button:first-child',                  // First button in header
      '.desktop-menu-btn',                          // Desktop menu button class
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector) as HTMLElement;
      if (button) {
        button.click();
        console.log('[TourModal] Opened mobile sidebar using selector:', selector);
        return;
      }
    }

    console.warn('[TourModal] Could not find hamburger button to open sidebar');
  }

  private closeMobileSidebarForTour(): void {
    const sidebar = document.querySelector('app-sidebar') as HTMLElement;
    if (!sidebar) return;

    // Close the mobile sidebar by clicking the close button or backdrop
    const closeButton = document.querySelector('.sidebar-mobile-close') as HTMLElement;
    const backdrop = document.querySelector('.sidebar-backdrop') as HTMLElement;

    if (closeButton) {
      closeButton.click();
      console.log('[TourModal] Closed mobile sidebar after navigation');
    } else if (backdrop) {
      backdrop.click();
      console.log('[TourModal] Closed mobile sidebar via backdrop');
    }
  }

  /**
   * Toggle minimize state on mobile to reduce tooltip size
   * when user needs to interact with the highlighted element
   */
  toggleMinimize(): void {
    this.isMinimized = !this.isMinimized;
    console.log('[TourModal] Tooltip minimized:', this.isMinimized);
  }
}
