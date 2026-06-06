import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { FiscalActivationWizardService } from '../../../../core/services/fiscal-activation-wizard.service';
import {
  FISCAL_STEP_LABELS,
  FiscalArea,
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
  /** Specific, human-readable reason a pending step is incomplete. */
  reason: string;
  /** Server-side confirmation (FISCAL_STATUS_INCOMPLETE) that this step is missing. */
  serverFlagged: boolean;
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
            [class.validation-row--flagged]="row.serverFlagged"
          >
            <span class="validation-state">
              @if (row.completed) {
                <app-icon name="check" [size]="14"></app-icon>
              } @else {
                <app-icon name="alert-circle" [size]="14"></app-icon>
              }
            </span>
            <div class="validation-row__body">
              <strong>{{ row.label }}</strong>
              @if (row.completed) {
                <small>{{ row.summary }}</small>
              } @else {
                <small class="validation-row__reason">{{ row.reason }}</small>
              }
            </div>
            @if (!row.completed) {
              <button
                type="button"
                class="validation-row__cta"
                (click)="goTo(row.step)"
                [attr.aria-label]="'Volver a ' + row.label"
              >
                <app-icon name="arrow-left" [size]="14"></app-icon>
                <span>Volver a {{ row.label }}</span>
              </button>
            }
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
      .validation-row__body {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        flex: 1 1 auto;
        min-width: 0;
      }
      .validation-row__reason {
        color: var(--warning-color, #92400e) !important;
        font-weight: 600;
      }
      .validation-row__cta {
        flex: 0 0 auto;
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.45rem 0.7rem;
        border: 1px solid var(--border-color, #e5e7eb);
        border-radius: 0.45rem;
        background: var(--surface-color, #ffffff);
        color: var(--primary-color, #2563eb);
        font: inherit;
        font-size: 0.82rem;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
      }
      .validation-row__cta:hover {
        background: color-mix(
          in srgb,
          var(--primary-color, #2563eb) 8%,
          #ffffff
        );
      }
      .validation-row__cta:focus-visible {
        outline: 2px solid var(--primary-color, #2563eb);
        outline-offset: 2px;
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
      .validation-row--flagged {
        border-color: var(--color-destructive, #b91c1c);
        background: color-mix(
          in srgb,
          var(--color-destructive, #b91c1c) 5%,
          #ffffff
        );
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
      @media (max-width: 560px) {
        .validation-row {
          flex-wrap: wrap;
        }
        .validation-row__cta {
          width: 100%;
          justify-content: center;
        }
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
    // Real completion truth: union of prefill.satisfied_steps + wizard
    // completed_steps + detector signals (the service already folds all three
    // into effectiveSatisfiedSteps()). Using completedSteps() alone would mark
    // prefill-satisfied steps as pending.
    const satisfied = new Set(this.service.effectiveSatisfiedSteps());
    const refs = this.service.stepRefs() as Record<
      string,
      Record<string, unknown> | undefined
    >;
    // Server-side confirmation: flatten missing_steps across selected areas.
    const flagged = new Set<FiscalWizardStepId>();
    const missingByArea = this.service.finalizeMissingSteps();
    (Object.keys(missingByArea) as FiscalArea[]).forEach((area) => {
      (missingByArea[area] ?? []).forEach((s) => flagged.add(s));
    });

    return this.requiredSteps().map((step) => {
      const ref = refs[step];
      const completedAt =
        ref && typeof ref['completed_at'] === 'string'
          ? (ref['completed_at'] as string).slice(0, 10)
          : null;
      const isDone = satisfied.has(step);
      return {
        step,
        label: this.stepLabels[step],
        completed: isDone,
        summary: isDone
          ? completedAt
            ? `Configurado el ${completedAt}`
            : 'Configurado'
          : 'Pendiente',
        reason: isDone ? '' : this.reasonFor(step),
        serverFlagged: !isDone && flagged.has(step),
      };
    });
  });

  readonly missingLabels = computed<string[]>(() =>
    this.rows()
      .filter((r) => !r.completed)
      .map((r) => r.label),
  );

  readonly valid = computed(() => this.missingLabels().length === 0);

  /**
   * Derives a specific, user-facing reason a pending step is incomplete,
   * reading the read-only prefill snapshot. Falls back to a generic per-step
   * message when the prefill lacks the relevant section.
   */
  private reasonFor(step: FiscalWizardStepId): string {
    const prefill = this.service.prefill();
    const satisfied = new Set(this.service.effectiveSatisfiedSteps());

    switch (step) {
      case 'legal_data': {
        const legal = prefill?.legal_data;
        if (!legal?.nit) return 'Falta el NIT';
        if (!legal.nit_dv)
          return 'Falta el dígito de verificación (DV) del NIT';
        return 'Faltan los datos legales';
      }
      case 'dian_config': {
        const dian = prefill?.dian_config;
        if (!dian) return 'Falta configurar la conexión DIAN';
        if (dian.has_certificate === false)
          return 'Falta cargar el certificado digital';
        // Certificate present but the step is still not satisfied → the
        // hardened backend criterion rejected it (expired certificate).
        if (dian.has_certificate && !satisfied.has('dian_config'))
          return 'El certificado digital está vencido';
        return 'Falta configurar la conexión DIAN';
      }
      case 'puc':
        return 'Falta crear el plan de cuentas (PUC)';
      case 'accounting_period':
        return 'Falta abrir un período contable';
      case 'default_taxes':
        return 'Falta configurar los impuestos';
      case 'accounting_mappings':
        return 'Faltan los mapeos contables';
      case 'initial_inventory':
        return 'Falta configurar el inventario inicial';
      case 'payroll_config':
        return 'Falta configurar la nómina';
      default:
        return 'Pendiente';
    }
  }

  goTo(step: FiscalWizardStepId): void {
    this.service.goToStep(step);
  }

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
