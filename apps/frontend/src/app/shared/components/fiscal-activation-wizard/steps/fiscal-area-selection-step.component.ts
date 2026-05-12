import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { FiscalActivationWizardService } from '../../../../core/services/fiscal-activation-wizard.service';
import {
  FISCAL_AREAS,
  FISCAL_AREA_LABELS,
  FiscalArea,
  FiscalWizardStepId,
} from '../../../../core/models/fiscal-status.model';
import { FiscalWizardStepHost } from '../wizard-step.contract';
import { parseApiError } from '../../../../core/utils/parse-api-error';

const AREA_DESCRIPTIONS: Record<FiscalArea, string> = {
  invoicing: 'DIAN, resoluciones, CUFE y facturas electrónicas.',
  accounting: 'PUC, periodos, mapeos, impuestos y cartera.',
  payroll: 'Empleados, periodos, pagos y soportes de nómina.',
};

@Component({
  selector: 'app-fiscal-area-selection-step',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="area-step">
      <div class="area-options">
        @for (area of areas; track area) {
          <label class="area-option">
            <input
              type="checkbox"
              [checked]="isSelected(area)"
              [disabled]="submitting()"
              (change)="toggleArea(area)"
            />
            <span>
              <strong>{{ areaLabels[area] }}</strong>
              <small>{{ descriptions[area] }}</small>
            </span>
          </label>
        }
      </div>

      @if (localError()) {
        <p class="step-error" role="alert">{{ localError() }}</p>
      }
    </div>
  `,
  styles: [
    `
      .area-step {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .area-options {
        display: grid;
        gap: 0.75rem;
      }
      .area-option {
        display: flex;
        align-items: flex-start;
        gap: 0.7rem;
        padding: 0.85rem;
        border: 1px solid var(--border-color, #e5e7eb);
        border-radius: 0.5rem;
        background: var(--surface-color, #ffffff);
      }
      .area-option input {
        margin-top: 0.2rem;
      }
      .area-option span {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
      }
      .area-option small {
        color: var(--text-secondary, #64748b);
        line-height: 1.25rem;
      }
      .step-error {
        margin: 0;
        font-size: 0.85rem;
        color: var(--color-destructive, #b91c1c);
      }
    `,
  ],
})
export class FiscalAreaSelectionStepComponent implements FiscalWizardStepHost {
  private readonly service = inject(FiscalActivationWizardService);

  readonly stepId: FiscalWizardStepId = 'area_selection';
  readonly areas = FISCAL_AREAS;
  readonly areaLabels = FISCAL_AREA_LABELS;
  readonly descriptions = AREA_DESCRIPTIONS;

  readonly submitting = signal(false);
  readonly localError = signal<string | null>(null);

  readonly valid = computed(() => this.service.selectedAreas().length > 0);

  isSelected(area: FiscalArea): boolean {
    return this.service.selectedAreas().includes(area);
  }

  toggleArea(area: FiscalArea): void {
    const current = new Set(this.service.selectedAreas());
    if (current.has(area)) current.delete(area);
    else current.add(area);
    this.service.selectedAreas.set(Array.from(current));
  }

  async submit(): Promise<{ ref: Record<string, unknown> } | null> {
    if (!this.valid()) return null;
    this.submitting.set(true);
    this.localError.set(null);
    try {
      const selected = this.service.selectedAreas();
      await this.service.startWizard(selected);
      return { ref: { selected_areas: selected } };
    } catch (e) {
      this.localError.set(parseApiError(e).userMessage);
      return null;
    } finally {
      this.submitting.set(false);
    }
  }
}
