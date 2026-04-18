import { Component, input, output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProductFormWizardService } from '../../../services/product-form-wizard.service';
import { StepsLineComponent, StepsLineItem, ButtonComponent, IconComponent } from '../../../../../../../shared/components';

@Component({
  selector: 'app-product-wizard-shell',
  standalone: true,
  imports: [CommonModule, StepsLineComponent, ButtonComponent, IconComponent],
  template: `
    <div class="wizard-container">
      <!-- Desktop: vertical layout with sidebar -->
      <div class="wizard-desktop">
        <aside class="wizard-sidebar">
          <ng-content select="[sidebar]"></ng-content>
        </aside>
        
        <main class="wizard-main">
          <div class="wizard-header">
            <app-steps-line
              [steps]="stepItems()"
              [currentStep]="wizardService.currentStep()"
              orientation="vertical"
              [clickable]="true"
              (stepClicked)="onStepClick($event)"
            />
          </div>
          
          <div class="wizard-content">
            <ng-content></ng-content>
          </div>
          
          <footer class="wizard-footer">
            <app-button
              variant="outline"
              [disabled]="wizardService.isFirstStep()"
              (onClick)="onPrevious()"
            >
              <app-icon name="chevron-left" [size]="16" />
              Anterior
            </app-button>
            
            @if (wizardService.isLastStep()) {
              <app-button
                variant="primary"
                [loading]="isSubmitting()"
                [disabled]="!wizardService.globalValid()"
                (onClick)="onSubmit()"
              >
                {{ submitLabel() }}
              </app-button>
            } @else {
              <app-button
                variant="primary"
                [disabled]="!canGoNext()"
                (onClick)="onNext()"
              >
                Siguiente
                <app-icon name="chevron-right" [size]="16" />
              </app-button>
            }
          </footer>
        </main>
      </div>

      <!-- Mobile: horizontal steps at top -->
      <div class="wizard-mobile">
        <div class="mobile-steps-header">
          <app-steps-line
            [steps]="stepItems()"
            [currentStep]="wizardService.currentStep()"
            orientation="horizontal"
            size="sm"
          />
        </div>
        
        <div class="mobile-content">
          <ng-content></ng-content>
        </div>
        
        <div class="mobile-footer">
          <app-button
            variant="outline"
            [disabled]="wizardService.isFirstStep()"
            (onClick)="onPrevious()"
          >
            <app-icon name="chevron-left" [size]="16" />
          </app-button>
          
          <span class="mobile-step-indicator">
            {{ wizardService.currentStep() + 1 }} / {{ wizardService.steps().length }}
          </span>
          
          @if (wizardService.isLastStep()) {
            <app-button
              variant="primary"
              [loading]="isSubmitting()"
              [disabled]="!wizardService.globalValid()"
              (onClick)="onSubmit()"
            >
              {{ submitLabel() }}
            </app-button>
          } @else {
            <app-button
              variant="primary"
              [disabled]="!canGoNext()"
              (onClick)="onNext()"
            >
              <app-icon name="chevron-right" [size]="16" />
            </app-button>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .wizard-container {
      width: 100%;
      min-height: 100%;
    }

    /* Desktop layout */
    .wizard-desktop {
      display: none;
    }

    .wizard-mobile {
      display: flex;
      flex-direction: column;
      min-height: calc(100vh - 200px);
    }

    @media (min-width: 1024px) {
      .wizard-desktop {
        display: grid;
        grid-template-columns: 280px 1fr;
        gap: 1.5rem;
        min-height: calc(100vh - 250px);
      }

      .wizard-mobile {
        display: none;
      }
    }

    .wizard-sidebar {
      background: var(--color-surface);
      border-radius: 12px;
      border: 1px solid var(--color-border);
      padding: 1rem;
      height: fit-content;
      position: sticky;
      top: 1rem;
    }

    .wizard-main {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .wizard-header {
      background: var(--color-surface);
      border-radius: 12px;
      border: 1px solid var(--color-border);
      padding: 1rem;
    }

    .wizard-content {
      flex: 1;
    }

    .wizard-footer {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      padding: 1rem;
      background: var(--color-surface);
      border-radius: 12px;
      border: 1px solid var(--color-border);
    }

    /* Mobile layout */
    .mobile-steps-header {
      background: var(--color-surface);
      border-radius: 12px;
      border: 1px solid var(--color-border);
      padding: 0.75rem;
      margin-bottom: 1rem;
    }

    .mobile-content {
      flex: 1;
      padding: 0 0.5rem;
    }

    .mobile-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      padding: 1rem;
      background: var(--color-surface);
      border-radius: 12px;
      border: 1px solid var(--color-border);
      margin-top: 1rem;
    }

    .mobile-step-indicator {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-text-secondary);
    }

    @media (min-width: 1024px) {
      .wizard-footer {
        position: sticky;
        bottom: 1rem;
      }
    }
  `]
})
export class ProductWizardShellComponent {
  readonly wizardService = inject(ProductFormWizardService);
  
  readonly isSubmitting = input<boolean>(false);
  readonly submitLabel = input<string>('Crear Producto');
  
  readonly previous = output<void>();
  readonly next = output<void>();
  readonly submit = output<void>();
  readonly stepChange = output<number>();

  readonly stepItems = computed<StepsLineItem[]>(() =>
    this.wizardService.steps().map((step) => ({
      label: step.name,
      completed: this.wizardService
        .stepValidity()
        .find((s) => s.stepName === step.name)?.isValid ?? false,
    }))
  );

  readonly canGoNext = computed(() => {
    const currentValidity = this.wizardService.stepValidity()[
      this.wizardService.currentStep()
    ];
    return currentValidity?.completionPercent > 0;
  });

  onStepClick(index: number): void {
    this.wizardService.goToStep(index);
    this.stepChange.emit(index);
  }

  onPrevious(): void {
    this.wizardService.previousStep();
    this.previous.emit();
  }

  onNext(): void {
    this.wizardService.nextStep();
    this.next.emit();
  }

  onSubmit(): void {
    this.submit.emit();
  }
}
