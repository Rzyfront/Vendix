import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { FiscalActivationWizardService } from '../../../../core/services/fiscal-activation-wizard.service';
import {
  FISCAL_STEP_LABELS,
  FiscalWizardStepId,
  REQUIRED_STEPS_BY_AREA,
} from '../../../../core/models/fiscal-status.model';
import { FiscalWizardStepHost } from '../wizard-step.contract';
import { IconComponent } from '../../icon/icon.component';
import { parseApiError } from '../../../../core/utils/parse-api-error';

interface ValidationRow {
  step: FiscalWizardStepId;
  label: string;
  completed: boolean;
  summary: string;
}

@Component({
  selector: 'app-fiscal-validation-step',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="validation-step">
      <div class="validation-list">
        @for (row of rows(); track row.step) {
          <div
            class="validation-row"
            [class.validation-row--missing]="!row.completed"
          >
            <span class="validation-state">
              @if (row.completed) {
                <app-icon name="check" [size]="14"></app-icon>
              } @else {
                <app-icon name="alert-circle" [size]="14"></app-icon>
              }
            </span>
            <div>
              <strong>{{ row.label }}</strong>
              <small>{{ row.summary }}</small>
            </div>
          </div>
        }
      </div>

      @if (missingLabels().length) {
        <p class="step-warning" role="status">
          Faltan pasos para finalizar: {{ missingLabels().join(', ') }}
        </p>
      }

      @if (localError()) {
        <p class="step-error" role="alert">{{ localError() }}</p>
      }
    </div>
  `,
  styles: [
    `
      .validation-step {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .validation-list {
        display: grid;
        gap: 0.6rem;
      }
      .validation-row {
        display: flex;
        align-items: flex-start;
        gap: 0.7rem;
        padding: 0.85rem;
        border: 1px solid var(--border-color, #e5e7eb);
        border-radius: 0.5rem;
        background: var(--surface-color, #ffffff);
      }
      .validation-state {
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        width: 1.45rem;
        height: 1.45rem;
        border-radius: 999px;
        background: color-mix(
          in srgb,
          var(--success-color, #16a34a) 14%,
          #ffffff
        );
        color: var(--success-color, #166534);
      }
      .validation-row--missing .validation-state {
        background: color-mix(
          in srgb,
          var(--warning-color, #f59e0b) 14%,
          #ffffff
        );
        color: var(--warning-color, #92400e);
      }
      .validation-row strong {
        display: block;
        font-size: 0.95rem;
        color: var(--text-primary, #0f172a);
      }
      .validation-row small {
        color: var(--text-secondary, #64748b);
        font-size: 0.85rem;
        line-height: 1.25rem;
      }
      .step-warning {
        margin: 0;
        font-size: 0.85rem;
        color: var(--warning-color, #92400e);
      }
      .step-error {
        margin: 0;
        font-size: 0.85rem;
        color: var(--color-destructive, #b91c1c);
      }
    `,
  ],
})
export class FiscalValidationStepComponent implements FiscalWizardStepHost {
  private readonly service = inject(FiscalActivationWizardService);

  readonly stepId: FiscalWizardStepId = 'validation';
  readonly submitting = signal(false);
  readonly localError = signal<string | null>(null);

  private readonly stepLabels = FISCAL_STEP_LABELS;

  readonly requiredSteps = computed<FiscalWizardStepId[]>(() => {
    const acc = new Set<FiscalWizardStepId>();
    this.service.selectedAreas().forEach((area) => {
      REQUIRED_STEPS_BY_AREA[area]
        .filter((s) => s !== 'validation' && s !== 'area_selection')
        .forEach((s) => acc.add(s));
    });
    return Array.from(acc);
  });

  readonly rows = computed<ValidationRow[]>(() => {
    const completed = new Set(this.service.completedSteps());
    const refs = this.service.stepRefs() as Record<
      string,
      Record<string, unknown> | undefined
    >;
    return this.requiredSteps().map((step) => {
      const ref = refs[step];
      const completedAt =
        ref && typeof ref['completed_at'] === 'string'
          ? (ref['completed_at'] as string).slice(0, 10)
          : null;
      const isDone = completed.has(step);
      return {
        step,
        label: this.stepLabels[step],
        completed: isDone,
        summary: isDone
          ? completedAt
            ? `Configurado el ${completedAt}`
            : 'Configurado'
          : 'Pendiente',
      };
    });
  });

  readonly missingLabels = computed<string[]>(() =>
    this.rows()
      .filter((r) => !r.completed)
      .map((r) => r.label),
  );

  readonly valid = computed(() => this.missingLabels().length === 0);

  async submit(): Promise<{ ref: Record<string, unknown> } | null> {
    if (!this.valid()) return null;
    this.submitting.set(true);
    this.localError.set(null);
    try {
      await this.service.finalize();
      return {
        ref: {
          finalized_at: new Date().toISOString(),
          areas: this.service.selectedAreas(),
        },
      };
    } catch (e) {
      this.localError.set(parseApiError(e).userMessage);
      return null;
    } finally {
      this.submitting.set(false);
    }
  }
}
