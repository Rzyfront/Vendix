import { Component, input, output, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProductFormWizardService, StepValidity } from '../../../services/product-form-wizard.service';
import { BadgeComponent, IconComponent } from '../../../../../../../shared/components';

@Component({
  selector: 'app-wizard-checklist',
  standalone: true,
  imports: [CommonModule, BadgeComponent, IconComponent],
  template: `
    <div class="checklist-panel">
      <h3 class="checklist-title">Progreso</h3>
      
      <div class="completion-bar">
        <div class="completion-info">
          <span class="completion-percent">{{ wizardService.completionPercent() }}%</span>
          <span class="completion-label">completado</span>
        </div>
        <div class="bar-track">
          <div 
            class="bar-fill" 
            [style.width.%]="wizardService.completionPercent()"
          ></div>
        </div>
      </div>

      <ul class="steps-list">
        @for (step of wizardService.stepValidity(); track step.stepIndex) {
          <li 
            class="step-item"
            [class.active]="step.stepIndex === wizardService.currentStep()"
            [class.completed]="step.isValid"
            [class.invalid]="!step.isValid && step.completionPercent > 0"
            (click)="onStepClick(step.stepIndex)"
          >
            <div class="step-indicator">
              @if (step.isValid) {
                <app-icon name="check" [size]="14" />
              } @else {
                <span class="step-number">{{ step.stepIndex + 1 }}</span>
              }
            </div>
            <div class="step-content">
              <span class="step-name">{{ step.stepName }}</span>
              @if (!step.isValid && step.errors.length > 0) {
                <span class="step-errors">{{ step.errors[0] }}</span>
              }
            </div>
            @if (step.completionPercent > 0) {
              <app-badge [variant]="step.isValid ? 'success' : 'warning'">{{ step.completionPercent }}%</app-badge>
            }
          </li>
        }
      </ul>

      <div class="checklist-footer">
        <button 
          type="button"
          class="btn-reset"
          (click)="onReset()"
        >
          Reiniciar
        </button>
      </div>
    </div>
  `,
  styles: [`
    .checklist-panel {
      padding: 1rem;
      background: var(--color-surface);
      border-radius: 12px;
      border: 1px solid var(--color-border);
    }

    .checklist-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-text-primary);
      margin: 0 0 1rem 0;
    }

    .completion-bar {
      margin-bottom: 1.5rem;
    }

    .completion-info {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.5rem;
    }

    .completion-percent {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--color-primary);
    }

    .completion-label {
      font-size: 0.75rem;
      color: var(--color-text-secondary);
    }

    .bar-track {
      height: 6px;
      background: var(--color-border);
      border-radius: 3px;
      overflow: hidden;
    }

    .bar-fill {
      height: 100%;
      background: var(--color-primary);
      border-radius: 3px;
      transition: width 0.3s ease;
    }

    .steps-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .step-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
      border: 1px solid transparent;
    }

    .step-item:hover {
      background: var(--color-background);
    }

    .step-item.active {
      background: color-mix(in srgb, var(--color-primary) 10%, transparent);
      border-color: var(--color-primary);
    }

    .step-item.completed .step-indicator {
      background: var(--color-success);
      color: white;
    }

    .step-item.invalid .step-indicator {
      background: var(--color-warning);
      color: white;
    }

    .step-indicator {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-border);
      color: var(--color-text-secondary);
      font-size: 0.75rem;
      font-weight: 600;
      flex-shrink: 0;
    }

    .step-number {
      line-height: 1;
    }

    .step-content {
      flex: 1;
      min-width: 0;
    }

    .step-name {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-text-primary);
      display: block;
    }

    .step-errors {
      font-size: 0.75rem;
      color: var(--color-error);
      display: block;
      margin-top: 2px;
    }

    .checklist-footer {
      margin-top: 1.5rem;
      padding-top: 1rem;
      border-top: 1px solid var(--color-border);
    }

    .btn-reset {
      width: 100%;
      padding: 0.5rem;
      border: 1px solid var(--color-border);
      background: transparent;
      border-radius: 6px;
      font-size: 0.875rem;
      color: var(--color-text-secondary);
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .btn-reset:hover {
      background: var(--color-background);
      border-color: var(--color-text-secondary);
    }
  `]
})
export class WizardChecklistComponent {
  readonly wizardService = inject(ProductFormWizardService);
  
  readonly stepClicked = output<number>();
  readonly resetClicked = output<void>();

  onStepClick(index: number): void {
    this.stepClicked.emit(index);
  }

  onReset(): void {
    this.resetClicked.emit();
  }
}
