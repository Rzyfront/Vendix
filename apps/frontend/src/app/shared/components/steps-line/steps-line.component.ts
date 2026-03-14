import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface StepsLineItem {
  label: string;
  completed?: boolean;
}

export type StepsLineSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-steps-line',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="steps-container" [class]="'size-' + size">
      <div class="steps-wrapper" [class.vertical]="orientation === 'vertical'">
        @for (step of steps; track step.label; let i = $index) {
          <!-- Line connector (before each step except first) -->
          @if (i > 0) {
            <div
              class="step-line"
              [class.line-completed]="i <= currentStep"
              [style.--primary-color]="primaryColor"
              [style.--secondary-color]="secondaryColor"
            ></div>
          }

          <!-- Step circle and label -->
          <div
            class="step-item"
            [class.step-completed]="i < currentStep"
            [class.step-current]="i === currentStep"
            [class.step-pending]="i > currentStep"
            [style.--primary-color]="primaryColor"
            [style.--secondary-color]="secondaryColor"
          >
            <div class="step-circle">
              @if (i < currentStep) {
                <!-- Completed - checkmark -->
                <svg
                  class="check-icon"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              } @else {
                <!-- Number or current state -->
                <span class="step-number">{{ i + 1 }}</span>
              }
            </div>
            <span class="step-label">{{ step.label }}</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }

      .steps-container {
        width: 100%;
        padding: 1rem 0;
      }

      .steps-wrapper {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        gap: 0;
        margin-bottom: 0.5rem;
      }

      .steps-wrapper.vertical {
        flex-direction: column;
        gap: 0;
      }

      /* ========== SIZE: SM ========== */
      .size-sm .step-circle {
        width: 1.5rem;
        height: 1.5rem;
        font-size: 0.65rem;
        border-width: 1.5px;
      }

      .size-sm .check-icon {
        width: 10px;
        height: 10px;
      }

      .size-sm .step-label {
        font-size: 0.65rem;
      }

      .size-sm .step-line {
        height: 1.5px;
        min-width: 16px;
      }

      .size-sm .step-item {
        gap: 0.375rem;
        padding-bottom: 1rem;
      }

      .size-sm.steps-wrapper.vertical .step-line {
        width: 1.5px;
        height: auto;
        min-height: 16px;
        min-width: unset;
      }

      /* ========== SIZE: MD (default) ========== */
      .size-md .step-circle {
        width: 2rem;
        height: 2rem;
        font-size: 0.75rem;
        border-width: 2px;
      }

      .size-md .check-icon {
        width: 14px;
        height: 14px;
      }

      .size-md .step-label {
        font-size: 0.75rem;
      }

      .size-md .step-line {
        height: 2px;
        min-width: 20px;
      }

      .size-md .step-item {
        gap: 0.5rem;
        padding-bottom: 1rem;
      }

      .size-md.steps-wrapper.vertical .step-line {
        width: 2px;
        height: auto;
        min-height: 20px;
        min-width: unset;
      }

      /* ========== SIZE: LG ========== */
      .size-lg .step-circle {
        width: 2.5rem;
        height: 2.5rem;
        font-size: 0.875rem;
        border-width: 2.5px;
      }

      .size-lg .check-icon {
        width: 18px;
        height: 18px;
      }

      .size-lg .step-label {
        font-size: 0.875rem;
      }

      .size-lg .step-line {
        height: 3px;
        min-width: 28px;
      }

      .size-lg .step-item {
        gap: 0.625rem;
        padding-bottom: 1.25rem;
      }

      .size-lg.steps-wrapper.vertical .step-line {
        width: 3px;
        height: auto;
        min-height: 28px;
        min-width: unset;
      }

      /* ========== BASE STYLES (for all sizes) ========== */

      /* Line between steps */
      .step-line {
        flex: 1;
        background-color: var(--color-border, #e2e8f0);
        transition: background-color 0.3s ease;
      }

      .step-line.line-completed {
        background-color: var(--primary-color, var(--color-primary, #3b82f6));
      }

      /* Step item container */
      .step-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        flex-shrink: 0;
      }

      /* Step circle */
      .step-circle {
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        transition: all 0.3s ease;
        background-color: var(--color-background, #f8fafc);
        color: var(--color-text-secondary, #64748b);
        border: 2px solid var(--color-border, #e2e8f0);
      }

      .step-number {
        line-height: 1;
      }

      /* Step label */
      .step-label {
        font-weight: 500;
        color: var(--color-text-secondary, #64748b);
        white-space: nowrap;
        transition: color 0.3s ease;
      }

      /* Completed state */
      .step-item.step-completed .step-circle {
        background-color: var(--primary-color, var(--color-primary, #3b82f6));
        border-color: var(--primary-color, var(--color-primary, #3b82f6));
        color: white;
      }

      .step-item.step-completed .step-label {
        color: var(--primary-color, var(--color-primary, #3b82f6));
      }

      /* Current state */
      .step-item.step-current .step-circle {
        background-color: var(
          --secondary-color,
          var(--color-secondary, #f1f5f9)
        );
        border-color: var(--primary-color, var(--color-primary, #3b82f6));
        color: var(--primary-color, var(--color-primary, #3b82f6));
        box-shadow: 0 0 0 3px
          var(--primary-color, var(--color-primary, #3b82f6));
      }

      .step-item.step-current .step-label {
        color: var(--primary-color, var(--color-primary, #3b82f6));
        font-weight: 600;
      }

      /* Pending state */
      .step-item.step-pending .step-circle {
        background-color: var(--color-background, #f8fafc);
        border-color: var(--color-border, #e2e8f0);
        color: var(--color-text-secondary, #64748b);
      }

      .step-item.step-pending .step-label {
        color: var(--color-text-secondary, #64748b);
      }

      /* Responsive - hide label on small screens */
      @media (max-width: 640px) {
        .step-label {
          display: none;
        }
      }
    `,
  ],
})
export class StepsLineComponent {
  @Input() steps: StepsLineItem[] = [];
  @Input() currentStep = 0;
  @Input() primaryColor = 'var(--color-primary, #3b82f6)';
  @Input() secondaryColor = 'var(--color-secondary, #f1f5f9)';
  @Input() size: StepsLineSize = 'md';
  @Input() orientation: 'horizontal' | 'vertical' = 'horizontal';
}
