import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CdkDrag, CdkDragDrop, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { firstValueFrom } from 'rxjs';
import {
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  InputsearchComponent,
  ModalComponent,
  SpinnerComponent,
  StatsComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../shared/components';
import type { StickyHeaderActionButton } from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { CrmService } from '../shared/crm.service';
import {
  CrmBoard,
  CrmBoardStage,
  CrmOpportunity,
  personName,
} from '../shared/crm.interface';
import { crmCanSeeAll, formatDateOnly } from '../shared/crm.utils';
import {
  OpportunityFormModalComponent,
  OpportunityModalAction,
} from './opportunity-form-modal.component';

type PipelineView = 'board' | 'list';

const STATUS_LABELS: Record<CrmOpportunity['status'], string> = {
  open: 'Abierta',
  won: 'Ganada',
  lost: 'Perdida',
};

/**
 * Clientes → Pipeline (PLAN-CRM §7, H4): kanban by stage with drag and drop
 * (`@angular/cdk/drag-drop`), a list view and, on mobile, "Mover a" on every
 * card. Dropping on a "lost" stage asks for the reason first.
 */
@Component({
  selector: 'app-crm-pipeline',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    CdkDrag,
    CdkDropList,
    CdkDropListGroup,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    CurrencyPipe,
    EmptyStateComponent,
    IconComponent,
    InputsearchComponent,
    ModalComponent,
    SpinnerComponent,
    StatsComponent,
    StickyHeaderComponent,
    OpportunityFormModalComponent,
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

      <div class="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
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
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          @if ((board()?.pipelines?.length ?? 0) > 1) {
            <select
              class="h-10 rounded-lg border border-[var(--color-border)] bg-surface px-3 text-sm"
              aria-label="Pipeline"
              [ngModel]="pipelineId() ?? board()?.pipeline?.id"
              (ngModelChange)="pipelineId.set(+$event)"
            >
              @for (pipeline of board()!.pipelines; track pipeline.id) {
                <option [value]="pipeline.id">{{ pipeline.name }}</option>
              }
            </select>
          }
          @if (canSeeAll()) {
            <select
              class="h-10 rounded-lg border border-[var(--color-border)] bg-surface px-3 text-sm"
              aria-label="Responsable"
              [ngModel]="owner()"
              (ngModelChange)="owner.set($event)"
            >
              <option value="">Todo el equipo</option>
              <option value="me">Mías</option>
            </select>
          }
          <app-inputsearch
            placeholder="Buscar oportunidad o cliente..."
            [debounceTime]="350"
            (searchChange)="search.set($event)"
          ></app-inputsearch>
        </div>
      </div>

      @if (error() && !board()) {
        <app-card>
          <app-empty-state
            icon="alert-triangle"
            title="No pudimos cargar el pipeline"
            [description]="error()!"
            [showActionButton]="false"
            [showRefreshButton]="true"
            (refreshClick)="load()"
          ></app-empty-state>
        </app-card>
      } @else if (!board()) {
        <div class="flex justify-center py-12"><app-spinner></app-spinner></div>
      } @else if (view() === 'board') {
        @if (board()!.truncated) {
          <p class="mb-2 text-xs text-[var(--color-text-muted)]">
            Se muestran las 500 oportunidades más recientes. Usa el buscador para encontrar otras.
          </p>
        }
        <div class="flex gap-4 overflow-x-auto pb-4" cdkDropListGroup>
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
                class="flex min-h-[8rem] flex-1 flex-col gap-2 p-2"
                cdkDropList
                [id]="'stage-' + stage.id"
                [cdkDropListData]="stage"
                [cdkDropListDisabled]="!canManage()"
                (cdkDropListDropped)="onDrop($event)"
              >
                @for (card of stage.opportunities; track card.id) {
                  <article
                    class="cursor-grab rounded-xl border border-[var(--color-border)] bg-surface p-3 shadow-sm active:cursor-grabbing"
                    cdkDrag
                    [cdkDragData]="card"
                  >
                    <button
                      type="button"
                      class="w-full text-left text-sm font-semibold text-[var(--color-text-primary)] hover:underline"
                      (click)="openEdit(card)"
                    >
                      {{ card.title }}
                    </button>
                    <a
                      class="mt-0.5 block truncate text-xs text-[var(--color-text-secondary)] hover:underline"
                      [routerLink]="['/admin/customers', card.customer?.id]"
                      [queryParams]="{ tab: 'crm' }"
                    >
                      {{ name(card.customer) }}
                    </a>
                    <div class="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span class="font-semibold text-[var(--color-text-primary)]">
                        {{ card.amount !== null ? (+card.amount | currency) : 'Sin valor' }}
                      </span>
                      @if (card.expected_close_date) {
                        <span class="text-[var(--color-text-muted)]">
                          <app-icon name="calendar" [size]="11"></app-icon>
                          {{ dateOnly(card.expected_close_date) }}
                        </span>
                      }
                    </div>
                    <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
                      @if (card.owner) { <span>{{ name(card.owner) }}</span> }
                      @if (card.quotation) {
                        <span class="inline-flex items-center gap-0.5">
                          <app-icon name="file-text" [size]="11"></app-icon>{{ card.quotation.quotation_number }}
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
                  </article>
                } @empty {
                  <p class="px-1 py-4 text-center text-xs text-[var(--color-text-muted)]">Suelta aquí</p>
                }
              </div>
            </div>
          }
        </div>
      } @else {
        <app-card>
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
                  </tr>
                </thead>
                <tbody class="divide-y divide-[var(--color-border)]">
                  @for (card of allCards(); track card.id) {
                    <tr class="hover:bg-[var(--color-background)]">
                      <td class="px-3 py-2">
                        <button type="button" class="font-semibold hover:underline" (click)="openEdit(card)">{{ card.title }}</button>
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
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </app-card>
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
    </section>
  `,
})
export class PipelineComponent {
  private readonly crm = inject(CrmService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthFacade);

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
  protected readonly headerActions = computed<StickyHeaderActionButton[]>(() =>
    this.canManage()
      ? [{ id: 'new', label: 'Nueva oportunidad', icon: 'plus', variant: 'primary' }]
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
