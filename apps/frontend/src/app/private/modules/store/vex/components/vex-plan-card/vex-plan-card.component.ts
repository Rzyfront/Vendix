import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { VexiProposal } from '../../../../../../core/store/vexi/vexi.actions';
import { VexiConfirmationCardComponent } from '../../../../../../shared/components/vexi-dock/vexi-confirmation-card.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { VexPlanProposal, VexPlanStep } from '../../models/vex.models';

/**
 * Approval card for a whole Vex plan.
 *
 * Each step renders its diff through the shared `app-vexi-confirmation-card`
 * (same `from → to` rows the owner already knows). One approval executes all
 * reversible steps; irreversible steps keep their own confirmation, emitted
 * via `stepApprove` when the backend issued a step token.
 *
 * There is no default action and no timeout: neither button is autofocused, so
 * an Enter pressed out of habit in the composer can never approve a write.
 */
@Component({
  selector: 'vendix-vex-plan-card',
  standalone: true,
  imports: [IconComponent, VexiConfirmationCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="rounded-2xl border border-[var(--color-primary)] bg-[var(--color-surface)] p-3 flex flex-col gap-3"
      role="group"
      aria-label="Plan propuesto por Vex"
    >
      <header class="flex items-start gap-2">
        <span
          class="w-8 h-8 shrink-0 rounded-lg grid place-items-center bg-[rgba(var(--color-primary-rgb,46,204,113),0.14)] text-[var(--color-primary)]"
          aria-hidden="true"
        >
          <app-icon name="sparkles" [size]="18"></app-icon>
        </span>
        <div class="min-w-0 flex-1">
          <h4 class="text-sm font-semibold text-[var(--color-text-primary)]">
            {{ plan().title || 'Vex propone un plan' }}
          </h4>
          <p class="text-xs text-[var(--color-text-secondary)]">
            {{ plan().steps.length }} paso(s) · {{ status_label() }}
          </p>
        </div>
        @if (irreversible_count() > 0) {
          <span
            class="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-[rgba(220,38,38,0.1)] text-[var(--color-error,#dc2626)]"
          >
            <app-icon name="alert-triangle" [size]="14"></app-icon>
            {{ irreversible_count() }} irreversible(s)
          </span>
        }
      </header>

      <ol class="flex flex-col gap-3 list-none m-0 p-0">
        @for (step of plan().steps; track step.step_id; let i = $index) {
          <li class="flex flex-col gap-1.5">
            <div class="flex items-center gap-2 text-xs">
              <span
                class="w-6 h-6 shrink-0 rounded-full grid place-items-center font-semibold bg-[rgba(var(--color-text-primary-rgb,0,0,0),0.07)] text-[var(--color-text-primary)]"
                aria-hidden="true"
              >
                {{ i + 1 }}
              </span>
              <span class="flex-1 min-w-0 truncate font-medium text-[var(--color-text-primary)]">
                {{ step.summary }}
              </span>
              @if (step.irreversible) {
                <span
                  class="shrink-0 px-2 py-0.5 rounded-lg font-medium bg-[rgba(220,38,38,0.1)] text-[var(--color-error,#dc2626)]"
                >
                  Irreversible
                </span>
              }
              <span class="shrink-0 text-[var(--color-text-secondary)]">
                {{ step_status_label(step.status) }}
              </span>
            </div>
            <app-vexi-confirmation-card
              [proposal]="toProposal(step)"
              (approve)="onStepApprove(step)"
              (reject)="cancel.emit()"
            ></app-vexi-confirmation-card>
          </li>
        }
      </ol>

      @if (is_open()) {
        <footer class="flex gap-2">
          <button
            type="button"
            class="flex-1 min-h-11 px-4 rounded-xl border border-[var(--color-error,#dc2626)] text-[var(--color-error,#dc2626)] text-sm font-semibold disabled:opacity-50"
            [disabled]="busy()"
            (click)="cancel.emit()"
          >
            Cancelar
          </button>
          <button
            type="button"
            class="flex-1 min-h-11 px-4 rounded-xl bg-[var(--color-primary)] text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
            [disabled]="busy()"
            (click)="approve.emit()"
          >
            @if (busy()) {
              <app-icon name="loader-2" [size]="16" [spin]="true"></app-icon>
              Aprobando…
            } @else {
              <app-icon name="check" [size]="16"></app-icon>
              Aprobar plan
            }
          </button>
        </footer>
      } @else {
        <p class="text-xs text-[var(--color-text-secondary)]" role="status">
          {{ closed_note() }}
        </p>
      }
    </section>
  `,
})
export class VexPlanCardComponent {
  readonly plan = input.required<VexPlanProposal>();
  readonly busy = input<boolean>(false);

  readonly approve = output<void>();
  readonly cancel = output<void>();
  readonly stepApprove = output<{ step_id: string; confirmation_token: string }>();

  readonly irreversible_count = computed(
    () => this.plan().steps.filter((s) => s.irreversible).length,
  );

  readonly is_open = computed(() => this.plan().status === 'proposed');

  readonly status_label = computed(() => {
    switch (this.plan().status) {
      case 'proposed':
        return 'esperando tu aprobación';
      case 'approved':
        return 'aprobado';
      case 'executing':
        return 'ejecutándose';
      case 'done':
        return 'completado';
      case 'failed':
        return 'falló en un paso';
      case 'rejected':
        return 'cancelado';
      default:
        return this.plan().status;
    }
  });

  readonly closed_note = computed(() => {
    switch (this.plan().status) {
      case 'approved':
      case 'executing':
        return 'Plan aprobado. Vex está ejecutando los pasos.';
      case 'done':
        return 'Plan completado.';
      case 'failed':
        return 'El plan se detuvo en un paso. Revisa la conversación.';
      case 'rejected':
        return 'Plan cancelado. No se aplicó ningún cambio.';
      default:
        return '';
    }
  });

  step_status_label(status: VexPlanStep['status']): string {
    switch (status) {
      case 'pending':
        return 'pendiente';
      case 'approved':
        return 'aprobado';
      case 'running':
        return 'en curso';
      case 'done':
        return 'listo';
      case 'failed':
        return 'falló';
      case 'skipped':
        return 'omitido';
      default:
        return status;
    }
  }

  toProposal(step: VexPlanStep): VexiProposal {
    return {
      tool: step.tool,
      arguments: step.arguments ?? {},
      confirmationToken: step.confirmation_token ?? '',
      preview: step.preview
        ? {
            status: step.preview.status,
            target: step.preview.target,
            changes: step.preview.changes,
            message: step.preview.message,
          }
        : undefined,
      applying: this.busy(),
    };
  }

  onStepApprove(step: VexPlanStep): void {
    // An irreversible step with its own token confirms just that step; any
    // other approval is the whole-plan approval, which is the same outcome.
    if (step.irreversible && step.confirmation_token) {
      this.stepApprove.emit({
        step_id: step.step_id,
        confirmation_token: step.confirmation_token,
      });
      return;
    }
    this.approve.emit();
  }
}
