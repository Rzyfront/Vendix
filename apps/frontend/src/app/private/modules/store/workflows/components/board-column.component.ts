import { Component, computed, input, output } from '@angular/core';
import { CdkDrag, CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
import { RouterLink } from '@angular/router';
import { BadgeComponent, ButtonComponent, IconComponent } from '../../../../../shared/components/index';
import { BoardCard, BoardColumn, BoardMove } from '../interfaces/workflow-ops.interfaces';
import { dueText, outcomeLabel } from '../utils/workflow-labels.util';

export interface BoardDragData {
  card: BoardCard;
  fromKey: string;
}

export interface BoardMoveRequest {
  card: BoardCard;
  fromKey: string;
  toKey: string;
}

export interface BoardMoveOption {
  value: string;
  label: string;
}

/**
 * One stage column of the board. Pure presentation: the page decides which
 * drops are valid (`allowedFrom`) and performs the move. Every card also has
 * a "Mover a…" select with the same targets (keyboard alternative to drag).
 */
@Component({
  selector: 'app-workflow-board-column',
  standalone: true,
  imports: [CdkDrag, CdkDropList, RouterLink, BadgeComponent, ButtonComponent, IconComponent],
  styles: [
    `
      :host {
        display: block;
      }
      .cdk-drag-preview {
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
        border-radius: 0.75rem;
      }
      .cdk-drag-placeholder {
        opacity: 0.35;
      }
    `,
  ],
  template: `
    <section
      class="board-column flex flex-col rounded-2xl border bg-[var(--color-background)]"
      [class]="frameClass()"
      [attr.aria-label]="'Etapa ' + column().name"
    >
      <header class="border-b border-[var(--color-border)] px-3 py-2">
        <div class="flex items-center justify-between gap-2">
          <h3 class="truncate text-sm font-semibold text-[var(--color-text-primary)]">
            {{ column().name }}
          </h3>
          <span class="text-xs font-medium text-[var(--color-text-secondary)]">
            {{ column().count }}
          </span>
        </div>
        <div class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          @if (column().overdue_count > 0) {
            <span class="font-medium text-error">{{ column().overdue_count }} vencidas</span>
          }
          @if (column().legacy) {
            <app-badge variant="neutral" size="xs">versión anterior</app-badge>
          }
          @if (dimmed()) {
            <span>No se puede mover aquí</span>
          }
        </div>
      </header>

      <div
        class="flex min-h-[8rem] flex-1 flex-col gap-2 p-2"
        cdkDropList
        [id]="'board-col-' + column().stage_key"
        [cdkDropListData]="column().stage_key"
        [cdkDropListDisabled]="column().legacy === true"
        [cdkDropListEnterPredicate]="enterPredicate"
        [cdkDropListSortingDisabled]="true"
        (cdkDropListDropped)="onDrop($event)"
      >
        @for (card of column().cards; track card.id) {
          <article
            class="rounded-xl border border-[var(--color-border)] bg-surface p-3 shadow-sm"
            [class.cursor-grab]="canDrag()"
            cdkDrag
            [cdkDragDisabled]="!canDrag()"
            [cdkDragData]="dragData(card)"
            (cdkDragStarted)="dragStarted.emit(column().stage_key)"
            (cdkDragEnded)="dragEnded.emit()"
          >
            <a
              class="block text-sm font-semibold text-[var(--color-text-primary)] hover:underline"
              [routerLink]="['/admin/workflows/instances', card.id]"
            >
              {{ card.title }}
            </a>
            <div class="mt-0.5 flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              <span>{{ card.reference }}</span>
              @if (card.has_pending_requirements) {
                <span
                  class="inline-flex items-center gap-0.5 text-warning"
                  role="img"
                  aria-label="Tiene requisitos pendientes"
                  title="Tiene requisitos pendientes"
                >
                  <app-icon name="paperclip" [size]="12" /> Requisitos
                </span>
              }
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span class="text-[var(--color-text-secondary)]">{{ assigneeText(card) }}</span>
              <span class="text-[var(--color-text-secondary)]">· {{ inStage(card) }}</span>
              @if (card.overdue) {
                <app-badge variant="error" size="xs">Vencida · {{ due(card) }}</app-badge>
              }
            </div>
            @if (options().length && card.status === 'active') {
              <select
                class="mt-2 h-8 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 text-xs"
                [attr.aria-label]="'Mover ' + card.reference + ' a'"
                (change)="onSelect(card, $event)"
              >
                <option value="">Mover a…</option>
                @for (option of options(); track option.value) {
                  <option [value]="option.value">{{ option.label }}</option>
                }
              </select>
            }
          </article>
        } @empty {
          <p class="px-1 py-4 text-center text-xs text-[var(--color-text-secondary)]">
            Sin solicitudes
          </p>
        }
        @if (column().next_cursor) {
          <app-button variant="outline" size="sm" [loading]="loadingMore()" (clicked)="loadMore.emit()">
            Cargar más
          </app-button>
        }
      </div>
    </section>
  `,
})
export class WorkflowBoardColumnComponent {
  readonly column = input.required<BoardColumn>();
  /** Source stage keys that have a valid move into this column. */
  readonly allowedFrom = input<ReadonlySet<string>>(new Set());
  /** Stage key of the card being dragged, or `null`. */
  readonly draggingFrom = input<string | null>(null);
  readonly loadingMore = input<boolean>(false);
  readonly canMove = input<boolean>(true);

  readonly moveRequested = output<BoardMoveRequest>();
  /** `target` is `<to_stage_key>|<outcome>`. */
  readonly selectMove = output<{ card: BoardCard; target: string }>();
  readonly loadMore = output<void>();
  readonly dragStarted = output<string>();
  readonly dragEnded = output<void>();

  readonly canDrag = computed(() => this.canMove() && this.column().moves.length > 0);

  /** Dragging, and this column is neither the source nor a valid target. */
  readonly dimmed = computed(() => {
    const from = this.draggingFrom();
    return from !== null && from !== this.column().stage_key && !this.allowedFrom().has(from);
  });
  readonly droppable = computed(() => {
    const from = this.draggingFrom();
    return from !== null && from !== this.column().stage_key && this.allowedFrom().has(from);
  });

  readonly frameClass = computed(() =>
    this.dimmed()
      ? 'border-dashed border-[var(--color-border)] opacity-50'
      : this.droppable()
        ? 'border-primary'
        : 'border-[var(--color-border)]',
  );

  /** Targets of this column's moves, labelled with the outcome when ambiguous. */
  readonly options = computed<BoardMoveOption[]>(() => {
    if (!this.canMove()) return [];
    const moves = this.column().moves;
    const names = this.names();
    const seen = new Set<string>();
    return moves.reduce<BoardMoveOption[]>((acc, move: BoardMove) => {
      const duplicated = moves.filter((m) => m.to_stage_key === move.to_stage_key).length > 1;
      const name = names[move.to_stage_key] ?? move.to_stage_key;
      const label = duplicated ? `${name} (${outcomeLabel(move.outcome)})` : name;
      const value = `${move.to_stage_key}|${move.outcome}`;
      if (!seen.has(value)) {
        seen.add(value);
        acc.push({ value, label });
      }
      return acc;
    }, []);
  });
  /** Stage names by key, to label targets. */
  readonly names = input<Record<string, string>>({});

  readonly enterPredicate = (drag: CdkDrag<BoardDragData>): boolean => {
    const from = drag.data?.fromKey;
    return !!from && from !== this.column().stage_key && this.allowedFrom().has(from);
  };

  dragData(card: BoardCard): BoardDragData {
    return { card, fromKey: this.column().stage_key };
  }

  onDrop(event: CdkDragDrop<string, string, BoardDragData>): void {
    if (event.previousContainer === event.container) return;
    const data = event.item.data;
    this.moveRequested.emit({ card: data.card, fromKey: data.fromKey, toKey: event.container.data });
  }

  onSelect(card: BoardCard, event: Event): void {
    const select = event.target as HTMLSelectElement;
    const value = select.value;
    select.value = '';
    if (value) this.selectMove.emit({ card, target: value });
  }

  assigneeText(card: BoardCard): string {
    return card.assignee?.name ?? 'Sin responsable';
  }

  due(card: BoardCard): string {
    return dueText(card.stage_due_at);
  }

  inStage(card: BoardCard): string {
    const entered = card.stage_entered_at ? new Date(card.stage_entered_at).getTime() : NaN;
    if (Number.isNaN(entered)) return 'En esta etapa';
    const minutes = Math.max(1, Math.round((Date.now() - entered) / 60_000));
    if (minutes < 60) return `${minutes} min en etapa`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} h en etapa`;
    return `${Math.round(hours / 24)} días en etapa`;
  }
}
