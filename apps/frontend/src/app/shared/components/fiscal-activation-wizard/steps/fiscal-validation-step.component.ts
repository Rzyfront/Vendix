import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { FiscalActivationWizardService } from '../../../../core/services/fiscal-activation-wizard.service';
import {
  FISCAL_STEP_LABELS,
  FISCAL_STEP_ORDER,
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

      @if (missingLabels().length && !refreshing()) {
        <div
          class="step-warning"
          role="status"
          aria-live="polite"
          data-testid="fiscal-validation-missing-banner"
        >
          <app-icon name="alert-circle" [size]="16"></app-icon>
          <div class="step-warning__body">
            <strong>Faltan pasos para activar las áreas seleccionadas</strong>
            <small>
              Toca cada paso de la lista para abrirlo y completarlo. El backend
              no permitirá la activación hasta que los datos estén realmente
              guardados, aunque el wizard te deje hacer clic en "Continuar".
            </small>
          </div>
        </div>
      }

      @if (localError()) {
        <p class="step-error" role="alert" aria-live="assertive">
          {{ localError() }}
        </p>
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
        display: flex;
        align-items: flex-start;
        gap: 0.6rem;
        padding: 0.85rem 1rem;
        margin: 0;
        border: 1px solid #fcd34d;
        border-radius: 0.5rem;
        background: #fffbeb;
        color: var(--warning-color, #92400e);
      }
      .step-warning__body {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
      }
      .step-warning__body strong {
        display: block;
        font-size: 0.9rem;
        color: var(--warning-color, #92400e);
      }
      .step-warning__body small {
        display: block;
        font-size: 0.8rem;
        line-height: 1.35;
        color: #78350f;
      }
      .step-warning app-icon {
        flex: 0 0 auto;
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
export class FiscalValidationStepComponent
  implements FiscalWizardStepHost, OnInit
{
  private readonly service = inject(FiscalActivationWizardService);

  readonly stepId: FiscalWizardStepId = 'validation';
  readonly submitting = signal(false);
  readonly localError = signal<string | null>(null);

  /** True while the on-enter prefill refresh is in flight. */
  readonly refreshing = signal(false);

  private readonly stepLabels = FISCAL_STEP_LABELS;

  /**
   * The validation step is the wizard's final screen. Earlier steps mark
   * themselves complete optimistically (commitStep) but only some refresh the
   * read-only prefill snapshot, so on entry `prefill.satisfied_steps` can be
   * stale — which rendered already-completed modules as "missing" until a
   * manual page reload. Force a fresh prefill read on enter so the page mirrors
   * the real backend state (same effect as reloading) without the reload.
   */
  ngOnInit(): void {
    this.refreshing.set(true);
    void this.service
      .loadPrefill(true)
      .catch(() => undefined)
      .finally(() => this.refreshing.set(false));
  }

  readonly requiredSteps = computed<FiscalWizardStepId[]>(() => {
    const acc = new Set<FiscalWizardStepId>();
    this.service.selectedAreas().forEach((area) => {
      REQUIRED_STEPS_BY_AREA[area]
        .filter((s) => s !== 'validation' && s !== 'area_selection')
        .forEach((s) => acc.add(s));
    });

    // Union with any step the backend explicitly flagged as missing on the
    // last `finalize()` 409 (`details.missing_steps`). The frontend's
    // `REQUIRED_STEPS_BY_AREA` and the backend's `REQUIRED_STEPS_BY_FISCAL_AREA`
    // are two copies of the same contract; if they ever drift, a server-flagged
    // step that the frontend doesn't list would otherwise be swallowed — the
    // user would see the generic "faltan pasos" banner with no actionable row
    // to navigate to. Folding the flagged steps in here guarantees every 409
    // missing step renders as a navigable row, regardless of contract drift.
    const missingByArea = this.service.finalizeMissingSteps();
    (Object.keys(missingByArea) as FiscalArea[]).forEach((area) => {
      (missingByArea[area] ?? [])
        .filter((s) => s !== 'validation' && s !== 'area_selection')
        .forEach((s) => acc.add(s));
    });

    // Keep the rows in the canonical wizard order so the list reads top-to-bottom
    // the same way the stepper does, instead of selection/insertion order.
    return FISCAL_STEP_ORDER.filter((step) => acc.has(step));
  });

  /**
   * Source of truth for "this step is complete" in the validation view. We do
   * NOT trust the service-level `effectiveSatisfiedSteps()` here: that signal
   * mixes optimistic wizard state (completedSteps, detector signals) with
   * prefill data, and the optimistic half caused the user to see green
   * checkmarks for steps whose real backing data was missing — only to hit
   * `FISCAL_STATUS_INCOMPLETE` (409) on `finalize()`.
   *
   * Priority for the row state (highest precedence first):
   *  1. `finalizeMissingSteps` (server-side 409 confirmation) → always PENDING.
   *  2. `prefill.satisfied_steps` (backend read-only truth) → DONE if present.
   *  3. `wizard.completed_steps` (in-session optimistic) → DONE as a last
   *     resort, but only if the prefill snapshot is missing the relevant
   *     section (legacy callers / prefill not yet loaded). The reason copy
   *     still points at the prefill gap so the user knows to re-check.
   */
  readonly rows = computed<ValidationRow[]>(() => {
    const prefill = this.service.prefill();
    const prefillSatisfied = new Set(prefill?.satisfied_steps ?? []);
    const wizardCompleted = new Set(this.service.completedSteps());

    // Server-side 409 confirmation, flattened across selected areas. Once the
    // backend has explicitly said "this step is missing" we trust it over any
    // optimistic signal — period.
    const flagged = new Set<FiscalWizardStepId>();
    const missingByArea = this.service.finalizeMissingSteps();
    (Object.keys(missingByArea) as FiscalArea[]).forEach((area) => {
      (missingByArea[area] ?? []).forEach((s) => flagged.add(s));
    });

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

      // 1) Server-confirmed missing → always pending, regardless of any other
      //    optimistic signal. This is what the user complained about: the row
      //    looked green, finalize() rejected it, and there was no visible
      //    reason why.
      let isDone: boolean;
      if (flagged.has(step)) {
        isDone = false;
      } else if (prefillSatisfied.has(step)) {
        // 2) Prefill has the canonical read of the underlying tables — trust
        //    it.
        isDone = true;
      } else if (prefill === null) {
        // 3) Prefill not yet loaded (legacy flow / first load in flight):
        //    fall back to wizard-completed to avoid an empty screen.
        isDone = wizardCompleted.has(step);
      } else {
        // Prefill is loaded and the step is NOT in satisfied_steps → the
        // real data is genuinely missing. Do NOT mark it done just because
        // the user clicked "Continuar" inside the wizard.
        isDone = false;
      }

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
      case 'initial_inventory': {
        const inventory = prefill?.initial_inventory;
        if (inventory?.costing_method) {
          // The step considers itself complete (the backend agrees) — this
          // branch only fires when the user's wizard session believes the
          // step is done but the prefill snapshot disagrees (stale cache or
          // the data was reset out-of-band). Tell the user the truth:
          // "your settings don't actually have a costing method anymore".
          return 'El método de costeo no quedó guardado. Vuelve a elegirlo.';
        }
        return 'Falta elegir el método de costeo del inventario';
      }
      case 'payroll_config': {
        const payroll = prefill?.payroll_config;
        if (payroll?.has_minimal) {
          return 'La configuración mínima de nómina no quedó guardada. Vuelve a confirmar la frecuencia.';
        }
        return 'Falta configurar la frecuencia y parafiscales de la nómina';
      }
      default:
        return 'Pendiente';
    }
  }

  goTo(step: FiscalWizardStepId): void {
    this.service.goToStep(step);
  }

  async submit(): Promise<{ ref: Record<string, unknown> } | null> {
    if (!this.valid()) return null;

    // Pre-check client-side against the prefill snapshot (the same read the
    // backend does on `finalize()`). If we already know a step is missing in
    // the underlying tables, do NOT call `finalize()` just to receive a 409
    // — show the actionable banner here so the user understands which step
    // needs attention before they can activate.
    const prefill = this.service.prefill();
    if (prefill) {
      const missingHere = this.missingLabels();
      if (missingHere.length > 0) {
        this.localError.set(
          `Faltan pasos por completar antes de activar: ${missingHere.join(', ')}. ` +
            'Selecciona cada paso de la lista para abrirlo y completarlo.',
        );
        return null;
      }
    }

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
      // 409 → the service has already captured `finalizeMissingSteps` and
      // surfaced the missing-step banner. Don't override it with the raw
      // userMessage; the validation list is the source of truth now.
      const parsed = parseApiError(e);
      if (parsed.errorCode !== 'FISCAL_STATUS_INCOMPLETE') {
        this.localError.set(parsed.userMessage);
      }
      return null;
    } finally {
      this.submitting.set(false);
    }
  }
}
