import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import {
  CardComponent,
  EmptyStateComponent,
  ItemListCardConfig,
  PaginationComponent,
  ResponsiveDataViewComponent,
  SelectorComponent,
  StatsComponent,
  StickyHeaderComponent,
  TableAction,
  TableColumn,
  ToastService,
  ToggleComponent,
} from '../../../../../../shared/components/index';
import { WorkflowCommentOutcomeModalComponent } from '../../components/comment-outcome-modal.component';
import { InboxTaskRow } from '../../interfaces/workflow-ops.interfaces';
import { WorkflowsApiService } from '../../services/workflows-api.service';
import { isStaleCode, toWorkflowError } from '../../utils/workflow-errors.util';
import { dueText, outcomeLabel } from '../../utils/workflow-labels.util';

interface InboxRowView extends InboxTaskRow {
  reference: string;
  title: string;
  definition_label: string;
  due_text: string;
  assignee_text: string;
}

/** Outcomes that must carry a comment (the backend requires it too). */
const COMMENT_OUTCOMES = ['reject', 'return'];

const ICONS: Record<string, string> = {
  submit: 'send',
  approve: 'check',
  reject: 'x',
  return: 'rotate-ccw',
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todas' },
  { value: 'open', label: 'Por tomar' },
  { value: 'claimed', label: 'Tomadas' },
];

/**
 * "Mis tareas": open tasks the caller can act on, with quick actions per
 * `quick_outcomes`. A completed row disappears; if someone else got there
 * first the backend message is shown and the list reloads.
 */
@Component({
  selector: 'app-workflow-inbox-page',
  standalone: true,
  imports: [
    FormsModule,
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    SelectorComponent,
    ToggleComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
    WorkflowCommentOutcomeModalComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Mis tareas"
        subtitle="Lo que está esperando tu atención en los flujos"
        icon="inbox"
        variant="glass"
        [showBackButton]="true"
        backRoute="/admin/workflows"
      />

      <div class="stats-container sticky top-[52px] z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Tareas"
          [value]="stats().total"
          smallText="Pendientes para ti"
          iconName="inbox"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
          [loading]="statsLoading()"
        />
        <app-stats
          title="Vencidas"
          [value]="stats().overdue"
          smallText="Pasaron su plazo"
          iconName="alert-triangle"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
          [loading]="statsLoading()"
        />
        <app-stats
          title="Por tomar"
          [value]="stats().open"
          smallText="Sin quien las atienda aún"
          iconName="user-check"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
          [loading]="statsLoading()"
        />
      </div>

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:items-end">
            <app-selector
              label="Flujo"
              placeholder="Todos los flujos"
              [options]="definitionOptions()"
              [value]="definitionFilter()"
              (valueChange)="onDefinition($event)"
            />
            <app-selector
              label="Estado"
              [options]="statusOptions"
              [value]="statusFilter()"
              (valueChange)="onStatus($event)"
            />
            <app-toggle
              label="Solo vencidas"
              [checked]="overdueOnly()"
              (toggled)="onOverdue($event)"
            />
          </div>
          <h2 class="mt-2 text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
            Tareas ({{ totalItems() }})
          </h2>
        </div>

        @if (loading()) {
          <div class="p-4 md:p-6 text-center">
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p class="mt-2 text-text-secondary">Cargando...</p>
          </div>
        } @else if (totalItems() === 0) {
          <app-empty-state
            icon="check-circle"
            title="No tienes tareas pendientes"
            description="Cuando una solicitud te toque atender, aparecerá aquí."
            [showActionButton]="false"
          />
        } @else {
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="rows()"
              [columns]="columns"
              [actions]="actions"
              [cardConfig]="card"
              [sortable]="false"
              emptyMessage="No hay tareas"
              emptyIcon="inbox"
            />
            <div class="mt-4 flex justify-center">
              <app-pagination
                [currentPage]="page()"
                [totalPages]="totalPages()"
                [total]="totalItems()"
                [limit]="limit"
                (pageChange)="onPageChange($event)"
              />
            </div>
          </div>
        }
      </app-card>
    </div>

    <app-workflow-comment-outcome-modal
      [(isOpen)]="commentOpen"
      [title]="commentTitle()"
      [subtitle]="commentTarget()?.instance?.reference ?? ''"
      [confirmText]="commentConfirm()"
      [busy]="commentBusy()"
      [errorMessage]="commentError()"
      (confirmed)="onCommentConfirmed($event)"
    />
  `,
})
export class InboxPageComponent implements OnInit {
  private readonly api = inject(WorkflowsApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly limit = 10;
  readonly statusOptions = STATUS_OPTIONS;

  readonly page = signal(1);
  readonly totalItems = signal(0);
  readonly loading = signal(false);
  readonly tasks = signal<InboxTaskRow[]>([]);
  readonly stats = signal({ total: 0, overdue: 0, open: 0 });
  readonly statsLoading = signal(true);
  readonly totalPages = computed(() => Math.ceil(this.totalItems() / this.limit) || 1);

  readonly statusFilter = signal<string>('all');
  readonly overdueOnly = signal(false);
  readonly definitionFilter = signal<string>('all');
  readonly definitionOptions = signal<{ value: string; label: string }[]>([
    { value: 'all', label: 'Todos los flujos' },
  ]);

  readonly commentOpen = signal(false);
  readonly commentTarget = signal<InboxTaskRow | null>(null);
  readonly commentOutcome = signal('reject');
  readonly commentBusy = signal(false);
  readonly commentError = signal('');
  readonly commentTitle = computed(() => `${outcomeLabel(this.commentOutcome())} solicitud`);
  readonly commentConfirm = computed(() => outcomeLabel(this.commentOutcome()));

  /** Idempotency key per `task:outcome`, kept while the outcome is uncertain. */
  private readonly keys = new Map<string, string>();
  private readonly inFlight = new Set<number>();

  readonly rows = computed<InboxRowView[]>(() =>
    this.tasks().map((t) => ({
      ...t,
      reference: t.instance.reference,
      title: t.instance.title,
      definition_label: t.definition.name ?? '—',
      due_text: dueText(t.due_at),
      assignee_text: t.assignee?.name ?? 'Sin responsable',
    })),
  );

  readonly columns: TableColumn[] = [
    { key: 'reference', label: 'Referencia', priority: 1, width: '130px' },
    { key: 'title', label: 'Solicitud', priority: 1 },
    { key: 'definition_label', label: 'Flujo', priority: 3 },
    { key: 'stage_name', label: 'Etapa', priority: 2 },
    {
      key: 'due_text',
      label: 'Vence',
      priority: 1,
      cellClass: (_value: string, item?: InboxRowView) =>
        item?.overdue ? 'text-error font-medium' : '',
    },
  ];

  readonly card: ItemListCardConfig = {
    titleKey: 'title',
    subtitleKey: 'reference',
    avatarFallbackIcon: 'inbox',
    avatarShape: 'square',
    detailKeys: [
      { key: 'definition_label', label: 'Flujo', icon: 'git-branch' },
      { key: 'stage_name', label: 'Etapa', icon: 'layers' },
      { key: 'due_text', label: 'Vence', icon: 'clock' },
    ],
  };

  readonly actions: TableAction[] = [
    ...(['submit', 'approve', 'reject', 'return'] as const).map(
      (outcome): TableAction => ({
        label: outcomeLabel(outcome),
        icon: ICONS[outcome],
        variant: outcome === 'reject' ? 'danger' : outcome === 'approve' ? 'success' : 'primary',
        show: (row: InboxRowView) => row.quick_outcomes.includes(outcome),
        action: (row: InboxRowView) => this.quick(row, outcome),
      }),
    ),
    {
      label: 'Abrir',
      icon: 'eye',
      variant: 'info',
      action: (row: InboxRowView) => this.open(row),
    },
  ];

  ngOnInit(): void {
    this.api
      .listDefinitions({ limit: 100, status: 'published' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) =>
          this.definitionOptions.set([
            { value: 'all', label: 'Todos los flujos' },
            ...(res.data ?? []).map((d) => ({ value: String(d.id), label: d.name })),
          ]),
      });
    this.load();
    this.loadStats();
  }

  onDefinition(value: unknown): void {
    this.definitionFilter.set(String(value ?? 'all'));
    this.reset();
  }

  onStatus(value: unknown): void {
    this.statusFilter.set(String(value ?? 'all'));
    this.reset();
  }

  onOverdue(value: boolean): void {
    this.overdueOnly.set(value === true);
    this.reset();
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  open(row: InboxTaskRow): void {
    this.router.navigate(['/admin/workflows/instances', row.instance.id]);
  }

  quick(row: InboxTaskRow, outcome: string): void {
    if (COMMENT_OUTCOMES.includes(outcome)) {
      this.commentTarget.set(row);
      this.commentOutcome.set(outcome);
      this.commentError.set('');
      this.commentOpen.set(true);
      return;
    }
    this.complete(row, outcome);
  }

  onCommentConfirmed(comment: string): void {
    const row = this.commentTarget();
    if (row) this.complete(row, this.commentOutcome(), comment);
  }

  private complete(row: InboxTaskRow, outcome: string, comment?: string): void {
    if (this.inFlight.has(row.task_id)) return;
    this.inFlight.add(row.task_id);
    const slot = `${row.task_id}:${outcome}`;
    const key = this.keys.get(slot) ?? crypto.randomUUID();
    this.keys.set(slot, key);
    this.commentBusy.set(true);
    this.api
      .completeTask(
        row.task_id,
        {
          outcome,
          ...(comment ? { comment } : {}),
          expected_row_version: row.instance.row_version,
        },
        key,
      )
      .subscribe({
        next: () => {
          this.inFlight.delete(row.task_id);
          this.keys.delete(slot);
          this.commentBusy.set(false);
          this.commentOpen.set(false);
          this.tasks.update((list) => list.filter((t) => t.task_id !== row.task_id));
          this.totalItems.update((n) => Math.max(0, n - 1));
          this.toast.success('Tarea completada');
          this.loadStats();
          if (this.tasks().length === 0 && this.page() > 1) this.onPageChange(this.page() - 1);
        },
        error: (error) => {
          this.inFlight.delete(row.task_id);
          this.commentBusy.set(false);
          const parsed = toWorkflowError(error);
          if (parsed.status !== null && parsed.status >= 400 && parsed.status < 500) {
            this.keys.delete(slot);
          }
          if (this.commentOpen() && parsed.code === 'WORKFLOW_COMMENT_REQUIRED') {
            this.commentError.set(parsed.message);
            return;
          }
          this.commentOpen.set(false);
          this.toast.error(parsed.message);
          if (isStaleCode(parsed.code)) {
            this.load();
            this.loadStats();
          }
        },
      });
  }

  private reset(): void {
    this.page.set(1);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    const status = this.statusFilter();
    const definition = this.definitionFilter();
    this.api
      .listInbox({
        page: this.page(),
        limit: this.limit,
        ...(status !== 'all' ? { status: status as 'open' | 'claimed' } : {}),
        ...(this.overdueOnly() ? { overdue: true } : {}),
        ...(definition !== 'all' ? { definition_id: Number(definition) } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.tasks.set(res.data ?? []);
          this.totalItems.set(res.meta?.total ?? res.data?.length ?? 0);
          this.loading.set(false);
        },
        error: (error) => {
          this.loading.set(false);
          this.toast.error(toWorkflowError(error).message);
        },
      });
  }

  private loadStats(): void {
    this.statsLoading.set(true);
    forkJoin({
      total: this.api.listInbox({ limit: 1 }),
      overdue: this.api.listInbox({ limit: 1, overdue: true }),
      open: this.api.listInbox({ limit: 1, status: 'open' }),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.stats.set({
            total: res.total.meta?.total ?? 0,
            overdue: res.overdue.meta?.total ?? 0,
            open: res.open.meta?.total ?? 0,
          });
          this.statsLoading.set(false);
        },
        error: () => this.statsLoading.set(false),
      });
  }
}
