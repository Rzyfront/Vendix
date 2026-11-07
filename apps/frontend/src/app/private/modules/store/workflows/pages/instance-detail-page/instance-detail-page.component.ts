import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  StickyHeaderComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { formatStoreDateTime } from '../../../../../../shared/utils/date.util';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { WorkflowInstanceCommentsComponent } from '../../components/instance-comments.component';
import { DossierItemsListComponent } from '../../components/dossier-items-list.component';
import { WorkflowStageFormComponent } from '../../components/stage-form.component';
import {
  StageRequirementView,
  TaskView,
  TimelineEventView,
  WorkflowInstanceDetail,
} from '../../interfaces/workflow.interfaces';
import { WorkflowsApiService } from '../../services/workflows-api.service';
import { isStaleCode, toWorkflowError } from '../../utils/workflow-errors.util';
import {
  dueText,
  eventLabel,
  instanceStatusLabel,
  instanceStatusTone,
  isOverdue,
  outcomeBlockedByRequirements,
  outcomeLabel,
} from '../../utils/workflow-labels.util';

type StickyBadgeColor = 'green' | 'blue' | 'yellow' | 'gray' | 'red';

const BADGE_COLOR: Record<string, StickyBadgeColor> = {
  info: 'blue',
  success: 'green',
  error: 'red',
  neutral: 'gray',
  warning: 'yellow',
  primary: 'blue',
};

/** Requirement kinds whose file the person uploads from this screen. */
const UPLOADABLE_KINDS = ['upload', 'signature'];

@Component({
  selector: 'app-instance-detail-page',
  standalone: true,
  imports: [
    FormsModule,
    StickyHeaderComponent,
    CardComponent,
    ButtonComponent,
    BadgeComponent,
    IconComponent,
    TextareaComponent,
    AlertBannerComponent,
    WorkflowStageFormComponent,
    DossierItemsListComponent,
    WorkflowInstanceCommentsComponent,
  ],
  template: `
    <div class="w-full">
      @if (detail(); as d) {
        <app-sticky-header
          [title]="d.reference + ' · ' + d.title"
          [subtitle]="d.definition.name + ' · versión ' + d.definition.version"
          icon="list-checks"
          variant="glass"
          [showBackButton]="true"
          backRoute="/admin/workflows"
          [badgeText]="statusText()"
          [badgeColor]="statusColor()"
          [metadataContent]="headerMeta()"
          [actions]="headerActions"
          (actionClicked)="onHeaderAction($event)"
        />

        <div class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-sm md:hidden">
          <span class="text-text-secondary">Etapa:</span>
          <span class="font-medium text-text-primary">{{ d.stage?.name ?? '—' }}</span>
          @if (d.status === 'active') {
            <span [class]="overdue() ? 'font-medium text-error' : 'text-text-secondary'">
              {{ dueLabel() }}
            </span>
          }
        </div>

        <div class="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div class="flex flex-col gap-4 lg:col-span-3">
            <app-card title="Tarea actual" [responsivePadding]="true" overflow="visible">
              @if (d.status !== 'active' || !d.stage) {
                <p class="text-sm text-text-secondary">
                  Esta solicitud está {{ statusText().toLowerCase() }}; no tiene tareas abiertas.
                </p>
              } @else {
                <div class="mb-3 flex flex-wrap items-center gap-2">
                  <span class="text-base font-semibold text-text-primary">{{ d.stage.name }}</span>
                  <span
                    class="text-sm"
                    [class]="overdue() ? 'font-medium text-error' : 'text-text-secondary'"
                  >
                    {{ dueLabel() }}
                  </span>
                </div>
                @if (d.stage.description) {
                  <p class="mb-3 text-sm text-text-secondary">{{ d.stage.description }}</p>
                }

                @if (actionableTask(); as task) {
                  @if (claimable(task)) {
                    <div class="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
                      <p class="flex-1 text-sm text-text-secondary">
                        Esta tarea es para {{ assigneeText(task) }}. Tómala para que nadie más la atienda.
                      </p>
                      <app-button variant="outline" [loading]="claiming()" (clicked)="claim(task)">
                        <app-icon name="user-check" [size]="14" slot="icon" />
                        Tomar tarea
                      </app-button>
                    </div>
                  }

                  <app-workflow-stage-form
                    [fields]="d.stage.form_fields"
                    [instanceData]="d.data"
                    [instanceId]="d.id"
                    [seedKey]="d.id + ':' + d.stage.key"
                  />

                  @if (d.stage.requirements.length) {
                    <div class="mt-5">
                      <h3 class="mb-2 text-sm font-semibold text-text-primary">Requisitos</h3>
                      <ul class="flex flex-col gap-2" data-testid="requirements">
                        @for (req of d.stage.requirements; track req.key) {
                          <li
                            class="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div class="flex items-center gap-2">
                              <app-icon
                                [name]="isPending(req.key) ? 'alert-triangle' : 'check-circle'"
                                [size]="16"
                                [class]="isPending(req.key) ? 'text-warning' : 'text-success'"
                              />
                              <span class="text-sm text-text-primary">{{ req.label }}</span>
                              <app-badge [variant]="isPending(req.key) ? 'warning' : 'success'" size="xs">
                                {{ isPending(req.key) ? 'Falta' : 'Cumplido' }}
                              </app-badge>
                            </div>
                            @if (canUpload(req)) {
                              <div>
                                <input
                                  #reqPicker
                                  type="file"
                                  class="hidden"
                                  [attr.accept]="acceptOf(req)"
                                  (change)="onRequirementFile(req, $event)"
                                />
                                <app-button
                                  variant="outline"
                                  size="sm"
                                  [loading]="uploadingKey() === req.key"
                                  (clicked)="reqPicker.click()"
                                >
                                  <app-icon name="upload" [size]="14" slot="icon" />
                                  {{ isPending(req.key) ? 'Subir archivo' : 'Reemplazar' }}
                                </app-button>
                              </div>
                            }
                          </li>
                        }
                      </ul>
                      @if (requirementErrors()[0]; as message) {
                        <p class="mt-2 text-xs text-error" role="alert">{{ message }}</p>
                      }
                    </div>
                  }

                  <div class="mt-5">
                    <app-textarea
                      label="Comentario"
                      placeholder="Escribe el motivo o una observación"
                      helperText="Es obligatorio al rechazar o devolver."
                      [rows]="3"
                      [error]="commentError()"
                      [ngModel]="comment()"
                      (ngModelChange)="onCommentChange($event)"
                    />
                  </div>

                  @if (blocked()) {
                    <p class="mt-4 text-sm font-medium text-warning" role="status" data-testid="pending-hint">
                      Falta: {{ pendingLabels() }}
                    </p>
                  }

                  <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                    @for (outcome of d.allowed_outcomes; track outcome) {
                      <app-button
                        [variant]="outcomeVariant(outcome)"
                        [disabled]="isOutcomeDisabled(outcome)"
                        [loading]="submitting() === outcome"
                        (clicked)="submit(task, outcome)"
                      >
                        {{ outcomeText(outcome) }}
                      </app-button>
                    }
                  </div>
                } @else {
                  <app-alert-banner variant="info" icon="clock">
                    @if (d.tasks.length) {
                      Esta etapa está asignada a {{ openAssignees() }}. No tienes una tarea para atender aquí.
                    } @else {
                      Esta etapa se está procesando automáticamente.
                    }
                  </app-alert-banner>
                  @if (d.stage.requirements.length) {
                    <ul class="mt-3 flex flex-col gap-1 text-sm text-text-secondary">
                      @for (req of d.stage.requirements; track req.key) {
                        <li class="flex items-center gap-2">
                          <app-icon
                            [name]="isPending(req.key) ? 'alert-triangle' : 'check-circle'"
                            [size]="14"
                          />
                          {{ req.label }} — {{ isPending(req.key) ? 'Falta' : 'Cumplido' }}
                        </li>
                      }
                    </ul>
                  }
                }
              }
            </app-card>
          </div>

          <div class="flex flex-col gap-4 lg:col-span-2">
            <app-card title="Expediente" [responsivePadding]="true" overflow="visible">
              <app-dossier-items-list
                [items]="d.dossier?.items ?? []"
                [labels]="requirementLabels()"
              />
            </app-card>

            <app-card title="Comentarios" [responsivePadding]="true" overflow="visible">
              <app-workflow-instance-comments
                [instanceId]="d.id"
                [comments]="d.comments ?? []"
              />
            </app-card>

            <app-card title="Línea de tiempo" [responsivePadding]="true" overflow="visible">
              <ol class="flex flex-col gap-3" data-testid="timeline" aria-label="Línea de tiempo">
                @for (event of timeline(); track event.seq) {
                  <li class="border-l-2 border-border pl-3">
                    <p class="text-sm font-medium text-text-primary">{{ eventText(event) }}</p>
                    <p class="text-xs text-text-secondary">
                      {{ event.actor_name ?? 'Sistema' }} · {{ dateText(event.occurred_at) }}
                    </p>
                    @if (eventComment(event); as note) {
                      <p class="mt-1 text-xs italic text-text-secondary">“{{ note }}”</p>
                    }
                  </li>
                }
              </ol>
            </app-card>
          </div>
        </div>
      } @else if (loading()) {
        <div class="p-6 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Cargando solicitud...</p>
        </div>
      } @else {
        <app-alert-banner variant="danger" icon="alert-triangle">
          {{ loadError() || 'No se pudo cargar la solicitud.' }}
        </app-alert-banner>
      }
    </div>
  `,
})
export class InstanceDetailPageComponent implements OnInit {
  private readonly api = inject(WorkflowsApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly destroyRef = inject(DestroyRef);

  private readonly stageForm = viewChild(WorkflowStageFormComponent);

  readonly headerActions = [
    { id: 'board', label: 'Tablero', icon: 'layout-dashboard', variant: 'outline' as const },
  ];

  readonly detail = signal<WorkflowInstanceDetail | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal('');

  readonly comment = signal('');
  readonly commentError = signal<string | undefined>(undefined);
  readonly submitting = signal<string | null>(null);
  readonly claiming = signal(false);
  readonly uploadingKey = signal<string | null>(null);
  readonly requirementErrors = signal<string[]>([]);

  /** One per user action; kept across retries of an uncertain failure. */
  private completeKey: { outcome: string; key: string } | null = null;
  private instanceId = 0;

  readonly timeline = computed(() =>
    [...(this.detail()?.timeline ?? [])].sort((a, b) => b.seq - a.seq),
  );

  readonly pendingKeys = computed(
    () => new Set((this.detail()?.pending_requirements ?? []).map((p) => p.key)),
  );
  readonly pendingLabels = computed(() =>
    (this.detail()?.pending_requirements ?? []).map((p) => p.label).join(', '),
  );
  readonly blocked = computed(() => this.pendingKeys().size > 0);

  readonly requirementLabels = computed<Record<string, string>>(() => {
    const labels: Record<string, string> = {};
    for (const req of this.detail()?.stage?.requirements ?? []) labels[req.key] = req.label;
    for (const field of this.detail()?.stage?.form_fields ?? []) labels[field.key] = field.label;
    return labels;
  });

  readonly actionableTask = computed<TaskView | null>(() => {
    const tasks = this.detail()?.tasks ?? [];
    return (
      tasks.find((t) => (t.status === 'open' || t.status === 'claimed') && t.can_act) ?? null
    );
  });

  readonly statusText = computed(() => instanceStatusLabel(this.detail()?.status ?? ''));
  readonly statusColor = computed<StickyBadgeColor>(
    () => BADGE_COLOR[instanceStatusTone(this.detail()?.status ?? '')] ?? 'gray',
  );
  readonly overdue = computed(() => isOverdue(this.detail()?.stage_due_at ?? null));
  readonly dueLabel = computed(() => dueText(this.detail()?.stage_due_at ?? null));
  readonly headerMeta = computed(() => {
    const d = this.detail();
    if (!d) return '';
    const parts = [`Etapa: ${d.stage?.name ?? '—'}`];
    if (d.status === 'active') parts.push(this.dueLabel());
    return parts.join(' · ');
  });

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = Number(params.get('id'));
      if (!Number.isInteger(id) || id <= 0) {
        this.loading.set(false);
        this.loadError.set('La solicitud indicada no existe.');
        return;
      }
      this.instanceId = id;
      this.detail.set(null);
      this.reload(true);
    });
  }

  onHeaderAction(id: string): void {
    const definitionId = this.detail()?.definition.id;
    if (id === 'board' && definitionId) {
      this.router.navigate(['/admin/workflows', definitionId, 'board']);
    }
  }

  // ─── Template helpers ────────────────────────────────────────────────

  isPending(key: string): boolean {
    return this.pendingKeys().has(key);
  }

  canUpload(req: StageRequirementView): boolean {
    return UPLOADABLE_KINDS.includes(req.kind) && this.detail()?.status === 'active';
  }

  acceptOf(req: StageRequirementView): string | null {
    return req.accept?.length ? req.accept.join(',') : null;
  }

  claimable(task: TaskView): boolean {
    return task.status === 'open' && task.assignee?.type !== 'user';
  }

  assigneeText(task: TaskView): string {
    const a = task.assignee;
    if (!a) return 'tu equipo';
    const kind = a.type === 'group' ? 'el grupo' : a.type === 'role' ? 'el rol' : '';
    return `${kind} ${a.name ?? ''}`.trim();
  }

  openAssignees(): string {
    const names = (this.detail()?.tasks ?? [])
      .filter((t) => t.status === 'open' || t.status === 'claimed')
      .map((t) => t.assignee?.name)
      .filter((n): n is string => !!n);
    return names.length ? [...new Set(names)].join(', ') : 'otra persona';
  }

  outcomeText(outcome: string): string {
    return outcomeLabel(outcome);
  }

  outcomeVariant(outcome: string): 'primary' | 'outline-danger' | 'outline' {
    if (outcome === 'reject') return 'outline-danger';
    if (outcome === 'return') return 'outline';
    return 'primary';
  }

  isOutcomeDisabled(outcome: string): boolean {
    if (this.submitting() !== null) return true;
    return outcomeBlockedByRequirements(outcome) && this.blocked();
  }

  eventText(event: TimelineEventView): string {
    return eventLabel(event.type);
  }

  eventComment(event: TimelineEventView): string {
    const note = event.payload?.['comment'];
    return typeof note === 'string' ? note : '';
  }

  dateText(value: string): string {
    return formatStoreDateTime(value, this.settings.timezone());
  }

  onCommentChange(value: string): void {
    this.comment.set(value ?? '');
    this.commentError.set(undefined);
  }

  // ─── Actions ─────────────────────────────────────────────────────────

  claim(task: TaskView): void {
    this.claiming.set(true);
    this.api.claimTask(task.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: () => {
        this.claiming.set(false);
        this.toast.success('Tarea tomada');
        this.reload();
      },
      error: (error) => {
        this.claiming.set(false);
        const parsed = toWorkflowError(error);
        this.toast.error(parsed.message);
        if (isStaleCode(parsed.code)) this.reload();
      },
    });
  }

  onRequirementFile(req: StageRequirementView, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const d = this.detail();
    if (!file || !d) return;
    this.requirementErrors.set([]);
    if (req.max_size_mb && file.size > req.max_size_mb * 1024 * 1024) {
      this.requirementErrors.set([`El archivo supera el máximo de ${req.max_size_mb} MB.`]);
      return;
    }
    this.uploadingKey.set(req.key);
    this.api.uploadInstanceFile(d.id, file, { requirement_key: req.key })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: () => {
        this.uploadingKey.set(null);
        this.toast.success('Archivo cargado');
        this.reload();
      },
      error: (error) => {
        this.uploadingKey.set(null);
        this.requirementErrors.set([toWorkflowError(error).message]);
      },
    });
  }

  submit(task: TaskView, outcome: string): void {
    const d = this.detail();
    if (!d || this.submitting() !== null) return;
    const result = this.stageForm()?.collect() ?? { ok: true, values: {} };
    if (!result.ok) {
      this.toast.warning('Revisa los campos marcados antes de continuar.');
      return;
    }
    if (this.completeKey?.outcome !== outcome) {
      this.completeKey = { outcome, key: crypto.randomUUID() };
    }
    const comment = this.comment().trim();
    this.submitting.set(outcome);
    this.api
      .completeTask(
        task.id,
        {
          outcome,
          ...(Object.keys(result.values).length ? { values: result.values } : {}),
          ...(comment ? { comment } : {}),
          expected_row_version: d.row_version,
        },
        this.completeKey.key,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.submitting.set(null);
          this.completeKey = null;
          this.comment.set('');
          this.toast.success('Tarea completada');
          this.reload();
        },
        error: (error) => {
          this.submitting.set(null);
          this.handleCompleteError(error);
        },
      });
  }

  private handleCompleteError(error: unknown): void {
    const parsed = toWorkflowError(error);
    // A 4xx is a definitive refusal; only an uncertain outcome keeps the key.
    if (parsed.status !== null && parsed.status >= 400 && parsed.status < 500) {
      this.completeKey = null;
    }
    switch (parsed.code) {
      case 'WORKFLOW_STALE':
      case 'WORKFLOW_TASK_CLOSED':
        this.toast.error(parsed.message);
        this.reload();
        return;
      case 'WORKFLOW_REQUIREMENT_PENDING':
        this.toast.error(parsed.message);
        this.reload();
        return;
      case 'WORKFLOW_COMMENT_REQUIRED':
        this.commentError.set(parsed.message);
        return;
      case 'WORKFLOW_FORM_INVALID': {
        const details = parsed.details as {
          errors?: { field?: string; message?: string }[];
        } | null;
        let placed = false;
        for (const issue of details?.errors ?? []) {
          if (issue.field && issue.message) {
            this.stageForm()?.fail(issue.field, issue.message);
            placed = true;
          }
        }
        this.toast.error(placed ? 'Revisa los campos marcados.' : parsed.message);
        return;
      }
      default:
        this.toast.error(parsed.message);
    }
  }

  // ─── Loading ─────────────────────────────────────────────────────────

  private reload(initial = false): void {
    if (initial) this.loading.set(true);
    this.api
      .getInstance(this.instanceId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.detail.set(detail);
          this.loading.set(false);
          this.loadError.set('');
        },
        error: (error) => {
          this.loading.set(false);
          if (initial || !this.detail()) {
            this.loadError.set(toWorkflowError(error).message);
          } else {
            this.toast.error(toWorkflowError(error).message);
          }
        },
      });
  }
}
