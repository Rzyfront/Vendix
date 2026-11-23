import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  CdkDropListGroup,
} from '@angular/cdk/drag-drop';
import { CdkScrollable, ScrollDispatcher } from '@angular/cdk/scrolling';
import { firstValueFrom, fromEvent } from 'rxjs';
import {
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  ConfirmationModalComponent,
  EmptyStateComponent,
  IconComponent,
  InputsearchComponent,
  ModalComponent,
  OptionsDropdownComponent,
  SpinnerComponent,
  StatsComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../shared/components';
import type {
  DropdownAction,
  FilterConfig,
  FilterValues,
  StickyHeaderActionButton,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { CrmService } from '../shared/crm.service';
import {
  CrmBoard,
  CrmBoardStage,
  CrmOpportunity,
  CrmPerson,
  personName,
} from '../shared/crm.interface';
import { crmCanSeeAll, formatDateOnly } from '../shared/crm.utils';
import {
  OpportunityFormModalComponent,
  OpportunityModalAction,
} from './opportunity-form-modal.component';
import { OpportunityDetailModalComponent } from './opportunity-detail-modal.component';
import { StageTemplatesModalComponent } from './stage-templates-modal.component';
import { TaskFormModalComponent } from '../shared/task-form-modal.component';

type PipelineView = 'board' | 'list';

/** The confirmation modal renders its message as HTML: escape user text. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STATUS_LABELS: Record<CrmOpportunity['status'], string> = {
  open: 'Abierta',
  won: 'Ganada',
  lost: 'Perdida',
};

/** Nearest ancestor that scrolls vertically (the admin layout's `<main>`). */
function verticalScrollParent(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Clientes → Pipeline (PLAN-CRM §7, H4): kanban by stage with drag and drop
 * (`@angular/cdk/drag-drop`), a list view and, on mobile, "Mover a" on every
 * card. Dropping on a "lost" stage asks for the reason first.
 *
 * A card is dragged only from its grip strip (`cdkDragHandle`), so touching
 * the rest of the card scrolls the board natively. While dragging, CDK
 * auto-scrolls every registered scroll container near the pointer: the stages
 * row (`cdkScrollable`), each column (the drop list itself) and the page.
 */
@Component({
  selector: 'app-crm-pipeline',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
    CdkDropListGroup,
    CdkScrollable,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    ConfirmationModalComponent,
    CurrencyPipe,
    EmptyStateComponent,
    IconComponent,
    InputsearchComponent,
    ModalComponent,
    OptionsDropdownComponent,
    SpinnerComponent,
    StatsComponent,
    StickyHeaderComponent,
    OpportunityFormModalComponent,
    OpportunityDetailModalComponent,
    StageTemplatesModalComponent,
    TaskFormModalComponent,
  ],
  styles: [
    `
      .board-column {
        width: 18rem;
        min-width: 18rem;
      }
      .cdk-drag-preview {
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
        border-radius: 0.75rem;
      }
      .cdk-drag-placeholder {
        opacity: 0.35;
      }
      .cdk-drag-animating,
      .cdk-drop-list-dragging .cdk-drag {
        transition: transform 200ms cubic-bezier(0, 0, 0.2, 1);
      }
    `,
  ],
  template: `
    <section class="w-full">
      <app-sticky-header
        title="Pipeline"
        [subtitle]="board()?.pipeline?.name ? 'Oportunidades de venta · ' + board()!.pipeline.name : 'Oportunidades de venta'"
        icon="trending-up"
        [actions]="headerActions()"
        (actionClicked)="openNew()"
      ></app-sticky-header>

      <div class="stats-container mb-4">
        <app-stats title="Abiertas" [value]="totals().openCount" iconName="briefcase" [loading]="loading() && !board()"></app-stats>
        <app-stats title="Valor abierto" [value]="(totals().openAmount | currency)" iconName="dollar-sign" [loading]="loading() && !board()"></app-stats>
        <app-stats
          title="Valor ponderado"
          [value]="(totals().weighted | currency)"
          smallText="Valor × probabilidad de la etapa"
          iconName="percent"
          [loading]="loading() && !board()"
        ></app-stats>
        <app-stats
          title="Ganadas"
          [value]="totals().wonCount"
          iconName="trophy"
          iconBgColor="bg-success/10"
          iconColor="text-success"
          [loading]="loading() && !board()"
        ></app-stats>
      </div>

      <app-card [showHeader]="true" customClasses="overflow-hidden">
        <div slot="header" class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div class="flex min-w-0 flex-wrap items-center gap-3">
            <h2 class="flex min-w-0 items-center gap-2 text-base font-semibold text-[var(--color-text-primary)]">
              <app-icon name="columns" [size]="18"></app-icon>
              <span class="truncate">Tablero · {{ board()?.pipeline?.name ?? 'Pipeline' }}</span>
            </h2>
            <div class="inline-flex w-fit rounded-lg border border-[var(--color-border)] p-0.5" role="group" aria-label="Vista">
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1 rounded-md px-3 text-sm font-semibold"
                [class.bg-primary]="view() === 'board'"
                [class.text-white]="view() === 'board'"
                [attr.aria-pressed]="view() === 'board'"
                (click)="view.set('board')"
              >
                <app-icon name="columns" [size]="14"></app-icon> Tablero
              </button>
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1 rounded-md px-3 text-sm font-semibold"
                [class.bg-primary]="view() === 'list'"
                [class.text-white]="view() === 'list'"
                [attr.aria-pressed]="view() === 'list'"
                (click)="view.set('list')"
              >
                <app-icon name="list" [size]="14"></app-icon> Lista
              </button>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <app-inputsearch
              class="min-w-0 flex-1 sm:w-64 sm:flex-none"
              placeholder="Buscar oportunidad o cliente..."
              [debounceTime]="350"
              (searchChange)="search.set($event)"
            ></app-inputsearch>
            <app-options-dropdown
              [filters]="filterConfigs()"
              [filterValues]="filterValues()"
              [actions]="dropdownActions()"
              [singleActionAsMenu]="true"
              [isLoading]="loading()"
              (filterChange)="onFilterChange($event)"
              (clearAllFilters)="onClearFilters()"
              (actionClick)="onActionClick($event)"
            ></app-options-dropdown>
          </div>
        </div>

        @if (error() && !board()) {
          <app-empty-state
            icon="alert-triangle"
            title="No pudimos cargar el pipeline"
            [description]="error()!"
            [showActionButton]="false"
            [showRefreshButton]="true"
            (refreshClick)="load()"
          ></app-empty-state>
        } @else if (!board()) {
          <div class="flex justify-center py-12"><app-spinner></app-spinner></div>
        } @else if (view() === 'board') {
          <!-- The card body drops its top padding under a header (pt-0): give the board the same p-6 air. -->
          <div class="pt-6">
          @if (board()!.truncated) {
            <p class="mb-2 text-xs text-[var(--color-text-muted)]">
              Se muestran las 500 oportunidades más recientes. Usa el buscador para encontrar otras.
            </p>
          }
          <div
            class="flex gap-4 overflow-x-auto pb-2"
            cdkDropListGroup
            cdkScrollable
          >
            @for (stage of stages(); track stage.id) {
              <div class="board-column flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)]">
                <div class="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="h-2.5 w-2.5 rounded-full" [style.background]="stageColor(stage)"></span>
                      <span class="truncate text-sm font-semibold text-[var(--color-text-primary)]">{{ stage.name }}</span>
                      <span class="text-xs text-[var(--color-text-muted)]">{{ stage.count }}</span>
                    </div>
                    <div class="text-xs text-[var(--color-text-muted)]">
                      {{ +stage.total_amount | currency }}
                      @if (stage.probability !== null) { · {{ stage.probability }} % }
                    </div>
                  </div>
                </div>
                <div
                  class="flex max-h-[calc(100dvh-12rem)] min-h-[8rem] flex-1 flex-col gap-2 overflow-y-auto p-2"
                  cdkDropList
                  [id]="'stage-' + stage.id"
                  [cdkDropListData]="stage"
                  [cdkDropListDisabled]="!canManage()"
                  (cdkDropListDropped)="onDrop($event)"
                >
                  @for (card of stage.opportunities; track card.id) {
                    <article
                      class="flex shrink-0 cursor-pointer overflow-hidden rounded-xl border border-[var(--color-border)] bg-surface shadow-sm"
                      cdkDrag
                      [cdkDragData]="card"
                      (cdkDragStarted)="dragging = true"
                      (cdkDragEnded)="onDragEnded()"
                      (click)="openDetail(card)"
                    >
                      @if (canManage()) {
                        <div
                          cdkDragHandle
                          class="flex w-11 shrink-0 cursor-grab touch-none select-none items-center justify-center self-stretch border-r border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] active:cursor-grabbing"
                          role="img"
                          [attr.aria-label]="'Arrastrar ' + card.title"
                          title="Arrastra para mover de etapa"
                          (click)="$event.stopPropagation()"
                        >
                          <app-icon name="grip-vertical" [size]="18"></app-icon>
                        </div>
                      }
                      <div class="min-w-0 flex-1 p-3">
                      <div class="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          class="flex min-w-0 items-start gap-1.5 text-left text-sm font-semibold text-[var(--color-text-primary)] hover:underline"
                        >
                          <app-icon name="briefcase" [size]="14" class="mt-0.5 shrink-0 text-[var(--color-text-muted)]"></app-icon>
                          <span class="min-w-0 break-words">{{ card.title }}</span>
                        </button>
                        @if (canManage() || canManageTasks()) {
                          <div class="flex shrink-0 items-center gap-0.5">
                            @if (canManageTasks()) {
                              <button
                                type="button"
                                class="inline-flex h-7 w-7 items-center justify-center rounded-md text-primary hover:bg-[var(--color-background)]"
                                aria-label="Crear tarea"
                                title="Crear tarea"
                                (click)="openTask(card); $event.stopPropagation()"
                              >
                                <app-icon name="calendar-plus" [size]="14"></app-icon>
                              </button>
                            }
                            @if (canManage()) {
                            <button
                              type="button"
                              class="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--color-background)]"
                              aria-label="Editar oportunidad"
                              title="Editar"
                              (click)="openEdit(card); $event.stopPropagation()"
                            >
                              <app-icon name="pencil" [size]="14"></app-icon>
                            </button>
                            <button
                              type="button"
                              class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-error)] hover:bg-[var(--color-background)]"
                              aria-label="Eliminar oportunidad"
                              title="Eliminar"
                              (click)="askDelete(card); $event.stopPropagation()"
                            >
                              <app-icon name="trash-2" [size]="14"></app-icon>
                            </button>
                            }
                          </div>
                        }
                      </div>
                      <a
                        class="mt-1 flex items-center gap-1.5 truncate text-xs text-[var(--color-text-secondary)] hover:underline"
                        [routerLink]="['/admin/customers', card.customer?.id]"
                        [queryParams]="{ tab: 'crm' }"
                        (click)="$event.stopPropagation()"
                      >
                        <app-icon name="user" [size]="12" class="shrink-0"></app-icon>
                        <span class="truncate">{{ name(card.customer) }}</span>
                      </a>
                      <div class="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span class="inline-flex items-center gap-1 font-semibold text-[var(--color-text-primary)]">
                          <app-icon name="dollar-sign" [size]="12"></app-icon>
                          {{ card.amount !== null ? (+card.amount | currency) : 'Sin valor' }}
                        </span>
                        @if (card.expected_close_date) {
                          <span class="inline-flex items-center gap-1 text-[var(--color-text-muted)]">
                            <app-icon name="calendar" [size]="12"></app-icon>
                            {{ dateOnly(card.expected_close_date) }}
                          </span>
                        }
                      </div>
                      <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
                        @if (card.owner) {
                          <span class="inline-flex items-center gap-1">
                            <app-icon name="user-check" [size]="12"></app-icon>{{ name(card.owner) }}
                          </span>
                        }
                        @if (card.quotation) {
                          <span class="inline-flex items-center gap-1">
                            <app-icon name="file-text" [size]="12"></app-icon>{{ card.quotation.quotation_number }}
                          </span>
                        }
                        @if (card.status === 'lost' && card.lost_reason) {
                          <span class="text-[var(--color-error)]">· {{ card.lost_reason }}</span>
                        }
                      </div>
                      @if (canManage()) {
                        <select
                          class="mt-2 h-8 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 text-xs md:hidden"
                          aria-label="Mover a"
                          [ngModel]="''"
                          (click)="$event.stopPropagation()"
                          (ngModelChange)="$event && moveTo(card, +$event)"
                        >
                          <option value="">Mover a…</option>
                          @for (target of stages(); track target.id) {
                            @if (target.id !== card.stage_id && target.is_active !== false) {
                              <option [value]="target.id">{{ target.name }}</option>
                            }
                          }
                        </select>
                      }
                      </div>
                    </article>
                  } @empty {
                    <p class="px-1 py-4 text-center text-xs text-[var(--color-text-muted)]">Suelta aquí</p>
                  }
                </div>
              </div>
            }
          </div>
          </div>
        } @else {
          @if (!allCards().length) {
            <app-empty-state
              icon="trending-up"
              title="Sin oportunidades"
              description="Crea la primera oportunidad para empezar a seguir tus ventas."
              actionButtonText="Nueva oportunidad"
              [showActionButton]="canManage()"
              (actionClick)="openNew()"
            ></app-empty-state>
          } @else {
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="text-xs uppercase text-[var(--color-text-muted)]">
                  <tr>
                    <th class="px-3 py-2">Oportunidad</th>
                    <th class="px-3 py-2">Cliente</th>
                    <th class="px-3 py-2">Etapa</th>
                    <th class="px-3 py-2 text-right">Valor</th>
                    <th class="px-3 py-2 text-right">Prob.</th>
                    <th class="px-3 py-2">Cierre esperado</th>
                    <th class="px-3 py-2">Responsable</th>
                    <th class="px-3 py-2">Estado</th>
                    @if (canManage()) {
                      <th class="px-3 py-2 text-right"><span class="sr-only">Acciones</span></th>
                    }
                  </tr>
                </thead>
                <tbody class="divide-y divide-[var(--color-border)]">
                  @for (card of allCards(); track card.id) {
                    <tr class="hover:bg-[var(--color-background)]">
                      <td class="px-3 py-2">
                        <button type="button" class="inline-flex items-center gap-1.5 text-left font-semibold hover:underline" (click)="openDetail(card)">
                          <app-icon name="briefcase" [size]="14" class="shrink-0 text-[var(--color-text-muted)]"></app-icon>{{ card.title }}
                        </button>
                      </td>
                      <td class="px-3 py-2">
                        <a class="hover:underline" [routerLink]="['/admin/customers', card.customer?.id]" [queryParams]="{ tab: 'crm' }">{{ name(card.customer) }}</a>
                      </td>
                      <td class="px-3 py-2">{{ card.stage?.name }}</td>
                      <td class="px-3 py-2 text-right">{{ card.amount !== null ? (+card.amount | currency) : '—' }}</td>
                      <td class="px-3 py-2 text-right">{{ card.probability !== null ? card.probability + ' %' : '—' }}</td>
                      <td class="px-3 py-2">{{ dateOnly(card.expected_close_date) || '—' }}</td>
                      <td class="px-3 py-2">{{ name(card.owner) || 'Sin responsable' }}</td>
                      <td class="px-3 py-2">
                        <app-badge [variant]="card.status === 'won' ? 'success' : card.status === 'lost' ? 'error' : 'info'" size="xs">
                          {{ statusLabel(card) }}
                        </app-badge>
                        @if (card.status === 'lost' && card.lost_reason) {
                          <div class="text-xs text-[var(--color-text-muted)]">{{ card.lost_reason }}</div>
                        }
                      </td>
                      @if (canManage()) {
                        <td class="px-3 py-2">
                          <div class="flex items-center justify-end gap-0.5">
                            <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--color-background)]" aria-label="Editar oportunidad" title="Editar" (click)="openEdit(card)">
                              <app-icon name="pencil" [size]="14"></app-icon>
                            </button>
                            <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-error)] hover:bg-[var(--color-background)]" aria-label="Eliminar oportunidad" title="Eliminar" (click)="askDelete(card)">
                              <app-icon name="trash-2" [size]="14"></app-icon>
                            </button>
                          </div>
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
      </app-card>

      <app-crm-opportunity-detail-modal
        [(isOpen)]="detailOpen"
        [opportunity]="detailCard()"
        [canManage]="canManage()"
        (editRequested)="editFromDetail()"
        (deleteRequested)="deleteFromDetail()"
        (tasksChanged)="load()"
      ></app-crm-opportunity-detail-modal>

      <app-confirmation-modal
        [isOpen]="!!toDelete()"
        (isOpenChange)="!$event && toDelete.set(null)"
        title="Eliminar oportunidad"
        [message]="deleteMessage()"
        confirmText="Eliminar"
        cancelText="Cancelar"
        confirmVariant="danger"
        (confirm)="confirmDelete()"
        (cancel)="toDelete.set(null)"
      ></app-confirmation-modal>

      @if (canConfigure()) {
        <app-crm-stage-templates-modal
          [(isOpen)]="templatesOpen"
          [pipelineId]="board()?.pipeline?.id ?? null"
          [pipelineName]="board()?.pipeline?.name ?? ''"
          (applied)="load()"
          (pipelineCreated)="onPipelineCreated($event)"
        ></app-crm-stage-templates-modal>
      }

      <app-crm-opportunity-form-modal
        [isOpen]="formOpen()"
        (isOpenChange)="formOpen.set($event)"
        [opportunity]="editing()"
        [stages]="stages()"
        (saved)="load()"
        (action)="onModalAction($event)"
      ></app-crm-opportunity-form-modal>

      <app-modal
        [isOpen]="loseOpen()"
        (isOpenChange)="onLoseOpenChange($event)"
        title="¿Por qué se perdió?"
        subtitle="El motivo queda en la oportunidad y ayuda a entender las pérdidas."
        size="sm"
      >
        <div class="flex flex-col gap-2">
          <input
            class="h-10 rounded-lg border border-[var(--color-border)] bg-surface px-3 text-sm"
            placeholder="Ej.: Precio, eligió a la competencia, sin presupuesto"
            maxlength="160"
            aria-label="Motivo de pérdida"
            [ngModel]="lostReason()"
            (ngModelChange)="lostReason.set($event)"
            (keydown.enter)="confirmLose()"
          />
          <div class="flex flex-wrap gap-1">
            @for (reason of quickReasons; track reason) {
              <button
                type="button"
                class="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-xs hover:bg-[var(--color-background)]"
                (click)="lostReason.set(reason)"
              >
                {{ reason }}
              </button>
            }
          </div>
        </div>
        <div slot="footer" class="flex justify-end gap-3">
          <app-button variant="outline" size="md" (clicked)="onLoseOpenChange(false)">Cancelar</app-button>
          <app-button variant="danger" size="md" [disabled]="!lostReason().trim()" [loading]="moving()" (clicked)="confirmLose()">
            Marcar perdida
          </app-button>
        </div>
      </app-modal>

      @if (canManageTasks()) {
        <app-crm-task-form-modal
          [isOpen]="taskFormOpen()"
          (isOpenChange)="taskFormOpen.set($event)"
          [fixedCustomer]="taskCustomer()"
          [presetOpportunityId]="taskOpportunityId()"
          (saved)="load()"
        ></app-crm-task-form-modal>
      }
    </section>
  `,
})
export class PipelineComponent {
  private readonly crm = inject(CrmService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthFacade);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scrollDispatcher = inject(ScrollDispatcher);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly board = signal<CrmBoard | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly moving = signal(false);
  protected readonly view = signal<PipelineView>('board');
  protected readonly pipelineId = signal<number | null>(null);
  protected readonly owner = signal<string>('');
  protected readonly search = signal('');
  protected readonly formOpen = signal(false);
  protected readonly editing = signal<CrmOpportunity | null>(null);
  protected readonly loseOpen = signal(false);
  protected readonly lostReason = signal('');
  protected readonly detailOpen = signal(false);
  private readonly detailId = signal<number | null>(null);
  protected readonly toDelete = signal<CrmOpportunity | null>(null);
  protected readonly templatesOpen = signal(false);
  protected readonly taskFormOpen = signal(false);
  protected readonly taskCustomer = signal<CrmPerson | null>(null);
  protected readonly taskOpportunityId = signal<number | null>(null);
  /** True while a card is being dragged, so the trailing click opens nothing. */
  protected dragging = false;
  /** Pending lose: the card and, when dropped, the target stage and index. */
  private readonly pendingLose = signal<{
    card: CrmOpportunity;
    stageId: number | null;
    index?: number;
  } | null>(null);

  protected readonly quickReasons = ['Precio', 'Eligió a la competencia', 'Sin presupuesto', 'No respondió'];
  protected readonly name = personName;
  protected readonly dateOnly = formatDateOnly;
  protected readonly canSeeAll = computed(() => crmCanSeeAll(this.auth));
  protected readonly canManage = computed(
    () => this.auth.isOwner() || this.auth.hasPermission('store:crm_pipeline:manage'),
  );
  protected readonly canManageTasks = computed(
    () => this.auth.isOwner() || this.auth.hasPermission('store:crm_tasks:manage'),
  );
  /** Only owner/admin (see-all) with manage permission configure stage templates. */
  protected readonly canConfigure = computed(() => this.canSeeAll() && this.canManage());
  protected readonly detailCard = computed(
    () => this.allCards().find((card) => card.id === this.detailId()) ?? null,
  );
  protected readonly deleteMessage = computed(
    () =>
      `¿Eliminar la oportunidad «${escapeHtml(this.toDelete()?.title ?? '')}»?<br>Esta acción no se puede deshacer. Las tareas vinculadas se conservan.`,
  );
  protected readonly headerActions = computed<StickyHeaderActionButton[]>(() =>
    this.canManage()
      ? [{ id: 'new', label: 'Nueva oportunidad', icon: 'plus', variant: 'primary' }]
      : [],
  );
  /** Pipeline (only with 2+ pipelines) and owner (only see-all) filters for the dropdown. */
  protected readonly filterConfigs = computed<FilterConfig[]>(() => {
    const filters: FilterConfig[] = [];
    const pipelines = this.board()?.pipelines ?? [];
    if (pipelines.length > 1) {
      filters.push({
        key: 'pipeline_id',
        label: 'Pipeline',
        type: 'select',
        placeholder: this.board()?.pipeline?.name ?? 'Pipeline',
        options: pipelines.map((pipeline) => ({ value: String(pipeline.id), label: pipeline.name })),
      });
    }
    if (this.canSeeAll()) {
      filters.push({
        key: 'owner',
        label: 'Responsable',
        type: 'select',
        placeholder: 'Todo el equipo',
        options: [
          { value: '', label: 'Todo el equipo' },
          { value: 'me', label: 'Mías' },
        ],
      });
    }
    return filters;
  });
  /** Only explicit choices count as active filters: the default pipeline and "Todo el equipo" stay null. */
  protected readonly filterValues = computed<FilterValues>(() => ({
    pipeline_id: this.pipelineId() !== null ? String(this.pipelineId()) : null,
    owner: this.owner() || null,
  }));
  protected readonly dropdownActions = computed<DropdownAction[]>(() =>
    this.canConfigure()
      ? [{ label: 'Plantillas de etapas', icon: 'layers', action: 'templates' }]
      : [],
  );
  protected readonly stages = computed<CrmBoardStage[]>(() => this.board()?.stages ?? []);
  protected readonly allCards = computed(() =>
    this.stages().flatMap((stage) => stage.opportunities),
  );
  protected readonly totals = computed(() => {
    let openCount = 0;
    let openAmount = 0;
    let weighted = 0;
    let wonCount = 0;
    for (const card of this.allCards()) {
      const amount = Number(card.amount ?? 0);
      if (card.status === 'open') {
        openCount++;
        openAmount += amount;
        weighted += (amount * (card.probability ?? 0)) / 100;
      } else if (card.status === 'won') {
        wonCount++;
      }
    }
    return { openCount, openAmount, weighted, wonCount };
  });

  constructor() {
    effect(() => {
      this.pipelineId();
      this.owner();
      this.search();
      untracked(() => void this.load());
    });
    afterNextRender(() => {
      this.registerPageScroller();
      this.shieldHandlesFromPullToRefresh();
    });
  }

  /**
   * The admin layout scrolls a `<main>`, not the window, and CDK only
   * auto-scrolls (and keeps drop positions right for) containers registered in
   * the ScrollDispatcher. Register it while the board lives, without touching
   * the shared layout.
   */
  private registerPageScroller(): void {
    const element = verticalScrollParent(this.host.nativeElement);
    if (!element) return;
    const elementRef = new ElementRef(element);
    const scrolled = fromEvent(element, 'scroll');
    const scrollable = {
      getElementRef: () => elementRef,
      elementScrolled: () => scrolled,
    } as unknown as CdkScrollable;
    this.scrollDispatcher.register(scrollable);
    this.destroyRef.onDestroy(() => this.scrollDispatcher.deregister(scrollable));
  }

  /**
   * A touch that starts on a drag handle belongs to the drag: keep it from the
   * layout's pull-to-refresh, which would otherwise reload the page when a card
   * is dragged down near the top. Passive, so it never delays native scroll.
   */
  private shieldHandlesFromPullToRefresh(): void {
    const host = this.host.nativeElement;
    const listener = (event: Event) => {
      if ((event.target as Element | null)?.closest?.('.cdk-drag-handle')) event.stopPropagation();
    };
    host.addEventListener('touchstart', listener, { passive: true });
    this.destroyRef.onDestroy(() => host.removeEventListener('touchstart', listener));
  }

  openTask(card: CrmOpportunity): void {
    this.taskCustomer.set(card.customer);
    this.taskOpportunityId.set(card.id);
    this.taskFormOpen.set(true);
  }

  onFilterChange(values: FilterValues): void {
    const pipelineId = values['pipeline_id'];
    this.pipelineId.set(typeof pipelineId === 'string' && pipelineId ? +pipelineId : null);
    const owner = values['owner'];
    this.owner.set(typeof owner === 'string' ? owner : '');
  }

  onClearFilters(): void {
    this.pipelineId.set(null);
    this.owner.set('');
  }

  onActionClick(action: string): void {
    if (action === 'templates' && this.canConfigure()) this.templatesOpen.set(true);
  }

  statusLabel(card: CrmOpportunity): string {
    return STATUS_LABELS[card.status];
  }

  stageColor(stage: CrmBoardStage): string {
    if (stage.color) return stage.color;
    if (stage.kind === 'won') return 'var(--color-success)';
    if (stage.kind === 'lost') return 'var(--color-error)';
    return 'var(--color-primary)';
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.board.set(
        await firstValueFrom(
          this.crm.board({
            pipeline_id: this.pipelineId() ?? undefined,
            owner: this.owner() || undefined,
            q: this.search().trim() || undefined,
          }),
        ),
      );
    } catch (error) {
      this.error.set(parseApiError(error).userMessage);
      if (this.board()) this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.loading.set(false);
    }
  }

  openNew(): void {
    this.editing.set(null);
    this.formOpen.set(true);
  }

  openEdit(card: CrmOpportunity): void {
    this.editing.set(card);
    this.formOpen.set(true);
  }

  openDetail(card: CrmOpportunity): void {
    if (this.dragging) return;
    this.detailId.set(card.id);
    this.detailOpen.set(true);
  }

  onDragEnded(): void {
    setTimeout(() => (this.dragging = false));
  }

  editFromDetail(): void {
    const card = this.detailCard();
    if (!card) return;
    this.detailOpen.set(false);
    this.openEdit(card);
  }

  deleteFromDetail(): void {
    const card = this.detailCard();
    if (card) this.askDelete(card);
  }

  askDelete(card: CrmOpportunity): void {
    this.toDelete.set(card);
  }

  async confirmDelete(): Promise<void> {
    const card = this.toDelete();
    this.toDelete.set(null);
    if (!card) return;
    try {
      await firstValueFrom(this.crm.deleteOpportunity(card.id));
      this.detailOpen.set(false);
      this.board.update((board) => {
        if (!board) return board;
        const amount = Number(card.amount ?? 0);
        const stages = board.stages.map((stage) => {
          if (!stage.opportunities.some((row) => row.id === card.id)) return stage;
          return {
            ...stage,
            count: Math.max(0, stage.count - 1),
            total_amount: String(Math.max(0, Number(stage.total_amount) - amount)),
            opportunities: stage.opportunities.filter((row) => row.id !== card.id),
          };
        });
        return { ...board, stages };
      });
      this.toast.success('Oportunidad eliminada');
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    }
  }

  onPipelineCreated(id: number): void {
    this.pipelineId.set(id);
  }

  onDrop(event: CdkDragDrop<CrmBoardStage>): void {
    const card = event.item.data as CrmOpportunity;
    const target = event.container.data;
    if (event.previousContainer === event.container && event.previousIndex === event.currentIndex) {
      return;
    }
    if (target.kind === 'lost' && card.status !== 'lost') {
      this.askLose(card, target.id, event.currentIndex);
      return;
    }
    void this.move(card, target.id, event.currentIndex);
  }

  moveTo(card: CrmOpportunity, stageId: number): void {
    const target = this.stages().find((stage) => stage.id === stageId);
    if (target?.kind === 'lost' && card.status !== 'lost') {
      this.askLose(card, stageId);
      return;
    }
    void this.move(card, stageId);
  }

  onModalAction(action: OpportunityModalAction): void {
    const card = this.editing();
    if (!card) return;
    if (action === 'won') {
      this.formOpen.set(false);
      void this.run(() => this.crm.winOpportunity(card.id), 'Oportunidad ganada');
    } else if (action === 'lose') {
      this.formOpen.set(false);
      this.askLose(card, null);
    }
  }

  onLoseOpenChange(open: boolean): void {
    this.loseOpen.set(open);
    if (!open) this.pendingLose.set(null);
  }

  async confirmLose(): Promise<void> {
    const pending = this.pendingLose();
    const reason = this.lostReason().trim();
    if (!pending || !reason || this.moving()) return;
    const ok =
      pending.stageId === null
        ? await this.run(() => this.crm.loseOpportunity(pending.card.id, reason), 'Oportunidad perdida')
        : await this.move(pending.card, pending.stageId, pending.index, reason);
    if (ok) this.onLoseOpenChange(false);
  }

  private askLose(card: CrmOpportunity, stageId: number | null, index?: number): void {
    this.pendingLose.set({ card, stageId, index });
    this.lostReason.set('');
    this.loseOpen.set(true);
  }

  /** Optimistic move; the board is re-read afterwards either way. */
  private async move(
    card: CrmOpportunity,
    stageId: number,
    index?: number,
    lostReason?: string,
  ): Promise<boolean> {
    this.board.update((board) => {
      if (!board) return board;
      const stages = board.stages.map((stage) => ({
        ...stage,
        opportunities: stage.opportunities.filter((row) => row.id !== card.id),
      }));
      const target = stages.find((stage) => stage.id === stageId);
      if (target) {
        const list = [...target.opportunities];
        list.splice(index ?? list.length, 0, { ...card, stage_id: stageId });
        target.opportunities = list;
      }
      return { ...board, stages };
    });
    return this.run(
      () =>
        this.crm.moveOpportunity(card.id, {
          stage_id: stageId,
          ...(index !== undefined ? { sort_order: index } : {}),
          ...(lostReason ? { lost_reason: lostReason } : {}),
        }),
      null,
    );
  }

  private async run(
    request: () => ReturnType<CrmService['moveOpportunity']>,
    success: string | null,
  ): Promise<boolean> {
    this.moving.set(true);
    try {
      await firstValueFrom(request());
      if (success) this.toast.success(success);
      return true;
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
      return false;
    } finally {
      this.moving.set(false);
      void this.load();
    }
  }
}
