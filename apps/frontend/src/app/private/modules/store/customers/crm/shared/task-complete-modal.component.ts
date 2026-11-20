import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import {
  ButtonComponent,
  ModalComponent,
  SelectorComponent,
  type SelectorOption,
} from '../../../../../../shared/components';
import { CrmService } from './crm.service';
import { CrmOpenOpportunity, CrmTask } from './crm.interface';
import { openOpportunityLabel, taskTargetStages } from './crm.utils';

interface PendingCompletion {
  task: CrmTask;
  resolve: (task: CrmTask | null) => void;
  reject: (error: unknown) => void;
}

/**
 * Completing a task that moves nothing by itself: when its customer has an
 * open opportunity, ask (optionally) whether to move it to another stage.
 *
 * `complete(task)` drives the whole step and answers the completed task, or
 * `null` when the person closed the dialog (nothing happened). API errors
 * are thrown, so each caller keeps its own error toast.
 *
 * - The task already moves its opportunity, has no customer, or the customer
 *   has no open opportunity with somewhere to go (or the opportunities cannot
 *   be read) → it is completed right away, without asking.
 * - Otherwise the dialog shows board and current stage, the target stages
 *   (active ones of that board, not the current nor `lost`), and «Mover y
 *   cerrar» / «Solo cerrar». With several opportunities, one is chosen; the
 *   most recently updated comes first.
 */
@Component({
  selector: 'app-crm-task-complete-modal',
  standalone: true,
  imports: [FormsModule, ButtonComponent, ModalComponent, SelectorComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      [canClose]="canClose"
      title="Completar tarea"
      subtitle="¿Quieres mover la oportunidad del cliente a otra etapa? Es opcional."
      size="md"
    >
      <div class="flex flex-col gap-4">
        @if (task(); as current) {
          <p class="text-sm text-[var(--color-text-secondary)]">
            Tarea: <strong>{{ current.title }}</strong>
          </p>
        }

        @if (opportunities().length > 1) {
          <app-selector
            label="Oportunidad"
            [options]="opportunityOptions()"
            [disabled]="busy()"
            [ngModel]="opportunityId() ?? ''"
            (ngModelChange)="selectOpportunity($event ? +$event : null)"
          ></app-selector>
        } @else if (selectedOpportunity(); as only) {
          <p class="text-sm text-[var(--color-text-secondary)]">
            Oportunidad: <strong>{{ only.title }}</strong>
          </p>
        }

        @if (selectedOpportunity(); as opportunity) {
          <p class="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            @if (opportunity.stage; as stage) {
              <span
                class="inline-block h-2.5 w-2.5 rounded-full"
                [style.background]="stage.color || 'var(--color-primary)'"
              ></span>
            }
            {{ opportunity.pipeline.name }} · etapa actual:
            {{ opportunity.stage?.name || 'Sin etapa' }}
          </p>
          <app-selector
            label="Mover a la etapa"
            placeholder="Elige la etapa"
            [disabled]="busy()"
            [options]="stageOptions()"
            [ngModel]="stageId() ?? ''"
            (ngModelChange)="stageId.set($event ? +$event : null)"
          ></app-selector>
        }
      </div>

      <div slot="footer" class="flex flex-wrap justify-end gap-3">
        <app-button
          variant="outline"
          size="md"
          [disabled]="busy()"
          (clicked)="dismiss()"
        >
          Cancelar
        </app-button>
        <app-button
          variant="outline"
          size="md"
          [disabled]="busy()"
          [loading]="submitting() === 'close'"
          (clicked)="submit(false)"
        >
          Solo cerrar
        </app-button>
        <app-button
          variant="primary"
          size="md"
          [disabled]="!canMove()"
          [loading]="submitting() === 'move'"
          (clicked)="submit(true)"
        >
          Mover y cerrar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class TaskCompleteModalComponent {
  private readonly crm = inject(CrmService);

  protected readonly isOpen = signal(false);
  protected readonly task = signal<CrmTask | null>(null);
  /** Open opportunities of the customer that have a stage to go to. */
  protected readonly opportunities = signal<CrmOpenOpportunity[]>([]);
  protected readonly opportunityId = signal<number | null>(null);
  protected readonly stageId = signal<number | null>(null);
  /** Which button is completing the task, so the dialog cannot close meanwhile. */
  protected readonly submitting = signal<'move' | 'close' | null>(null);
  protected readonly busy = computed(() => this.submitting() !== null);
  private pending: PendingCompletion | null = null;

  protected readonly selectedOpportunity = computed(
    () => this.opportunities().find((item) => item.id === this.opportunityId()) ?? null,
  );
  protected readonly opportunityOptions = computed<SelectorOption[]>(() =>
    this.opportunities().map((item) => ({ value: item.id, label: openOpportunityLabel(item) })),
  );
  protected readonly stageOptions = computed<SelectorOption[]>(() =>
    taskTargetStages(this.selectedOpportunity()).map((stage) => ({
      value: stage.id,
      label: stage.name,
    })),
  );
  protected readonly canMove = computed(() => {
    const id = this.stageId();
    return (
      !this.submitting() &&
      id != null &&
      this.stageOptions().some((option) => option.value === id)
    );
  });
  protected readonly canClose = () => !this.submitting();

  /**
   * Completes `task`, asking first when there is an opportunity to move.
   * Answers the completed task, or `null` when the dialog was dismissed.
   */
  async complete(task: CrmTask): Promise<CrmTask | null> {
    this.dismiss();
    const opportunities = await this.movableOpportunities(task);
    if (!opportunities.length) return firstValueFrom(this.crm.completeTask(task.id));

    this.task.set(task);
    this.opportunities.set(opportunities);
    this.opportunityId.set(opportunities[0].id);
    this.stageId.set(null);
    this.submitting.set(null);
    this.isOpen.set(true);
    return new Promise<CrmTask | null>((resolve, reject) => {
      this.pending = { task, resolve, reject };
    });
  }

  protected selectOpportunity(id: number | null): void {
    this.opportunityId.set(id);
    this.stageId.set(null);
  }

  /** «Cancelar», the close button or Escape: nothing happens. */
  protected dismiss(): void {
    if (this.submitting()) return;
    this.finish();
    this.pending?.resolve(null);
    this.pending = null;
  }

  protected onOpenChange(open: boolean): void {
    if (!open) this.dismiss();
  }

  /** «Mover y cerrar» (`move`) or «Solo cerrar». */
  protected async submit(move: boolean): Promise<void> {
    const pending = this.pending;
    if (!pending || this.submitting()) return;
    if (move && !this.canMove()) return;
    const opportunityId = this.opportunityId();
    const stageId = this.stageId();
    this.submitting.set(move ? 'move' : 'close');
    try {
      const completed = await firstValueFrom(
        move && opportunityId && stageId
          ? this.crm.completeTask(pending.task.id, {
              opportunity_id: opportunityId,
              move_to_stage_id: stageId,
            })
          : this.crm.completeTask(pending.task.id),
      );
      pending.resolve(completed);
    } catch (error) {
      pending.reject(error);
    } finally {
      this.pending = null;
      this.submitting.set(null);
      this.finish();
    }
  }

  private finish(): void {
    this.isOpen.set(false);
    this.task.set(null);
    this.opportunities.set([]);
    this.opportunityId.set(null);
    this.stageId.set(null);
  }

  /** Nothing to ask about: the task moves by itself, has no customer or no open opportunity. */
  private async movableOpportunities(task: CrmTask): Promise<CrmOpenOpportunity[]> {
    if (task.move_to_stage || !task.customer) return [];
    try {
      const list = await firstValueFrom(this.crm.openOpportunities(task.customer.id));
      return list.filter((item) => taskTargetStages(item).length > 0);
    } catch {
      // Without access to the pipeline the task is just completed.
      return [];
    }
  }
}
