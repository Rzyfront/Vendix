import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AlertBannerComponent,
  ButtonComponent,
  ModalComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../shared/components/index';
import { WorkflowInstanceDetail } from '../interfaces/workflow.interfaces';
import { WorkflowsApiService } from '../services/workflows-api.service';
import { isStaleCode, toWorkflowError } from '../utils/workflow-errors.util';
import { outcomeBlockedByRequirements, outcomeLabel } from '../utils/workflow-labels.util';
import { WorkflowStageFormComponent } from './stage-form.component';

/**
 * Board move that needs input (`requires_modal`): loads the request and
 * reuses the stage form so the person fills what the outcome asks for.
 */
@Component({
  selector: 'app-workflow-board-move-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    TextareaComponent,
    AlertBannerComponent,
    WorkflowStageFormComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      [title]="title()"
      [subtitle]="detail() ? detail()!.reference + ' · ' + detail()!.title : ''"
      size="md"
    >
      @if (loading()) {
        <p class="py-6 text-center text-sm text-text-secondary">Cargando solicitud...</p>
      } @else if (detail(); as d) {
        @if (!task()) {
          <app-alert-banner variant="info" icon="clock">
            No tienes una tarea para atender en esta solicitud.
          </app-alert-banner>
        } @else if (d.stage) {
          <app-workflow-stage-form
            [fields]="d.stage.form_fields"
            [instanceData]="d.data"
            [instanceId]="d.id"
            [seedKey]="d.id + ':' + d.stage.key"
          />
          @if (blocked()) {
            <p class="mt-3 text-sm font-medium text-warning" role="status">
              Falta: {{ pendingLabels() }}. Ábrela para completar los requisitos.
            </p>
          }
          <div class="mt-4">
            <app-textarea
              label="Comentario"
              placeholder="Escribe el motivo o una observación"
              helperText="Es obligatorio al rechazar o devolver."
              [rows]="3"
              [error]="commentError() || undefined"
              [ngModel]="comment()"
              (ngModelChange)="comment.set($event ?? '')"
            />
          </div>
        }
      }
      @if (errorMessage()) {
        <p class="mt-3 text-sm text-error" role="alert">{{ errorMessage() }}</p>
      }
      <div slot="footer" class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="outline" (clicked)="onOpenChange(false)">Cancelar</app-button>
        <app-button
          [variant]="outcome() === 'reject' ? 'outline-danger' : 'primary'"
          [disabled]="!task() || blocked()"
          [loading]="busy()"
          (clicked)="submit()"
        >
          {{ title() }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class WorkflowBoardMoveModalComponent {
  private readonly api = inject(WorkflowsApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly stageForm = viewChild(WorkflowStageFormComponent);

  readonly isOpen = model<boolean>(false);
  readonly instanceId = input<number>(0);
  readonly outcome = input<string>('submit');
  /** Emits after the task was completed or found stale: the board reloads. */
  readonly finished = output<void>();

  readonly detail = signal<WorkflowInstanceDetail | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly comment = signal('');
  readonly commentError = signal('');
  readonly errorMessage = signal('');
  private idempotencyKey: string | null = null;

  readonly title = computed(() => outcomeLabel(this.outcome()));
  readonly task = computed(
    () =>
      this.detail()?.tasks.find((t) => (t.status === 'open' || t.status === 'claimed') && t.can_act) ??
      null,
  );
  readonly blocked = computed(
    () =>
      outcomeBlockedByRequirements(this.outcome()) &&
      (this.detail()?.pending_requirements.length ?? 0) > 0,
  );
  readonly pendingLabels = computed(() =>
    (this.detail()?.pending_requirements ?? []).map((p) => p.label).join(', '),
  );

  constructor() {
    effect(() => {
      const open = this.isOpen();
      const id = this.instanceId();
      untracked(() => {
        if (open && id > 0) this.load(id);
      });
    });
  }

  onOpenChange(open: boolean): void {
    this.isOpen.set(open);
    if (!open) {
      this.detail.set(null);
      this.comment.set('');
      this.commentError.set('');
      this.errorMessage.set('');
      this.idempotencyKey = null;
    }
  }

  submit(): void {
    const d = this.detail();
    const task = this.task();
    if (!d || !task || this.busy()) return;
    const result = this.stageForm()?.collect() ?? { ok: true, values: {} };
    if (!result.ok) return;
    this.idempotencyKey ??= crypto.randomUUID();
    const comment = this.comment().trim();
    this.busy.set(true);
    this.errorMessage.set('');
    this.api
      .completeTask(
        task.id,
        {
          outcome: this.outcome(),
          ...(Object.keys(result.values).length ? { values: result.values } : {}),
          ...(comment ? { comment } : {}),
          expected_row_version: d.row_version,
        },
        this.idempotencyKey,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.toast.success('Tarea completada');
          this.onOpenChange(false);
          this.finished.emit();
        },
        error: (error) => {
          this.busy.set(false);
          const parsed = toWorkflowError(error);
          if (parsed.status !== null && parsed.status >= 400 && parsed.status < 500) {
            this.idempotencyKey = null;
          }
          if (parsed.code === 'WORKFLOW_COMMENT_REQUIRED') {
            this.commentError.set(parsed.message);
          } else if (parsed.code === 'WORKFLOW_FORM_INVALID') {
            const details = parsed.details as { errors?: { field?: string; message?: string }[] } | null;
            for (const issue of details?.errors ?? []) {
              if (issue.field && issue.message) this.stageForm()?.fail(issue.field, issue.message);
            }
            this.errorMessage.set('Revisa los campos marcados.');
          } else if (isStaleCode(parsed.code)) {
            this.toast.error(parsed.message);
            this.onOpenChange(false);
            this.finished.emit();
          } else {
            this.errorMessage.set(parsed.message);
          }
        },
      });
  }

  private load(id: number): void {
    this.loading.set(true);
    this.detail.set(null);
    this.api
      .getInstance(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.detail.set(detail);
          this.loading.set(false);
        },
        error: (error) => {
          this.loading.set(false);
          this.errorMessage.set(toWorkflowError(error).message);
        },
      });
  }
}
