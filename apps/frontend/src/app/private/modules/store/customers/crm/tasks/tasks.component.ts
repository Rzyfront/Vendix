import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  InputsearchComponent,
  ScrollableTabsComponent,
  SpinnerComponent,
  StatsComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../shared/components';
import type {
  ScrollableTab,
  StickyHeaderActionButton,
} from '../../../../../../shared/components';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { CrmService } from '../shared/crm.service';
import { CrmTask, CrmTaskStats, CrmTasksQuery, personName } from '../shared/crm.interface';
import { crmCanSeeAll, formatDateTime } from '../shared/crm.utils';
import { TaskFormModalComponent } from '../shared/task-form-modal.component';

type TaskTab = 'today' | 'overdue' | 'week' | 'open' | 'done';
type AssignedFilter = 'me' | 'all' | 'unassigned';

const PAGE_SIZE = 30;

/**
 * Clientes → Tareas (PLAN-CRM §7, H4). Opens on "Mis tareas de hoy": my
 * overdue tasks (in red) and the ones due today, in the store's timezone.
 */
@Component({
  selector: 'app-crm-tasks',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    IconComponent,
    InputsearchComponent,
    ScrollableTabsComponent,
    SpinnerComponent,
    StatsComponent,
    StickyHeaderComponent,
    TaskFormModalComponent,
  ],
  template: `
    <section class="w-full">
      <app-sticky-header
        title="Tareas"
        subtitle="Seguimientos con fecha para no dejar caer a ningún cliente."
        icon="check-square"
        [actions]="headerActions"
        (actionClicked)="openNew()"
      ></app-sticky-header>

      <div class="stats-container mb-4">
        <app-stats
          title="Vencidas"
          [value]="stats()?.overdue ?? 0"
          iconName="alert-triangle"
          iconBgColor="bg-error/10"
          iconColor="text-error"
          [loading]="statsLoading()"
          [clickable]="true"
          (click)="tab.set('overdue')"
        ></app-stats>
        <app-stats
          title="Para hoy"
          [value]="stats()?.today ?? 0"
          iconName="calendar"
          [loading]="statsLoading()"
          [clickable]="true"
          (click)="tab.set('today')"
        ></app-stats>
        <app-stats
          title="Pendientes"
          [value]="stats()?.open ?? 0"
          iconName="list-checks"
          [loading]="statsLoading()"
          [clickable]="true"
          (click)="tab.set('open')"
        ></app-stats>
        <app-stats
          title="Hechas (7 días)"
          [value]="stats()?.done_last_7_days ?? 0"
          iconName="check-circle"
          iconBgColor="bg-success/10"
          iconColor="text-success"
          [loading]="statsLoading()"
        ></app-stats>
      </div>

      <app-card>
        <div class="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <app-scrollable-tabs
            [tabs]="tabs"
            [activeTab]="tab()"
            size="sm"
            ariaLabel="Filtrar tareas"
            (tabChange)="tab.set($any($event))"
          ></app-scrollable-tabs>
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
            @if (canSeeAll() && tab() !== 'today') {
              <select
                class="h-10 rounded-lg border border-[var(--color-border)] bg-surface px-3 text-sm"
                aria-label="De quién"
                [ngModel]="assigned()"
                (ngModelChange)="assigned.set($event)"
              >
                <option value="me">Mías</option>
                <option value="all">Todo el equipo</option>
                <option value="unassigned">Sin responsable</option>
              </select>
            }
            @if (tab() !== 'today') {
              <app-inputsearch
                placeholder="Buscar tarea..."
                [debounceTime]="350"
                (searchChange)="search.set($event)"
              ></app-inputsearch>
            }
          </div>
        </div>

        @if (error()) {
          <app-empty-state
            icon="alert-triangle"
            title="No pudimos cargar las tareas"
            [description]="error()!"
            [showActionButton]="false"
            [showRefreshButton]="true"
            (refreshClick)="refresh()"
          ></app-empty-state>
        } @else if (loading() && !rows().length) {
          <div class="flex justify-center py-10"><app-spinner></app-spinner></div>
        } @else if (!rows().length) {
          <app-empty-state
            icon="check-square"
            [title]="tab() === 'today' ? 'Nada para hoy' : 'Sin tareas'"
            [description]="
              tab() === 'today'
                ? 'No tienes tareas vencidas ni para hoy.'
                : 'No hay tareas con este filtro.'
            "
            actionButtonText="Nueva tarea"
            (actionClick)="openNew()"
          ></app-empty-state>
        } @else {
          @if (tab() === 'today' && overdueCount()) {
            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-error)]">
              Vencidas ({{ overdueCount() }})
            </p>
          }
          <ul class="flex flex-col divide-y divide-[var(--color-border)]" role="list">
            @for (task of rows(); track task.id) {
              @if (tab() === 'today' && $index === overdueCount() && overdueCount()) {
                <li class="pt-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  Para hoy
                </li>
              }
              <li class="flex items-start gap-3 py-3">
                <input
                  type="checkbox"
                  class="mt-1 h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
                  [attr.aria-label]="(task.status === 'done' ? 'Reabrir ' : 'Completar ') + task.title"
                  [checked]="task.status === 'done'"
                  [disabled]="busyId() === task.id"
                  (change)="toggle(task)"
                />
                <div class="min-w-0 flex-1">
                  <button
                    type="button"
                    class="text-left text-sm font-semibold text-[var(--color-text-primary)] hover:underline"
                    [class.line-through]="task.status === 'done'"
                    [class.opacity-60]="task.status !== 'pending'"
                    (click)="openEdit(task)"
                  >
                    {{ task.title }}
                  </button>
                  <div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
                    @if (task.due_at) {
                      <span
                        class="inline-flex items-center gap-1"
                        [class.font-semibold]="task.is_overdue"
                        [style.color]="task.is_overdue ? 'var(--color-error)' : null"
                      >
                        <app-icon name="clock" [size]="12"></app-icon>
                        {{ task.is_overdue ? 'Venció' : 'Vence' }} {{ dateTime(task.due_at) }}
                      </span>
                    }
                    @if (task.customer) {
                      <a
                        class="inline-flex items-center gap-1 hover:underline"
                        [routerLink]="['/admin/customers', task.customer.id]"
                        [queryParams]="{ tab: 'crm' }"
                      >
                        <app-icon name="user" [size]="12"></app-icon>
                        {{ name(task.customer) }}
                      </a>
                    }
                    @if (task.opportunity) {
                      <span class="inline-flex items-center gap-1">
                        <app-icon name="trending-up" [size]="12"></app-icon>
                        {{ task.opportunity.title }}
                      </span>
                    }
                    @if (canSeeAll()) {
                      <span>· {{ name(task.assigned_user) || 'Sin responsable' }}</span>
                    }
                  </div>
                </div>
              </li>
            }
          </ul>
          @if (hasMore()) {
            <div class="mt-4 flex justify-center">
              <app-button variant="outline" size="sm" [loading]="loading()" (clicked)="loadMore()">
                Cargar más
              </app-button>
            </div>
          }
        }
      </app-card>

      <app-crm-task-form-modal
        [isOpen]="modalOpen()"
        (isOpenChange)="modalOpen.set($event)"
        [task]="editing()"
        (saved)="refresh()"
      ></app-crm-task-form-modal>
    </section>
  `,
})
export class TasksComponent {
  private readonly crm = inject(CrmService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthFacade);

  protected readonly tabs: ScrollableTab[] = [
    { id: 'today', label: 'Mis tareas de hoy', icon: 'sun' },
    { id: 'overdue', label: 'Vencidas', icon: 'alert-triangle' },
    { id: 'week', label: 'Esta semana', icon: 'calendar' },
    { id: 'open', label: 'Pendientes', icon: 'list' },
    { id: 'done', label: 'Hechas', icon: 'check' },
  ];
  protected readonly headerActions: StickyHeaderActionButton[] = [
    { id: 'new', label: 'Nueva tarea', icon: 'plus', variant: 'primary' },
  ];

  protected readonly tab = signal<TaskTab>('today');
  protected readonly assigned = signal<AssignedFilter>('me');
  protected readonly search = signal('');
  protected readonly rows = signal<CrmTask[]>([]);
  protected readonly overdueCount = signal(0);
  protected readonly page = signal(1);
  protected readonly totalPages = signal(1);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly stats = signal<CrmTaskStats | null>(null);
  protected readonly statsLoading = signal(false);
  protected readonly busyId = signal<number | null>(null);
  protected readonly modalOpen = signal(false);
  protected readonly editing = signal<CrmTask | null>(null);

  protected readonly canSeeAll = computed(() => crmCanSeeAll(this.auth));
  protected readonly hasMore = computed(
    () => this.tab() !== 'today' && this.page() < this.totalPages(),
  );
  protected readonly name = personName;
  protected readonly dateTime = formatDateTime;

  constructor() {
    effect(() => {
      this.tab();
      this.assigned();
      this.search();
      untracked(() => void this.load(true));
    });
    void this.loadStats();
  }

  openNew(): void {
    this.editing.set(null);
    this.modalOpen.set(true);
  }

  openEdit(task: CrmTask): void {
    this.editing.set(task);
    this.modalOpen.set(true);
  }

  refresh(): void {
    void this.load(true);
    void this.loadStats();
  }

  loadMore(): void {
    void this.load(false);
  }

  async toggle(task: CrmTask): Promise<void> {
    this.busyId.set(task.id);
    try {
      const updated = await firstValueFrom(
        task.status === 'done' ? this.crm.reopenTask(task.id) : this.crm.completeTask(task.id),
      );
      this.rows.update((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      this.toast.success(updated.status === 'done' ? 'Tarea completada' : 'Tarea reabierta');
      void this.loadStats();
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.busyId.set(null);
    }
  }

  private async load(reset: boolean): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      if (this.tab() === 'today') {
        const today = await firstValueFrom(this.crm.tasksToday());
        this.overdueCount.set(today.overdue.length);
        this.rows.set([...today.overdue, ...today.today]);
        this.page.set(1);
        this.totalPages.set(1);
        return;
      }
      const page = reset ? 1 : this.page() + 1;
      const result = await firstValueFrom(this.crm.tasks(this.query(page)));
      this.overdueCount.set(0);
      this.rows.update((rows) => (reset ? result.data : [...rows, ...result.data]));
      this.page.set(result.page);
      this.totalPages.set(result.totalPages);
    } catch (error) {
      this.error.set(parseApiError(error).userMessage);
    } finally {
      this.loading.set(false);
    }
  }

  private query(page: number): CrmTasksQuery {
    const tab = this.tab();
    return {
      assigned: this.canSeeAll() ? this.assigned() : 'me',
      ...(tab === 'overdue' ? { due: 'overdue' as const } : {}),
      ...(tab === 'week' ? { due: 'week' as const, status: 'pending' as const } : {}),
      ...(tab === 'open' ? { status: 'pending' as const } : {}),
      ...(tab === 'done' ? { status: 'done' as const } : {}),
      q: this.search().trim() || undefined,
      page,
      limit: PAGE_SIZE,
    };
  }

  private async loadStats(): Promise<void> {
    this.statsLoading.set(true);
    try {
      this.stats.set(await firstValueFrom(this.crm.taskStats()));
    } catch {
      // The list still works; the counters stay at zero.
    } finally {
      this.statsLoading.set(false);
    }
  }
}
