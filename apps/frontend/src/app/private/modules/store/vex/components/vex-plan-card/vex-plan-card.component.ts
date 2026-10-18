import type {
  VoiceConsentApplied,
  VoiceConsentContext,
} from '../../../../../../core/services/vexi-voice-consent.model';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import type { VexiProposal } from '../../../../../../core/store/vexi/vexi.actions';
import { VexiConfirmationCardComponent } from '../../../../../../shared/components/vexi-dock/vexi-confirmation-card.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { VexPlanProposal, VexPlanStep } from '../../models/vex.models';

/**
 * One-write approval card, also compatible with persisted multi-step plans.
 * The initial click covers only the first eligible change. Every remaining
 * pending write renders its own confirmation and requires a new human click.
 * Cancelling is not rollback; already applied steps keep their receipts.
 *
 * Tokens are opaque to this card. No action is selected or triggered by default.
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
            <h4
              class="text-sm font-semibold text-[var(--color-text-primary)] m-0"
            >
              Vex quiere:
              {{ step.summary || step.preview?.target || step.tool }}
            </h4>
            <p
              class="text-xs text-[var(--color-text-secondary)] m-0"
              role="status"
            >
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
          [voiceContext]="voiceContext(step)"
          (voiceApplied)="voiceApplied.emit($event)"
          (voiceBusyChange)="voiceSubmitting.set($event)"
          [hideFooter]="true"
          [embedded]="true"
          agentLabel="Vex"
        ></app-vexi-confirmation-card>

        @if (
          (step.status === 'failed' || step.status === 'unknown') && step.error
        ) {
          <p class="text-xs text-[var(--color-error)] m-0" role="alert">
            {{ step.error }}
          </p>
        }

        @if (is_open() || show_own_card(step)) {
          <footer class="flex gap-2">
            <button
              type="button"
              class="flex-1 min-h-11 px-4 rounded-xl border border-[var(--color-error)] text-[var(--color-error)] text-sm font-semibold disabled:opacity-50"
              [disabled]="isBusy()"
              (click)="cancel.emit()"
            >
              Cancelar
            </button>
            <button
              type="button"
              class="flex-1 min-h-11 px-4 rounded-xl text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
              [class.bg-[var(--color-primary)]]="!step.irreversible"
              [class.text-[var(--color-text-on-primary)]]="!step.irreversible"
              [class.bg-[var(--color-error)]]="step.irreversible"
              [class.text-white]="step.irreversible"
              [disabled]="isBusy() || step.preview?.status === 'error'"
              (click)="is_open() ? approve.emit() : onStepApprove(step)"
            >
              @if (isBusy()) {
                <app-icon name="loader-2" [size]="16" [spin]="true"></app-icon>
                Aplicando…
              } @else {
                <app-icon name="check" [size]="16"></app-icon>
                {{ step.irreversible ? 'Confirmar (irreversible)' : 'Aprobar' }}
              }
            </button>
          </footer>
          @if (step.irreversible) {
            <p
              class="text-xs text-[var(--color-error)] m-0 text-center"
              role="note"
            >
              Esta acción no se puede deshacer
            </p>
          }
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
                <span
                  class="flex-1 min-w-0 truncate font-medium text-[var(--color-text-primary)]"
                >
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
              @if (
                (step.status === 'failed' || step.status === 'unknown') &&
                step.error
              ) {
                <p class="text-xs text-[var(--color-error)] m-0" role="alert">
                  {{ step.error }}
                </p>
              }
              @if (show_own_card(step)) {
                <app-vexi-confirmation-card
                  [proposal]="toProposal(step)"
                  [voiceContext]="voiceContext(step)"
                  (voiceApplied)="voiceApplied.emit($event)"
                  (voiceBusyChange)="voiceSubmitting.set($event)"
                  (approve)="onStepApprove(step)"
                  (reject)="cancel.emit()"
                  agentLabel="Vex"
                ></app-vexi-confirmation-card>
              } @else {
                <app-vexi-confirmation-card
                  [proposal]="toProposal(step)"
                  [voiceContext]="voiceContext(step)"
                  (voiceApplied)="voiceApplied.emit($event)"
                  (voiceBusyChange)="voiceSubmitting.set($event)"
                  [hideFooter]="true"
                  agentLabel="Vex"
                ></app-vexi-confirmation-card>
                @if (step.irreversible && is_open()) {
                  <p class="text-xs text-[var(--color-text-secondary)] m-0">
                    Este paso pedirá tu confirmación por separado al aprobar el
                    plan.
                  </p>
                }
              }
            </li>
          }
        </ol>

        @if (is_open()) {
          @if (irreversible_count() > 0) {
            <p
              class="text-xs text-[var(--color-text-secondary)] m-0"
              role="note"
            >
              Esta aprobación cubre una acción. Cada cambio restante pedirá su
              propia confirmación.
            </p>
          }
          <footer class="flex gap-2">
            <button
              type="button"
              class="flex-1 min-h-11 px-4 rounded-xl border border-[var(--color-error)] text-[var(--color-error)] text-sm font-semibold disabled:opacity-50"
              [disabled]="isBusy()"
              (click)="cancel.emit()"
            >
              Cancelar
            </button>
            <button
              type="button"
              class="flex-1 min-h-11 px-4 rounded-xl bg-[var(--color-primary)] text-[var(--color-text-on-primary)] text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
              [disabled]="isBusy()"
              (click)="approve.emit()"
            >
              @if (isBusy()) {
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
  protected readonly voiceSubmitting = signal(false);
  protected readonly isBusy = computed(
    () => this.busy() || this.voiceSubmitting(),
  );
  readonly conversationId = input<number | null>(null);
  readonly objectiveId = input<string | undefined>(undefined);
  readonly voiceApplied = output<VoiceConsentApplied>();

  readonly approve = output<void>();
  readonly cancel = output<void>();
  readonly stepApprove = output<{
    step_id: string;
    confirmation_token: string;
  }>();

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
      case 'unknown_effect':
        return 'pendiente de verificación';
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
      case 'unknown_effect':
        return 'El efecto no está confirmado. Verifica el resultado antes de otra acción; no repitas este cambio.';
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
    if (step.status === 'unknown' || this.plan().status === 'unknown_effect')
      return 'Pendiente de verificación';
    if (step.status === 'done') return 'Hecho';
    if (step.status === 'failed') return 'Falló';
    if (step.status === 'cancelled' || this.plan().status === 'rejected') {
      return 'Cancelado';
    }
    if (step.status === 'running' || this.plan().status === 'executing') {
      return 'Aplicando…';
    }
    if (this.plan().status === 'approved') {
      return 'Aprobado';
    }
    return 'Esperando tu aprobación';
  }

  step_status_label(status: VexPlanStep['status']): string {
    switch (status) {
      case 'unknown':
        return 'por verificar';
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

  voiceContext(step: VexPlanStep): VoiceConsentContext | null {
    const conversation_id = this.conversationId();
    if (!conversation_id || step.status !== 'pending') return null;
    const single = this.plan().plan_id.startsWith('single-');
    const exactSinglePlan =
      !single &&
      this.plan().steps.length === 1 &&
      this.plan().status === 'proposed';
    if (!step.confirmation_token && !exactSinglePlan) return null;
    if (
      !single &&
      !exactSinglePlan &&
      !['approved', 'executing'].includes(this.plan().status)
    )
      return null;
    return {
      conversation_id,
      agent_key: 'vex',
      channel: 'pipeline',
      ...(this.objectiveId() ? { objective_id: this.objectiveId() } : {}),
      ...(!single
        ? { plan_id: this.plan().plan_id, step_id: step.step_id }
        : {}),
    };
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
            message: [
              step.preview.message,
              step.irreversible ? 'Esta acción no se puede deshacer.' : '',
            ]
              .filter(Boolean)
              .join(' '),
          }
        : undefined,
      applying: this.isBusy(),
    };
  }

  /** Every pending write in an approved plan has an individual confirmation. */
  show_own_card(step: VexPlanStep): boolean {
    const status = this.plan().status;
    if (status !== 'approved' && status !== 'executing') return false;
    if (step.status !== 'pending') return false;
    return true; // Every remaining pending write requires a new individual click/token.
  }

  onStepApprove(step: VexPlanStep): void {
    // The step's own token travels through untouched; the store resolves
    // the step fresh by `step_id` and requests a new individual confirmation
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
