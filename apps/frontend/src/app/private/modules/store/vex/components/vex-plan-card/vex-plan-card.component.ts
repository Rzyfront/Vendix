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
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { VEX_COPY } from '../../vex-copy';
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
  imports: [ButtonComponent, IconComponent, VexiConfirmationCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (single_step(); as step) {
      <section
        class="rounded-2xl border border-primary bg-surface p-3 flex flex-col gap-3"
        role="group"
        [attr.aria-label]="copy.action_label"
      >
        <header class="flex items-start gap-2">
          <span
            class="w-8 h-8 shrink-0 rounded-lg grid place-items-center bg-primary/15 text-primary"
            aria-hidden="true"
          >
            <app-icon name="sparkles" [size]="18"></app-icon>
          </span>
          <div class="min-w-0 flex-1">
            <h4
              class="text-sm font-semibold text-text-primary m-0"
            >
              {{ copy.wants }}
              {{ step.summary || step.preview?.target || step.tool }}
            </h4>
            <p
              class="text-xs text-text-secondary m-0"
              role="status"
            >
              {{ single_status_label(step) }}
            </p>
          </div>
          @if (step.irreversible) {
            <span
              class="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-error/10 text-error"
            >
              <app-icon name="alert-triangle" [size]="14"></app-icon>
              {{ copy.irreversible }}
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
          [agentLabel]="copy.brand"
        ></app-vexi-confirmation-card>

        @if (
          (step.status === 'failed' || step.status === 'unknown') && step.error
        ) {
          <p class="text-xs text-error m-0" role="alert">
            {{ step.error }}
          </p>
        }

        @if (is_open() || show_own_card(step)) {
          <footer class="flex gap-2">
            <app-button
              class="flex-1"
              variant="outline-danger"
              [fullWidth]="true"
              [disabled]="isBusy()"
              (clicked)="cancel.emit()"
            >
              {{ copy.cancel }}
            </app-button>
            <app-button
              class="flex-1"
              [variant]="step.irreversible ? 'danger' : 'primary'"
              [fullWidth]="true"
              [loading]="isBusy()"
              [showTextWhileLoading]="true"
              [disabled]="isBusy() || step.preview?.status === 'error'"
              (clicked)="is_open() ? approve.emit() : onStepApprove(step)"
            >
              @if (isBusy()) {
                {{ copy.applying }}
              } @else {
                {{ step.irreversible ? copy.confirm_irreversible : copy.approve }}
              }
            </app-button>
          </footer>
          @if (step.irreversible) {
            <p
              class="text-xs text-error m-0 text-center"
              role="note"
            >
              {{ copy.cannot_undo_note }}
            </p>
          }
        }
      </section>
    } @else {
      <section
        class="rounded-2xl border border-primary bg-surface p-3 flex flex-col gap-3"
        role="group"
        [attr.aria-label]="copy.plan_label"
      >
        <header class="flex items-start gap-2">
          <span
            class="w-8 h-8 shrink-0 rounded-lg grid place-items-center bg-primary/15 text-primary"
            aria-hidden="true"
          >
            <app-icon name="sparkles" [size]="18"></app-icon>
          </span>
          <div class="min-w-0 flex-1">
            <h4 class="text-sm font-semibold text-text-primary">
              {{ plan().title || copy.plan_default_title }}
            </h4>
            <p class="text-xs text-text-secondary">
              {{ copy.steps_count(plan().steps.length) }} · {{ status_label() }}
            </p>
          </div>
          @if (irreversible_count() > 0) {
            <span
              class="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-error/10 text-error"
            >
              <app-icon name="alert-triangle" [size]="14"></app-icon>
              {{ copy.irreversible_count(irreversible_count()) }}
            </span>
          }
        </header>

        <ol class="flex flex-col gap-3 list-none m-0 p-0">
          @for (step of plan().steps; track step.step_id; let i = $index) {
            <li class="flex flex-col gap-1.5">
              <div class="flex items-center gap-2 text-xs">
                <span
                  class="w-6 h-6 shrink-0 rounded-full grid place-items-center font-semibold bg-text-primary/5 text-text-primary"
                  aria-hidden="true"
                >
                  {{ i + 1 }}
                </span>
                <span
                  class="flex-1 min-w-0 truncate font-medium text-text-primary"
                >
                  {{ step.summary }}
                </span>
                @if (step.irreversible) {
                  <span
                    class="shrink-0 px-2 py-0.5 rounded-lg font-medium bg-error/10 text-error"
                  >
                    {{ copy.irreversible }}
                  </span>
                }
                <span class="shrink-0 text-text-secondary">
                  {{ step_status_label(step.status) }}
                </span>
              </div>
              @if (
                (step.status === 'failed' || step.status === 'unknown') &&
                step.error
              ) {
                <p class="text-xs text-error m-0" role="alert">
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
                  [agentLabel]="copy.brand"
                ></app-vexi-confirmation-card>
              } @else {
                <app-vexi-confirmation-card
                  [proposal]="toProposal(step)"
                  [voiceContext]="voiceContext(step)"
                  (voiceApplied)="voiceApplied.emit($event)"
                  (voiceBusyChange)="voiceSubmitting.set($event)"
                  [hideFooter]="true"
                  [agentLabel]="copy.brand"
                ></app-vexi-confirmation-card>
                @if (step.irreversible && is_open()) {
                  <p class="text-xs text-text-secondary m-0">
                    {{ copy.step_separate_confirmation }}
                  </p>
                }
              }
            </li>
          }
        </ol>

        @if (is_open()) {
          @if (irreversible_count() > 0) {
            <p
              class="text-xs text-text-secondary m-0"
              role="note"
            >
              {{ copy.coverage_note }}
            </p>
          }
          <footer class="flex gap-2">
            <app-button
              class="flex-1"
              variant="outline-danger"
              [fullWidth]="true"
              [disabled]="isBusy()"
              (clicked)="cancel.emit()"
            >
              {{ copy.cancel }}
            </app-button>
            <app-button
              class="flex-1"
              [fullWidth]="true"
              [loading]="isBusy()"
              [showTextWhileLoading]="true"
              [disabled]="isBusy()"
              (clicked)="approve.emit()"
            >
              {{ isBusy() ? copy.approving : copy.approve_plan }}
            </app-button>
          </footer>
        } @else {
          <p class="text-xs text-text-secondary" role="status">
            {{ closed_note() }}
          </p>
        }
      </section>
    }
  `,
})
export class VexPlanCardComponent {
  protected readonly copy = VEX_COPY.plan;
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
        return this.copy.plan_status.unknown_effect;
      case 'proposed':
        return this.copy.plan_status.proposed;
      case 'approved':
        return this.copy.plan_status.approved;
      case 'executing':
        return this.copy.plan_status.executing;
      case 'done':
        return this.copy.plan_status.done;
      case 'partially_applied':
        return this.copy.plan_status.partially_applied;
      case 'failed':
        return this.copy.plan_status.failed;
      case 'rejected':
        return this.copy.plan_status.rejected;
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
        return this.copy.closed.unknown_effect;
      case 'executing':
        return this.copy.closed.executing;
      case 'approved': {
        const pending = this.pending_count();
        return pending > 0
          ? this.copy.closed.approved_pending(pending)
          : this.copy.closed.approved;
      }
      case 'done':
        return this.copy.closed.done;
      case 'partially_applied': {
        const failed = this.plan().steps.filter(
          (s) => s.status === 'failed',
        ).length;
        return this.copy.closed.partially_applied(applied, failed);
      }
      case 'failed':
        return this.copy.closed.failed;
      case 'rejected': {
        const cancelled = this.cancelled_count();
        if (applied > 0) {
          return this.copy.closed.rejected_partial(cancelled, applied);
        }
        return this.copy.closed.rejected;
      }
      default:
        return '';
    }
  });

  single_status_label(step: VexPlanStep): string {
    if (step.status === 'unknown' || this.plan().status === 'unknown_effect')
      return this.copy.single_status.unknown;
    if (step.status === 'done') return this.copy.single_status.done;
    if (step.status === 'failed') return this.copy.single_status.failed;
    if (step.status === 'cancelled' || this.plan().status === 'rejected') {
      return this.copy.single_status.cancelled;
    }
    if (step.status === 'running' || this.plan().status === 'executing') {
      return this.copy.single_status.running;
    }
    if (this.plan().status === 'approved') {
      return this.copy.single_status.approved;
    }
    return this.copy.single_status.waiting;
  }

  step_status_label(status: VexPlanStep['status']): string {
    switch (status) {
      case 'unknown':
        return this.copy.step_status.unknown;
      case 'pending':
        return this.copy.step_status.pending;
      case 'approved':
        return this.copy.step_status.approved;
      case 'running':
        return this.copy.step_status.running;
      case 'done':
        return this.copy.step_status.done;
      case 'failed':
        return this.copy.step_status.failed;
      case 'skipped':
        return this.copy.step_status.skipped;
      case 'cancelled':
        return this.copy.step_status.cancelled;
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
              step.irreversible ? this.copy.cannot_undo_sentence : '',
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
