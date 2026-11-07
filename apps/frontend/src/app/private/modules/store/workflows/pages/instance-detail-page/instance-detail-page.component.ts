import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
import { TrackingLinksCardComponent } from '../../tracking/tracking-links-card.component';
import {
  FailedActionView,
  ParallelBranchStatus,
  StageRequirementView,
  TaskView,
  TimelineEventView,
  WorkflowInstanceDetail,
} from '../../interfaces/workflow.interfaces';
import { WorkflowsApiService } from '../../services/workflows-api.service';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { apiErrorMessage, isStaleCode, toWorkflowError } from '../../utils/workflow-errors.util';
import {
  countdownText,
  dueText,
  eventDescription,
  instanceStatusLabel,
  instanceSubject,
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
    RouterLink,
    CurrencyPipe,
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
    TrackingLinksCardComponent,
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

        @if (subject(); as s) {
          <p class="mb-3 px-1 text-sm" data-testid="instance-subject">
            @if (s.link) {
              <a class="font-medium text-primary hover:underline" [routerLink]="s.link">{{ s.text }}</a>
            } @else {
              <span class="text-text-secondary">{{ s.text }}</span>
            }
          </p>
        }

        @if (d.parent; as parent) {
          <p class="mb-3 px-1 text-sm" data-testid="instance-parent">
            <a class="font-medium text-primary hover:underline" [routerLink]="['/admin/workflows/instances', parent.id]">
              Hija de {{ parent.reference }}
            </a>
            <span class="text-text-secondary"> · {{ parent.title }}</span>
          </p>
        }

        @if (d.definition.is_enabled === false && d.status === 'active') {
          <app-alert-banner variant="info" icon="power" class="mb-3 block" data-testid="definition-disabled">
            Este flujo está apagado: no inicia solicitudes nuevas, pero esta sigue su curso.
          </app-alert-banner>
        }

        @if (d.failed_actions?.length) {
          <div class="mb-3 flex flex-col gap-2" data-testid="failed-actions">
            @for (fa of d.failed_actions; track fa.id) {
              <app-alert-banner variant="danger" icon="alert-triangle">
                <div class="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div class="min-w-0">
                    <p class="text-sm font-semibold">Acción fallida · {{ fa.label }}</p>
                    <p class="break-words text-xs">{{ fa.error }} ({{ fa.attempts }} {{ fa.attempts === 1 ? 'intento' : 'intentos' }}, {{ dateText(fa.failed_at) }})</p>
                  </div>
                  <app-button variant="outline" size="sm" [loading]="retryingId() === fa.id" [disabled]="retryingId() !== null" (clicked)="retryAction(fa)">
                    <app-icon name="rotate-cw" [size]="14" slot="icon" />
                    Reintentar
                  </app-button>
                </div>
              </app-alert-banner>
            }
          </div>
        }

        <div class="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div class="flex flex-col gap-4 lg:col-span-3">
            @if (d.wait; as wait) {
              @if (d.status === 'active') {
                <app-card title="Espera" [responsivePadding]="true">
                  <div class="flex flex-col gap-1" data-testid="wait-card">
                    <p class="text-base font-semibold text-text-primary">Espera: {{ countdown() }}</p>
                    <p class="text-sm text-text-secondary">Reanuda el {{ dateText(wait.until) }}</p>
                  </div>
                </app-card>
              }
            }
            @if (d.parallel; as parallel) {
              <app-card title="Ramas en paralelo" [responsivePadding]="true">
                <div class="flex flex-col gap-2" data-testid="parallel-card">
                  <p class="text-base font-semibold text-text-primary">
                    Ramas: {{ parallel.done }} de {{ parallel.total }}
                    <span class="text-sm font-normal text-text-secondary">· {{ joinText() }}</span>
                  </p>
                  <ul class="flex flex-col gap-2">
                    @for (branch of parallel.branches; track branch.key) {
                      <li class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-2" [attr.data-branch]="branch.key">
                        <span class="text-sm font-medium text-text-primary">{{ branch.name }}</span>
                        <span class="flex items-center gap-2 text-xs text-text-secondary">
                          @if (branch.completed_by_name) { {{ branch.completed_by_name }} · }
                          @if (branch.completed_at) { {{ dateText(branch.completed_at) }} }
                          <app-badge [variant]="branchTone(branch.status)" size="xs">{{ branchText(branch.status) }}</app-badge>
                        </span>
                      </li>
                    }
                  </ul>
                </div>
              </app-card>
            }
            @if (requestData().length > 0) {
              <app-card title="Datos de la solicitud" [responsivePadding]="true">
                <dl class="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2" data-testid="instance-data">
                  @for (row of requestData(); track row.key) {
                    <div class="min-w-0">
                      <dt class="text-xs text-text-secondary">{{ row.label }}</dt>
                      <dd class="break-words font-medium text-text-primary">
                        @if (row.money) {
                          {{ row.number | currency }}
                        } @else {
                          {{ row.value }}
                        }
                      </dd>
                    </div>
                  }
                </dl>
              </app-card>
            }
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

                @if (d.parallel && actionableTasks().length > 0) {
                  <div class="flex flex-col gap-4" data-testid="branch-tasks">
                    @for (task of actionableTasks(); track task.id) {
                      <section class="flex flex-col gap-3 rounded-xl border border-border p-3" [attr.data-branch-task]="task.branch_key">
                        <h3 class="text-sm font-semibold text-text-primary">Rama: {{ task.branch_name ?? task.branch_key }}</h3>
                        @if (claimable(task)) {
                          <div class="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
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
                          #branchForm
                          [fields]="task.form_fields ?? []"
                          [instanceData]="d.data"
                          [instanceId]="d.id"
                          [seedKey]="d.id + ':' + task.id"
                        />
                        <div class="flex justify-end">
                          <app-button
                            variant="primary"
                            [disabled]="submitting() !== null"
                            [loading]="submitting() === 'branch:' + task.id"
                            (clicked)="submit(task, 'submit', branchForm, 'branch:' + task.id)"
                          >
                            Enviar rama
                          </app-button>
                        </div>
                      </section>
                    }
                    @if (guardMessage(); as message) {
                      <app-alert-banner variant="danger" icon="shield-check" data-testid="guard-blocked">{{ message }}</app-alert-banner>
                    }
                  </div>
                } @else if (!d.parallel && actionableTask(); as task) {
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

                  @if (guardMessage(); as message) {
                    <app-alert-banner variant="danger" icon="shield-check" class="mt-4 block" data-testid="guard-blocked">{{ message }}</app-alert-banner>
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
            @if (d.children?.length) {
              <app-card title="Subflujos" [responsivePadding]="true">
                <ul class="flex flex-col gap-2" data-testid="children">
                  @for (child of d.children; track child.id) {
                    <li class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-2">
                      <a class="min-w-0 text-sm font-medium text-primary hover:underline" [routerLink]="['/admin/workflows/instances', child.id]">
                        {{ child.reference }} · {{ child.definition_name }}
                      </a>
                      <span class="flex items-center gap-2 text-xs text-text-secondary">
                        @if (child.current_stage_name) { {{ child.current_stage_name }} }
                        <app-badge [variant]="childTone(child.status)" size="xs">{{ statusLabel(child.status) }}</app-badge>
                      </span>
                    </li>
                  }
                </ul>
              </app-card>
            }
            <app-card title="Expediente" [responsivePadding]="true" overflow="visible">
              <app-dossier-items-list
                [items]="d.dossier?.items ?? []"
                [labels]="requirementLabels()"
              />
            </app-card>

            <app-tracking-links-card [instanceId]="d.id" />

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
                    @if (eventChild(event); as child) {
                      <a class="text-xs text-primary hover:underline" [routerLink]="['/admin/workflows/instances', child.id]">Ver {{ child.reference }}</a>
                    }
                    <p class="text-xs text-text-secondary">
                      {{ actorText(event) }} · {{ dateText(event.occurred_at) }}
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
  private completeKey: { taskId: number; outcome: string; key: string } | null = null;
  private instanceId = 0;

  /** P2.5: the guard message that blocked the last attempt; the task stays open. */
  readonly guardMessage = signal<string | null>(null);
  /** P2.7: the failed action being retried. */
  readonly retryingId = signal<number | null>(null);
  /** P2.3: ticks every second while the request waits, to draw the countdown. */
  private readonly now = signal(Date.now());
  private tick: ReturnType<typeof setInterval> | null = null;
  private waitReload: ReturnType<typeof setTimeout> | null = null;

  readonly countdown = computed(() => {
    const until = this.detail()?.wait?.until;
    return until ? this.countdownLabel(until) : '';
  });

  constructor() {
    effect(() => {
      const waiting = !!this.detail()?.wait && this.detail()?.status === 'active';
      if (waiting && this.tick === null) {
        this.tick = setInterval(() => this.onTick(), 1000);
      } else if (!waiting) {
        this.stopTimers();
      }
    });
    this.destroyRef.onDestroy(() => this.stopTimers());
  }

  private onTick(): void {
    this.now.set(Date.now());
    const until = this.detail()?.wait?.until;
    // At zero the engine resumes on its next timer pass: look again shortly.
    if (until && new Date(until).getTime() <= Date.now() && this.waitReload === null) {
      this.waitReload = setTimeout(() => {
        this.waitReload = null;
        this.reload();
      }, 3000);
    }
  }

  private stopTimers(): void {
    if (this.tick !== null) clearInterval(this.tick);
    if (this.waitReload !== null) clearTimeout(this.waitReload);
    this.tick = null;
    this.waitReload = null;
  }

  private countdownLabel(until: string): string {
    const remaining = countdownText(until, this.now());
    return remaining === 'Ya venció' ? 'venció, reanudando…' : `faltan ${remaining}`;
  }

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

  /** Open tasks of the person: every branch of a parallel stage that is theirs. */
  readonly actionableTasks = computed<TaskView[]>(() =>
    (this.detail()?.tasks ?? []).filter(
      (t) => (t.status === 'open' || t.status === 'claimed') && t.can_act,
    ),
  );

  readonly joinText = computed(() => {
    const p = this.detail()?.parallel;
    if (!p) return '';
    if (p.join === 'any') return 'avanza con la primera';
    if (p.join === 'n_of_m') return `avanza con ${p.required ?? 1}`;
    return 'avanza con todas';
  });

  readonly statusText = computed(() => instanceStatusLabel(this.detail()?.status ?? ''));
  readonly statusColor = computed<StickyBadgeColor>(
    () => BADGE_COLOR[instanceStatusTone(this.detail()?.status ?? '')] ?? 'gray',
  );
  readonly overdue = computed(() => isOverdue(this.detail()?.stage_due_at ?? null));
  readonly dueLabel = computed(() => dueText(this.detail()?.stage_due_at ?? null));
  readonly subject = computed(() => {
    const d = this.detail();
    return d ? instanceSubject(d.subject_type, d.subject_id) : null;
  });
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

  /**
   * P1.5: the data the request carries (filled fields only), labelled with the
   * definition, so whoever decides sees supplier, amount and products here
   * even when the current stage has no form. Files live in the dossier.
   */
  readonly requestData = computed(() => {
    const d = this.detail();
    if (!d) return [];
    const data = d.data ?? {};
    return (d.data_fields ?? [])
      .filter((f) => f.type !== 'file')
      .map((f) => ({ key: f.key, label: f.label, type: f.type, raw: data[f.key] }))
      .filter((f) => f.raw !== undefined && f.raw !== null && f.raw !== '')
      .map((f) => ({
        key: f.key,
        label: f.label,
        money: f.type === 'money' && typeof f.raw === 'number',
        value:
          typeof f.raw === 'boolean'
            ? f.raw
              ? 'Sí'
              : 'No'
            : Array.isArray(f.raw)
              ? f.raw.join(', ')
              : String(f.raw),
        number: typeof f.raw === 'number' ? f.raw : null,
      }));
  });

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
    const payload = event.payload ?? {};
    switch (event.type) {
      // P3: events written by the tracking portal and the inbound mailbox.
      case 'external_upload': {
        const label = payload['label'];
        return `Documento enviado por el solicitante${typeof label === 'string' ? `: ${label}` : ''}`;
      }
      case 'external_message':
        return 'Respuesta del solicitante';
      case 'email_received':
        return 'Correo recibido';
      default:
        return eventDescription(event.type, event.payload);
    }
  }

  /** Who did it: the person, the requester (public) or the system. */
  actorText(event: TimelineEventView): string {
    if (event.actor_name) return event.actor_name;
    return event.type === 'external_upload' || event.type === 'external_message'
      ? 'Solicitante externo'
      : 'Sistema';
  }

  /** The child request a subflow event points to, for the link in the timeline. */
  eventChild(event: TimelineEventView): { id: number; reference: string } | null {
    if (event.type !== 'subflow_started' && event.type !== 'subflow_closed') return null;
    const id = Number(event.payload?.['child_id']);
    const reference = event.payload?.['child_reference'];
    return Number.isInteger(id) && id > 0 && typeof reference === 'string' ? { id, reference } : null;
  }

  statusLabel(status: string): string {
    return instanceStatusLabel(status);
  }

  childTone(status: string): 'info' | 'success' | 'error' | 'neutral' | 'warning' | 'primary' {
    return instanceStatusTone(status);
  }

  branchText(status: ParallelBranchStatus): string {
    return status === 'done' ? 'Hecha' : status === 'cancelled' ? 'Cancelada' : 'Pendiente';
  }

  branchTone(status: ParallelBranchStatus): 'success' | 'neutral' | 'warning' {
    return status === 'done' ? 'success' : status === 'cancelled' ? 'neutral' : 'warning';
  }

  eventComment(event: TimelineEventView): string {
    const note = event.payload?.['comment'] ?? event.payload?.['message'];
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

  retryAction(action: FailedActionView): void {
    if (this.retryingId() !== null) return;
    this.retryingId.set(action.id);
    this.api
      .retryFailedAction(this.instanceId, action.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.retryingId.set(null);
          this.toast.success('Acción reenviada a la cola');
          this.reload();
        },
        error: (error) => {
          this.retryingId.set(null);
          // A 403 carries its own wording (needs the manage permission).
          this.toast.error(apiErrorMessage(error));
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

  /**
   * `form`/`tag` let a branch of a parallel stage submit its own form; the
   * default is the stage form and the outcome as the loading tag.
   */
  submit(
    task: TaskView,
    outcome: string,
    form: WorkflowStageFormComponent | undefined = this.stageForm(),
    tag: string = outcome,
  ): void {
    const d = this.detail();
    if (!d || this.submitting() !== null) return;
    this.guardMessage.set(null);
    const result = form?.collect() ?? { ok: true, values: {} };
    if (!result.ok) {
      this.toast.warning('Revisa los campos marcados antes de continuar.');
      return;
    }
    if (this.completeKey?.outcome !== outcome || this.completeKey.taskId !== task.id) {
      this.completeKey = { taskId: task.id, outcome, key: crypto.randomUUID() };
    }
    const comment = this.comment().trim();
    this.submitting.set(tag);
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
          this.handleCompleteError(error, form);
        },
      });
  }

  private handleCompleteError(error: unknown, form: WorkflowStageFormComponent | undefined): void {
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
      case 'WORKFLOW_GUARD_BLOCKED':
        // The guard's own message; the task stays open.
        this.guardMessage.set(parsed.message);
        this.toast.error(parsed.message);
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
            form?.fail(issue.field, issue.message);
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
