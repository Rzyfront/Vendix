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
 * Every step renders its diff through the shared
 * `app-vexi-confirmation-card` (same `from → to` rows the owner already
 * knows), footer hidden: steps are information, not buttons. One plan
 * approval executes the reversible steps only; each pending irreversible
 * step (once the plan is approved) renders its OWN card with its own
 * approve/reject footer, emitted via `stepApprove` / `cancel`. Rejecting
 * any step rejects the whole plan explicitly — there is no per-step undo.
 *
 * Token-clean: the card never sees the plan token and passes a step's own
 * token through untouched. There is no default action and no timeout:
 * neither button is autofocused, so an Enter pressed out of habit in the
 * composer can never approve a write.
 */
@Component({
  selector: 'vendix-vex-plan-card',
  standalone: true,
  imports: [IconComponent, VexiConfirmationCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (single_step(); as step) {
      <section
        class="rounded-2xl border border-[var(--color-primary)] bg-[var(--color-surface)] p-3 flex flex-col gap-3"
        role="group"
        aria-label="Acción propuesta por Vex"
      >
        <header class="flex items-start gap-2">
          <span
            class="w-8 h-8 shrink-0 rounded-lg grid place-items-center bg-[rgba(var(--color-primary-rgb,46,204,113),0.14)] text-[var(--color-primary)]"
            aria-hidden="true"
          >
            <app-icon name="sparkles" [size]="18"></app-icon>
          </span>
          <div class="min-w-0 flex-1">
            <h4 class="text-sm font-semibold text-[var(--color-text-primary)] m-0">
              Vex quiere: {{ step.summary || step.preview?.target || step.tool }}
            </h4>
            <p class="text-xs text-[var(--color-text-secondary)] m-0" role="status">
              {{ single_status_label(step) }}
            </p>
          </div>
          @if (step.irreversible) {
            <span
              class="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-[rgba(var(--color-error-rgb),0.1)] text-[var(--color-error)]"
            >
              <app-icon name="alert-triangle" [size]="14"></app-icon>
              Irreversible
            </span>
          }
        </header>

        <app-vexi-confirmation-card
          [proposal]="toProposal(step)"
          [hideFooter]="true"
          [embedded]="true"
          agentLabel="Vex"
        ></app-vexi-confirmation-card>

        @if (step.status === 'failed' && step.error) {
          <p class="text-xs text-[var(--color-error)] m-0" role="alert">
            {{ step.error }}
          </p>
        }

        @if (is_open() || show_own_card(step)) {
          <footer class="flex gap-2">
            <button
              type="button"
              class="flex-1 min-h-11 px-4 rounded-xl border border-[var(--color-error)] text-[var(--color-error)] text-sm font-semibold disabled:opacity-50"
              [disabled]="busy()"
              (click)="cancel.emit()"
            >
              Cancelar
            </button>
            <button
              type="button"
              class="flex-1 min-h-11 px-4 rounded-xl bg-[var(--color-primary)] text-[var(--color-text-on-primary)] text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
              [disabled]="busy() || step.preview?.status === 'error'"
              (click)="is_open() ? approve.emit() : onStepApprove(step)"
            >
              @if (busy()) {
                <app-icon name="loader-2" [size]="16" [spin]="true"></app-icon>
                Aplicando…
              } @else {
                <app-icon name="check" [size]="16"></app-icon>
                Aprobar
              }
            </button>
          </footer>
        }
      </section>
    } @else {
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
            class="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-[rgba(var(--color-error-rgb),0.1)] text-[var(--color-error)]"
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
                  class="shrink-0 px-2 py-0.5 rounded-lg font-medium bg-[rgba(var(--color-error-rgb),0.1)] text-[var(--color-error)]"
                >
                  Irreversible
                </span>
              }
              <span class="shrink-0 text-[var(--color-text-secondary)]">
                {{ step_status_label(step.status) }}
              </span>
            </div>
            @if (step.status === 'failed' && step.error) {
              <p class="text-xs text-[var(--color-error)] m-0" role="alert">
                {{ step.error }}
              </p>
            }
            @if (show_own_card(step)) {
              <app-vexi-confirmation-card
                [proposal]="toProposal(step)"
                (approve)="onStepApprove(step)"
                (reject)="cancel.emit()"
                agentLabel="Vex"
              ></app-vexi-confirmation-card>
            } @else {
              <app-vexi-confirmation-card
                [proposal]="toProposal(step)"
                [hideFooter]="true"
                agentLabel="Vex"
              ></app-vexi-confirmation-card>
              @if (step.irreversible && is_open()) {
                <p class="text-xs text-[var(--color-text-secondary)] m-0">
                  Este paso pedirá tu confirmación por separado al aprobar el plan.
                </p>
              }
            }
          </li>
        }
      </ol>

      @if (is_open()) {
        @if (irreversible_count() > 0) {
          <p class="text-xs text-[var(--color-text-secondary)] m-0" role="note">
            Aprobar el plan ejecuta los pasos reversibles. Los irreversibles
            quedan fuera y piden su propia confirmación.
          </p>
        }
        <footer class="flex gap-2">
          <button
            type="button"
            class="flex-1 min-h-11 px-4 rounded-xl border border-[var(--color-error)] text-[var(--color-error)] text-sm font-semibold disabled:opacity-50"
            [disabled]="busy()"
            (click)="cancel.emit()"
          >
            Cancelar
          </button>
          <button
            type="button"
            class="flex-1 min-h-11 px-4 rounded-xl bg-[var(--color-primary)] text-[var(--color-text-on-primary)] text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
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
    }
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

  /** A one-step plan renders as a simple action confirmation, not as a plan. */
  readonly single_step = computed<VexPlanStep | null>(() => {
    const steps = this.plan().steps;
    return steps.length === 1 ? steps[0] : null;
  });

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
      case 'partially_applied':
        return 'aplicado parcialmente';
      case 'failed':
        return 'falló en un paso';
      case 'rejected':
        return 'cancelado';
      default:
        return this.plan().status;
    }
  });

  private readonly done_count = computed(
    () => this.plan().steps.filter((s) => s.status === 'done').length,
  );
  private readonly cancelled_count = computed(
    () => this.plan().steps.filter((s) => s.status === 'cancelled').length,
  );
  private readonly pending_count = computed(
    () =>
      this.plan().steps.filter(
        (s) => s.status === 'pending' || s.status === 'running',
      ).length,
  );

  /**
   * Closing note per plan state. A cancelled plan says what the cancel really
   * did: pending steps cancelled, steps already applied untouched.
   */
  readonly closed_note = computed(() => {
    const applied = this.done_count();
    switch (this.plan().status) {
      case 'executing':
        return 'Plan aprobado. Vex está ejecutando los pasos.';
      case 'approved': {
        const pending = this.pending_count();
        return pending > 0
          ? `Plan aprobado. ${steps_label(pending)} por confirmar o aplicar.`
          : 'Plan aprobado.';
      }
      case 'done':
        return 'Plan completado.';
      case 'partially_applied': {
        const failed = this.plan().steps.filter(
          (s) => s.status === 'failed',
        ).length;
        return `Plan aplicado parcialmente: ${applied} ${applied === 1 ? 'paso aplicado' : 'pasos aplicados'}${
          failed > 0 ? `, ${failed} con error` : ''
        }. Revisa la conversación.`;
      }
      case 'failed':
        return 'El plan se detuvo en un paso. Revisa la conversación.';
      case 'rejected': {
        const cancelled = this.cancelled_count();
        if (applied > 0) {
          return `Plan cancelado. Se cancelaron ${steps_label(cancelled)}; ${steps_label(applied)} ya ${applied === 1 ? 'estaba aplicado' : 'estaban aplicados'}.`;
        }
        return 'Plan cancelado. No se aplicó ningún cambio.';
      }
      default:
        return '';
    }
  });

  single_status_label(step: VexPlanStep): string {
    if (step.status === 'done') return 'Hecho';
    if (step.status === 'failed') return 'Falló';
    if (step.status === 'cancelled' || this.plan().status === 'rejected') {
      return 'Cancelado';
    }
    if (step.status === 'running' || this.plan().status === 'executing') {
      return 'Aplicando…';
    }
    if (this.plan().status === 'approved') {
      return step.irreversible
        ? 'Aprobado · falta tu confirmación final'
        : 'Aprobado';
    }
    return 'Esperando tu aprobación';
  }

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
      case 'cancelled':
        return 'cancelado';
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

  /**
   * Whether the step renders its OWN confirmation card (with approve/reject
   * footer) instead of a diff-only one. Only after the plan approval minted
   * the plan token, only while the step is still pending, and only for
   * steps outside the plan click: irreversibles, or reversibles the token
   * routed to their own card (drifted args, replay) carrying a live token.
   */
  show_own_card(step: VexPlanStep): boolean {
    const status = this.plan().status;
    if (status !== 'approved' && status !== 'executing') return false;
    if (step.status !== 'pending') return false;
    return step.irreversible || !!step.confirmation_token;
  }

  onStepApprove(step: VexPlanStep): void {
    // The step's own token travels through untouched; the store resolves
    // the step fresh by `step_id` and falls back to a plan-token redeem
    // when no token is attached yet.
    this.stepApprove.emit({
      step_id: step.step_id,
      confirmation_token: step.confirmation_token ?? '',
    });
  }
}

function steps_label(count: number): string {
  return `${count} ${count === 1 ? 'paso' : 'pasos'}`;
}
