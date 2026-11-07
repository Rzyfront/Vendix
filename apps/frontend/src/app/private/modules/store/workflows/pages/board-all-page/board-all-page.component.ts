import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  SelectorComponent,
  StickyHeaderComponent,
  ToastService,
  ToggleComponent,
} from '../../../../../../shared/components/index';
import {
  BoardAllCard,
  BoardAllColumn,
  BoardFilterOption,
} from '../../interfaces/workflow-board.interfaces';
import { WorkflowBoardApiService } from '../../services/workflow-board-api.service';
import { WorkflowLiveService } from '../../services/workflow-live.service';
import { toWorkflowError } from '../../utils/workflow-errors.util';
import { dueText } from '../../utils/workflow-labels.util';
import { ALL_OPTION, appendColumnPage, buildBoardQuery } from './board-all.utils';

const toOptions = (all: string, rows: BoardFilterOption[]) => [
  { value: ALL_OPTION, label: all },
  ...rows.map((r) => ({ value: String(r.id), label: r.name })),
];

/**
 * "Tablero general": requests of every flow in four columns ("Por atender",
 * "En curso", "En espera (sistema)", "Cerradas"), filtered by flow, role and
 * branch. Read only; a card opens the request. Columns scroll sideways on a
 * phone and refresh by themselves when the live stream reports a change.
 */
@Component({
  selector: 'app-workflow-board-all-page',
  standalone: true,
  imports: [
    StickyHeaderComponent,
    CardComponent,
    SelectorComponent,
    ToggleComponent,
    ButtonComponent,
    IconComponent,
    EmptyStateComponent,
    AlertBannerComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Tablero general"
        subtitle="Las solicitudes de todos los flujos, por rol y sede"
        icon="layout-dashboard"
        variant="glass"
        [showBackButton]="true"
        backRoute="/admin/workflows"
      />

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <div class="px-2 py-2 md:px-6 md:py-4">
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <app-selector
              label="Flujo"
              [options]="definitionOptions()"
              [value]="definition()"
              (valueChange)="onDefinition($event)"
            />
            <app-selector
              label="Rol"
              [options]="roleOptions()"
              [value]="role()"
              (valueChange)="onRole($event)"
            />
            <app-selector
              label="Sede"
              [options]="locationOptions()"
              [value]="location()"
              (valueChange)="onLocation($event)"
            />
            <app-toggle label="Solo vencidas" [checked]="overdue()" (toggled)="onOverdue($event)" />
          </div>
        </div>
      </app-card>

      <div class="mt-3">
        @if (loading()) {
          <div class="p-4 text-center">
            <div class="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
            <p class="mt-2 text-text-secondary">Cargando...</p>
          </div>
        } @else if (loadError()) {
          <app-alert-banner variant="danger" icon="alert-triangle">{{ loadError() }}</app-alert-banner>
        } @else if (total() === 0) {
          <app-empty-state
            icon="layout-dashboard"
            title="No hay solicitudes con estos filtros"
            description="Cambia el flujo, el rol o la sede para ver otras."
            [showActionButton]="false"
          />
        } @else {
          <div
            class="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 md:snap-none"
            data-testid="board-columns"
          >
            @for (column of columns(); track column.key) {
              <section
                class="flex w-[82vw] max-w-sm shrink-0 snap-start flex-col rounded-xl border border-border bg-surface md:w-72 md:flex-1 md:max-w-none"
                [attr.data-testid]="'column-' + column.key"
              >
                <header class="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <h2 class="text-sm font-semibold text-text-primary">{{ column.name }}</h2>
                  <span class="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-text-secondary">{{
                    column.count
                  }}</span>
                </header>
                <div class="flex flex-col gap-2 p-2">
                  @for (card of column.cards; track card.id) {
                    <button
                      type="button"
                      class="w-full rounded-lg border border-border bg-background p-3 text-left shadow-sm transition hover:border-primary"
                      [attr.data-testid]="'card-' + card.id"
                      (click)="open(card)"
                    >
                      <p class="break-words text-sm font-semibold text-text-primary">{{ card.title }}</p>
                      <p class="text-xs text-text-secondary">
                        {{ card.reference }} · {{ card.definition.name ?? 'Flujo' }}
                      </p>
                      <p class="mt-1 flex items-center gap-1 text-xs text-text-secondary">
                        <app-icon name="layers" [size]="12" /> {{ card.stage_name ?? card.stage_key }}
                      </p>
                      <p class="flex items-center gap-1 text-xs text-text-secondary">
                        <app-icon name="user" [size]="12" /> {{ card.assignee?.name ?? 'Sin responsable' }}
                      </p>
                      @if (card.status === 'active' && card.stage_due_at) {
                        <p
                          class="flex items-center gap-1 text-xs"
                          [class]="card.overdue ? 'font-medium text-error' : 'text-text-secondary'"
                        >
                          <app-icon name="clock" [size]="12" /> {{ due(card) }}
                        </p>
                      }
                      @if (card.location; as place) {
                        <p class="flex items-center gap-1 text-xs text-text-secondary">
                          <app-icon name="map-pin" [size]="12" /> {{ place.name }}
                        </p>
                      }
                    </button>
                  } @empty {
                    <p class="px-2 py-4 text-center text-xs text-text-secondary">Sin solicitudes</p>
                  }
                  @if (column.next_cursor) {
                    <app-button
                      variant="ghost"
                      size="sm"
                      [fullWidth]="true"
                      [loading]="loadingMore() === column.key"
                      (clicked)="loadMore(column)"
                      >Cargar más</app-button
                    >
                  }
                </div>
              </section>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class BoardAllPageComponent implements OnInit {
  private readonly api = inject(WorkflowBoardApiService);
  private readonly live = inject(WorkflowLiveService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** Only the latest read may fill the board (filters can change mid-flight). */
  private requestSeq = 0;

  readonly columns = signal<BoardAllColumn[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly loadingMore = signal<string | null>(null);
  readonly total = computed(() => this.columns().reduce((n, c) => n + c.count, 0));

  readonly definition = signal(ALL_OPTION);
  readonly role = signal(ALL_OPTION);
  readonly location = signal(ALL_OPTION);
  readonly overdue = signal(false);
  readonly definitionOptions = signal(toOptions('Todos los flujos', []));
  readonly roleOptions = signal(toOptions('Todos los roles', []));
  readonly locationOptions = signal(toOptions('Todas las sedes', []));

  ngOnInit(): void {
    this.api
      .getFilters()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (f) => {
          this.definitionOptions.set(toOptions('Todos los flujos', f.definitions));
          this.roleOptions.set(toOptions('Todos los roles', f.roles));
          this.locationOptions.set(toOptions('Todas las sedes', f.locations));
        },
        // Only the filter options: the board below reports its own load error.
        error: () => undefined,
      });
    this.load();
    // P5.6: the board follows the stream without reloading the page.
    this.live
      .changes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.load(true));
  }

  onDefinition(value: unknown): void {
    this.definition.set(String(value ?? ALL_OPTION));
    this.load();
  }

  onRole(value: unknown): void {
    this.role.set(String(value ?? ALL_OPTION));
    this.load();
  }

  onLocation(value: unknown): void {
    this.location.set(String(value ?? ALL_OPTION));
    this.load();
  }

  onOverdue(value: boolean): void {
    this.overdue.set(value === true);
    this.load();
  }

  due(card: BoardAllCard): string {
    return dueText(card.stage_due_at);
  }

  open(card: BoardAllCard): void {
    this.router.navigate(['/admin/workflows/instances', card.id]);
  }

  loadMore(column: BoardAllColumn): void {
    if (!column.next_cursor || this.loadingMore()) return;
    this.loadingMore.set(column.key);
    this.api
      .getBoard({ ...this.query(), column: column.key, cursor: column.next_cursor })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          const page = data.columns.find((c) => c.key === column.key);
          if (page) {
            this.columns.update((list) =>
              list.map((c) => (c.key === column.key ? appendColumnPage(c, page) : c)),
            );
          }
          this.loadingMore.set(null);
        },
        error: (error) => {
          this.loadingMore.set(null);
          this.toast.error(toWorkflowError(error).message);
        },
      });
  }

  private query() {
    return buildBoardQuery({
      definition: this.definition(),
      role: this.role(),
      location: this.location(),
      overdue: this.overdue(),
    });
  }

  /** `background`: a live refresh keeps the board on screen instead of the spinner. */
  private load(background = false): void {
    if (!background) this.loading.set(true);
    this.loadError.set('');
    const request = ++this.requestSeq;
    this.api
      .getBoard(this.query())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          if (request !== this.requestSeq) return;
          this.columns.set(data.columns);
          this.loading.set(false);
        },
        error: (error) => {
          if (request !== this.requestSeq) return;
          this.loading.set(false);
          const message = toWorkflowError(error).message;
          if (background) this.toast.error(message);
          else this.loadError.set(message);
        },
      });
  }
}
