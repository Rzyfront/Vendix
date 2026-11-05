import { CdkDropListGroup } from '@angular/cdk/drag-drop';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import {
  AlertBannerComponent,
  CardComponent,
  EmptyStateComponent,
  StickyHeaderComponent,
  StoreUserSelectComponent,
  ToastService,
  ToggleComponent,
} from '../../../../../../shared/components/index';
import {
  BoardMoveRequest,
  WorkflowBoardColumnComponent,
} from '../../components/board-column.component';
import { WorkflowBoardMoveModalComponent } from '../../components/board-move-modal.component';
import {
  BoardCard,
  BoardColumn,
  BoardData,
  BoardMove,
  BoardQuery,
} from '../../interfaces/workflow-ops.interfaces';
import { WorkflowsApiService } from '../../services/workflows-api.service';
import { isStaleCode, toWorkflowError } from '../../utils/workflow-errors.util';

const NO_SOURCES: ReadonlySet<string> = new Set<string>();

/**
 * Kanban of one flow: a column per stage. A card can only go to the targets
 * of its column's `moves` (drag or the "Mover a…" select); moves that need
 * input open a modal, the rest complete the open task directly.
 */
@Component({
  selector: 'app-workflow-board-page',
  standalone: true,
  imports: [
    CdkDropListGroup,
    StickyHeaderComponent,
    CardComponent,
    ToggleComponent,
    StoreUserSelectComponent,
    EmptyStateComponent,
    AlertBannerComponent,
    WorkflowBoardColumnComponent,
    WorkflowBoardMoveModalComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        [title]="'Tablero · ' + (board()?.definition?.name ?? 'Flujo')"
        subtitle="Arrastra una solicitud a la etapa siguiente o usa «Mover a…»"
        icon="layout-dashboard"
        variant="glass"
        [showBackButton]="true"
        backRoute="/admin/workflows"
        [actions]="headerActions"
        (actionClicked)="onHeaderAction($event)"
      />

      <app-card [responsive]="true" overflow="visible">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
          <div class="flex flex-col gap-1">
            <span class="text-sm font-medium text-text-primary">Responsable</span>
            <app-store-user-select
              [value]="assignee()"
              (valueChange)="onAssignee($event)"
            />
          </div>
          <app-toggle
            label="Solo vencidas"
            [checked]="overdueOnly()"
            (toggled)="onOverdue($event)"
          />
        </div>
      </app-card>

      @if (loading()) {
        <div class="p-6 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Cargando tablero...</p>
        </div>
      } @else if (loadError()) {
        <app-alert-banner variant="danger" icon="alert-triangle">{{ loadError() }}</app-alert-banner>
      } @else if (columns().length === 0) {
        <app-empty-state
          icon="layout-dashboard"
          title="Este flujo aún no tiene versión publicada"
          description="Publica el flujo para ver sus solicitudes en el tablero."
          [showActionButton]="false"
        />
      } @else {
        <div class="mt-3 flex gap-4 overflow-x-auto pb-4" cdkDropListGroup>
          @for (column of columns(); track column.stage_key) {
            <app-workflow-board-column
              class="w-72 min-w-[18rem]"
              [column]="column"
              [names]="names()"
              [allowedFrom]="allowedFrom(column.stage_key)"
              [draggingFrom]="draggingFrom()"
              [loadingMore]="loadingMore() === column.stage_key"
              (moveRequested)="onDragMove($event)"
              (selectMove)="onSelectMove(column, $event.card, $event.target)"
              (loadMore)="loadMore(column)"
              (dragStarted)="draggingFrom.set($event)"
              (dragEnded)="draggingFrom.set(null)"
            />
          }
        </div>
      }
    </div>

    <app-workflow-board-move-modal
      [(isOpen)]="modalOpen"
      [instanceId]="modalInstance()"
      [outcome]="modalOutcome()"
      (finished)="refresh(modalKeys)"
    />
  `,
})
export class BoardPageComponent implements OnInit {
  private readonly api = inject(WorkflowsApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly headerActions = [
    { id: 'analytics', label: 'Analítica', icon: 'bar-chart-3', variant: 'outline' as const },
  ];

  private definitionId = 0;
  readonly board = signal<BoardData | null>(null);
  readonly columns = signal<BoardColumn[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly loadingMore = signal<string | null>(null);
  readonly draggingFrom = signal<string | null>(null);
  readonly overdueOnly = signal(false);
  readonly assignee = signal<number | null>(null);

  readonly modalOpen = signal(false);
  readonly modalInstance = signal(0);
  readonly modalOutcome = signal('submit');
  modalKeys: string[] = [];
  private readonly moving = new Set<number>();

  readonly names = computed<Record<string, string>>(() =>
    Object.fromEntries(this.columns().map((c) => [c.stage_key, c.name])),
  );

  /** Source stage keys that can move into each stage key. */
  private readonly sources = computed(() => {
    const out = new Map<string, Set<string>>();
    for (const column of this.columns()) {
      for (const move of column.moves) {
        const set = out.get(move.to_stage_key) ?? new Set<string>();
        set.add(column.stage_key);
        out.set(move.to_stage_key, set);
      }
    }
    return out;
  });

  allowedFrom(stageKey: string): ReadonlySet<string> {
    return this.sources().get(stageKey) ?? NO_SOURCES;
  }

  onHeaderAction(id: string): void {
    if (id === 'analytics') this.router.navigate(['/admin/workflows', this.definitionId, 'analytics']);
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.definitionId = Number(params.get('id'));
      if (!Number.isInteger(this.definitionId) || this.definitionId <= 0) {
        this.loading.set(false);
        this.loadError.set('El flujo indicado no existe.');
        return;
      }
      this.loadAll();
    });
  }

  onOverdue(value: boolean): void {
    this.overdueOnly.set(value === true);
    this.loadAll();
  }

  onAssignee(value: number | null): void {
    this.assignee.set(typeof value === 'number' ? value : null);
    this.loadAll();
  }

  onDragMove(request: BoardMoveRequest): void {
    this.draggingFrom.set(null);
    const from = this.columns().find((c) => c.stage_key === request.fromKey);
    const move = from?.moves.find((m) => m.to_stage_key === request.toKey);
    if (from && move) this.perform(from, request.card, move);
  }

  onSelectMove(from: BoardColumn, card: BoardCard, target: string): void {
    const [toKey, outcome] = target.split('|');
    const move = from.moves.find((m) => m.to_stage_key === toKey && m.outcome === outcome);
    if (move) this.perform(from, card, move);
  }

  loadMore(column: BoardColumn): void {
    if (!column.next_cursor || this.loadingMore()) return;
    this.loadingMore.set(column.stage_key);
    this.api
      .getBoard(this.definitionId, { ...this.filters(), column: column.stage_key, cursor: column.next_cursor })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const next = res.columns[0];
          this.loadingMore.set(null);
          if (!next) return;
          this.columns.update((list) =>
            list.map((c) =>
              c.stage_key === next.stage_key
                ? { ...next, cards: [...c.cards, ...next.cards] }
                : c,
            ),
          );
        },
        error: (error) => {
          this.loadingMore.set(null);
          this.toast.error(toWorkflowError(error).message);
        },
      });
  }

  /** Reloads the first page of the given columns after a move. */
  refresh(keys: string[]): void {
    const unique = [...new Set(keys)];
    if (unique.length === 0) return this.loadAll();
    forkJoin(
      unique.map((key) => this.api.getBoard(this.definitionId, { ...this.filters(), column: key })),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (results) => {
          const fresh = new Map(results.flatMap((r) => r.columns).map((c) => [c.stage_key, c]));
          this.columns.update((list) => list.map((c) => fresh.get(c.stage_key) ?? c));
        },
        error: (error) => this.toast.error(toWorkflowError(error).message),
      });
  }

  private perform(from: BoardColumn, card: BoardCard, move: BoardMove): void {
    const keys = [from.stage_key, move.to_stage_key];
    if (move.requires_modal) {
      this.modalKeys = keys;
      this.modalInstance.set(card.id);
      this.modalOutcome.set(move.outcome);
      this.modalOpen.set(true);
      return;
    }
    if (this.moving.has(card.id)) return;
    this.moving.add(card.id);
    this.api
      .getInstance(card.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          const task = detail.tasks.find(
            (t) => (t.status === 'open' || t.status === 'claimed') && t.can_act,
          );
          if (detail.current_stage_key !== from.stage_key || !task) {
            this.moving.delete(card.id);
            this.toast.error(
              task
                ? 'Esta solicitud cambió de etapa; se actualizó el tablero.'
                : 'No tienes una tarea para atender en esta solicitud.',
            );
            this.refresh(keys);
            return;
          }
          this.api
            .completeTask(
              task.id,
              { outcome: move.outcome, expected_row_version: detail.row_version },
              crypto.randomUUID(),
            )
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: () => {
                this.moving.delete(card.id);
                this.toast.success(`Movida a ${this.names()[move.to_stage_key] ?? move.to_stage_key}`);
                this.refresh(keys);
              },
              error: (error) => {
                this.moving.delete(card.id);
                const parsed = toWorkflowError(error);
                this.toast.error(parsed.message);
                if (isStaleCode(parsed.code) || parsed.code === 'WORKFLOW_REQUIREMENT_PENDING') {
                  this.refresh(keys);
                }
              },
            });
        },
        error: (error) => {
          this.moving.delete(card.id);
          this.toast.error(toWorkflowError(error).message);
        },
      });
  }

  private filters(): BoardQuery {
    return {
      ...(this.overdueOnly() ? { overdue: true } : {}),
      ...(this.assignee() ? { assignee_user_id: this.assignee() as number } : {}),
    };
  }

  private loadAll(): void {
    this.loading.set(true);
    this.loadError.set('');
    this.api
      .getBoard(this.definitionId, this.filters())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.board.set(res);
          this.columns.set(res.columns);
          this.loading.set(false);
        },
        error: (error) => {
          this.loading.set(false);
          this.loadError.set(toWorkflowError(error).message);
        },
      });
  }
}
