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

    <!-- Tour Tooltip -->
    <div
      *ngIf="isOpen"
      class="tour-tooltip"
      [style.top.px]="tooltipPosition.top"
      [style.left.px]="tooltipPosition.left"
    >
      <div class="tooltip-header">
        <h3 class="tooltip-title">{{ currentStep?.title }}</h3>
      </div>

      <div class="tooltip-content">
        <p class="tooltip-description">{{ currentStep?.description }}</p>

        <p *ngIf="currentStep?.action" class="tooltip-action">
          👆 {{ currentStep?.action }}
        </p>
      </div>

      <!-- Footer Navigation -->
      <div class="tooltip-footer">
        <div class="flex items-center gap-2">
          <app-button
            variant="outline"
            size="xsm"
            (clicked)="skipTour()"
          >
            Saltar
          </app-button>
        </div>

        <div class="flex items-center gap-2">
          <span class="tour-progress">{{ currentIndex + 1 }}/{{ totalSteps }}</span>

          <app-button
            *ngIf="currentIndex > 0"
            variant="outline"
            size="xsm"
            (clicked)="previousStep()"
          >
            ←
          </app-button>

          <app-button
            variant="primary"
            size="xsm"
            (clicked)="nextStep()"
            [disabled]="isProcessing"
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

    .tour-spotlight-overlay {
      position: fixed;
      z-index: 10001;
      pointer-events: none !important;
      border-radius: 8px;
      box-shadow:
        0 0 0 2px var(--color-primary, #10B981),
        0 0 20px var(--color-primary, #10B981),
        0 0 0 9999px rgba(0, 0, 0, 0.75);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      animation: spotlight-pulse 2s ease-in-out infinite;
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

    .tour-tooltip {
      position: fixed;
      z-index: 10002;
      background: var(--color-surface, #1e1e1e);
      border: 2px solid var(--color-primary, #10B981);
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
      max-width: 400px;
      min-width: 320px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .tooltip-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 16px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .tooltip-title {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      color: var(--color-text-primary, #fff);
    }

    .tooltip-close {
      background: none;
      border: none;
      color: var(--color-text-secondary, #999);
      cursor: pointer;
      font-size: 1.3rem;
      padding: 0;
      width: 26px;
      height: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      transition: all 0.2s;
    }

    .tooltip-close:hover {
      background: var(--color-background, #2a2a2a);
      color: var(--color-text-primary, #fff);
    }

    .tooltip-content {
      padding: 14px 16px;
    }

    .tooltip-description {
      margin: 0 0 8px;
      font-size: 0.9rem;
      line-height: 1.5;
      color: var(--color-text-primary, #fff);
    }

    .tooltip-action {
      margin: 0;
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--color-primary, #10B981);
    }

    .tooltip-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px 14px;
    }

    .tour-progress {
      font-size: 0.8rem;
      color: var(--color-text-secondary, #999);
      font-weight: 600;
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
    this.setupResizeObserver();
    this.setupDOMObserver();
    this.setupPathListener();
    this.setupClickListener();
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
        const target = this.currentStep.target;
        const autoAdvanceTarget = this.currentStep.autoAdvanceTarget;

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

    if (this.currentStep?.beforeShow) {
      try {
        await this.currentStep.beforeShow();
      } catch (error) {
        console.error('[TourModal] beforeShow error:', error);
      }
    }

    if (this.currentStep?.target) {
      await this.waitForElement(this.currentStep.target);
      await this.delay(200);
      this.updateSpotlight(this.currentStep.target);
    } else {
      this.centerTooltip();
    }

    this.isProcessing = false;
  }

  private async waitForElement(selector: string, timeout = 8000): Promise<boolean> {
    return new Promise((resolve) => {
      const check = () => {
        // Support multiple selectors separated by comma
        const selectors = selector.split(',').map(s => s.trim());
        for (const sel of selectors) {
          const el = document.querySelector(sel) as HTMLElement;
          if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
            console.log('[TourModal] Element found:', sel);
            resolve(true);
            return true;
          }
        }
        return false;
      };

      if (check()) return;

      const observer = new MutationObserver(() => {
        if (check()) observer.disconnect();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style'],
      });

      setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, timeout);
    });
  }

  private updateSpotlight(selector: string): void {
    // Support multiple selectors separated by comma - use the first one found
    const selectors = selector.split(',').map(s => s.trim());
    let element: HTMLElement | null = null;
    let foundSelector = selector;

    for (const sel of selectors) {
      const el = document.querySelector(sel) as HTMLElement;
      if (el) {
        element = el;
        foundSelector = sel;
        break;
      }
    }

    if (!element) {
      console.warn('[TourModal] Element not found:', selector);
      this.spotlight.visible = false;
      this.centerTooltip();
      return;
    }

    const rect = element.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) {
      console.warn('[TourModal] Element has no dimensions:', selector);
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
      selector: foundSelector,
      rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) }
    });

    if (rect.top < 50 || rect.bottom > window.innerHeight - 50) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  private positionTooltip(elementRect: DOMRect): void {
    const tooltipWidth = 380;
    const tooltipHeight = 220;
    const margin = 20;

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

  private centerTooltip(): void {
    const tooltipWidth = 380;
    const margin = 20;

    // Position in bottom-right corner to avoid blocking modals/forms
    this.tooltipPosition = {
      top: Math.max(margin, window.innerHeight - 260 - margin),
      left: Math.max(margin, window.innerWidth - tooltipWidth - margin)
    };
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
    if (this.currentStep?.target) {
      await this.waitForElement(this.currentStep.target);
      await this.delay(200);
      this.updateSpotlight(this.currentStep.target);
    }

    this.isProcessing = false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
