import {
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable, firstValueFrom, map } from 'rxjs';
import {
  ButtonComponent,
  CustomerSelectComponent,
  type CustomerSelectOption,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  type SelectorOption,
  StoreUserMultiSelectComponent,
  StoreUserSelectComponent,
  TextareaComponent,
  ToastService,
  ToggleComponent,
} from '../../../../../../shared/components';
import type { StoreUserOption } from '../../../../../../shared/services/store-user-lookup.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { CrmService } from './crm.service';
import { CrmOpenOpportunity, CrmPerson, CrmTask, SaveCrmTask, personName } from './crm.interface';
import {
  CRM_TASK_MAX_SUPPORTERS,
  crmCanSeeAll,
  fromLocalInput,
  isTaskSupporter,
  openOpportunityLabel,
  taskTargetStages,
  toLocalInput,
} from './crm.utils';

/**
 * Create or edit a CRM task. A seller can only assign to themselves (the API
 * answers CRM_ASSIGN_001 otherwise), so the assignee picker is hidden for them;
 * anyone can add support people.
 *
 * With a customer, a new task detects its open opportunities: one is
 * preselected, several are offered, none is said. A linked opportunity can be
 * moved to another stage when the task is completed. The opportunity of a
 * saved task cannot be changed (the API has no such field), only its stage.
 *
 * Who only helps with a saved task (not its assignee nor its creator, without
 * see-all) sees it read-only: the API only lets them change its status
 * (CRM_TASK_003), and that is done from the list.
 */
@Component({
  selector: 'app-crm-task-form-modal',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    CustomerSelectComponent,
    InputComponent,
    ModalComponent,
    SelectorComponent,
    StoreUserMultiSelectComponent,
    StoreUserSelectComponent,
    TextareaComponent,
    ToggleComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      [title]="task() ? 'Editar tarea' : 'Nueva tarea'"
      subtitle="Recibirás un aviso cuando venza."
      size="md"
    >
      <div class="flex flex-col gap-4">
        @if (supportOnly()) {
          <p class="text-sm text-[var(--color-text-secondary)]">
            Eres apoyo en esta tarea: puedes verla y marcarla hecha desde la lista. El resto lo
            cambia el responsable o quien la creó.
          </p>
        }

        <app-input
          label="Qué hay que hacer"
          placeholder="Ej.: Llamar para confirmar la cotización"
          [maxlength]="200"
          [disabled]="supportOnly()"
          [ngModel]="title()"
          (ngModelChange)="title.set($event)"
        ></app-input>

        <app-input
          label="Vence"
          type="datetime-local"
          [disabled]="supportOnly()"
          [ngModel]="dueAt()"
          (ngModelChange)="dueAt.set($event)"
        ></app-input>

        @if (!fixedCustomer()) {
          <app-customer-select
            label="Cliente (opcional)"
            [allowCreate]="false"
            [disabled]="supportOnly()"
            [selected]="customer()"
            (selectedChange)="customer.set($event)"
          ></app-customer-select>
        } @else {
          <p class="text-sm text-[var(--color-text-secondary)]">
            Cliente: <strong>{{ fixedCustomerName() }}</strong>
          </p>
        }

        @if (task(); as editing) {
          @if (editing.opportunity) {
            <p class="text-sm text-[var(--color-text-secondary)]">
              Oportunidad: <strong>{{ editing.opportunity.title }}</strong>
            </p>
          }
        } @else if (opportunitiesLoaded()) {
          @if (opportunities().length === 0) {
            <p class="text-sm text-[var(--color-text-secondary)]">
              Este cliente no tiene oportunidades abiertas
            </p>
          } @else {
            <app-selector
              label="Oportunidad"
              placeholder="Sin oportunidad"
              [options]="opportunityOptions()"
              [ngModel]="opportunityId() ?? ''"
              (ngModelChange)="selectOpportunity($event ? +$event : null)"
            ></app-selector>
          }
        }

        @if (selectedOpportunity(); as opportunity) {
          @if (opportunity.stage; as stage) {
            <p class="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              <span
                class="inline-block h-2.5 w-2.5 rounded-full"
                [style.background]="stage.color || 'var(--color-primary)'"
              ></span>
              {{ opportunity.pipeline.name }} · etapa actual: {{ stage.name }}
            </p>
          }
          <app-toggle
            label="Esta tarea mueve la oportunidad"
            [disabled]="supportOnly()"
            [checked]="movesOpportunity()"
            (changed)="setMovesOpportunity($event)"
          ></app-toggle>
          @if (movesOpportunity()) {
            <app-selector
              label="Mover a la etapa"
              placeholder="Elige la etapa"
              helpText="Se mueve cuando la tarea se marque como hecha."
              [required]="true"
              [disabled]="supportOnly()"
              [errorText]="targetStageValid() ? '' : 'Elige la etapa destino'"
              [options]="stageOptions()"
              [ngModel]="targetStageId() ?? ''"
              (ngModelChange)="targetStageId.set($event ? +$event : null)"
            ></app-selector>
          }
        }

        @if (canSeeAll()) {
          <div class="flex flex-col gap-1">
            <span class="text-sm font-medium text-[var(--color-text-primary)]">Responsable</span>
            <app-store-user-select
              placeholder="Buscar persona del equipo..."
              lookupMode="staff"
              [value]="assignee()"
              [valueLabel]="assigneeLabel()"
              (valueChange)="assignee.set($event)"
            ></app-store-user-select>
          </div>
        }

        <div class="flex flex-col gap-1">
          <span class="text-sm font-medium text-[var(--color-text-primary)]">
            Personas de apoyo (opcional)
          </span>
          <app-store-user-multi-select
            placeholder="Buscar persona del equipo..."
            lookupMode="staff"
            [searchFn]="searchStaff"
            [disabled]="supportOnly()"
            [excludeIds]="supportExcludedIds()"
            [knownUsers]="knownSupporters()"
            [ngModel]="supporters()"
            (ngModelChange)="supporters.set($event)"
          ></app-store-user-multi-select>
          <span [class]="supportHintClass()">
            Ven la tarea y pueden marcarla hecha. Máximo {{ maxSupporters }}.
          </span>
        </div>

        <app-textarea
          label="Detalle (opcional)"
          [readonly]="supportOnly()"
          [ngModel]="description()"
          (ngModelChange)="description.set($event)"
        ></app-textarea>
      </div>

      <div slot="footer" class="flex flex-wrap justify-end gap-3">
        <app-button variant="outline" size="md" (clicked)="isOpen.set(false)">Cancelar</app-button>
        <app-button
          variant="primary"
          size="md"
          [disabled]="!canSave()"
          [loading]="saving()"
          (clicked)="save()"
        >
          Guardar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class TaskFormModalComponent {
  private readonly crm = inject(CrmService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthFacade);

  readonly isOpen = model(false);
  /** Task to edit; null creates a new one. */
  readonly task = input<CrmTask | null>(null);
  /** Customer the task belongs to when opened from the customer profile. */
  readonly fixedCustomer = input<CrmPerson | null>(null);
  readonly saved = output<CrmTask>();

  protected readonly title = signal('');
  protected readonly dueAt = signal('');
  protected readonly description = signal('');
  protected readonly assignee = signal<number | null>(null);
  /** Name of the preset assignee, so the picker never shows `Usuario #id`. */
  protected readonly assigneeLabel = signal<string | null>(null);
  protected readonly customer = signal<CustomerSelectOption | null>(null);
  protected readonly saving = signal(false);
  protected readonly canSeeAll = () => crmCanSeeAll(this.auth);
  protected readonly fixedCustomerName = () => personName(this.fixedCustomer());

  /** Open opportunities of the customer (create) or the linked one (edit). */
  protected readonly opportunities = signal<CrmOpenOpportunity[]>([]);
  /** Whether the detection answered, so "none" is never said while loading. */
  protected readonly opportunitiesLoaded = signal(false);
  protected readonly opportunityId = signal<number | null>(null);
  protected readonly movesOpportunity = signal(false);
  protected readonly targetStageId = signal<number | null>(null);
  protected readonly supporters = signal<number[]>([]);
  /** Names of the saved supporters; the staff lookup cannot resolve an id. */
  protected readonly knownSupporters = signal<StoreUserOption[]>([]);
  protected readonly maxSupporters = CRM_TASK_MAX_SUPPORTERS;
  /** Discards answers of a customer that is no longer the chosen one. */
  private opportunityRequest = 0;

  private readonly customerId = computed(
    () => this.fixedCustomer()?.id ?? this.customer()?.id ?? null,
  );
  protected readonly selectedOpportunity = computed(
    () => this.opportunities().find((item) => item.id === this.opportunityId()) ?? null,
  );
  protected readonly opportunityOptions = computed<SelectorOption[]>(() => [
    { value: '', label: 'Sin oportunidad' },
    ...this.opportunities().map((item) => ({
      value: item.id,
      label: openOpportunityLabel(item),
    })),
  ]);
  /**
   * Target stages. Editing keeps the saved target offered, marked «(actual)»
   * when the opportunity already reached it on the board.
   */
  protected readonly stageOptions = computed<SelectorOption[]>(() => {
    const opportunity = this.selectedOpportunity();
    const saved = this.task()?.move_to_stage?.id ?? null;
    return taskTargetStages(opportunity, saved).map((stage) => ({
      value: stage.id,
      label: stage.id === opportunity?.stage?.id ? `${stage.name} (actual)` : stage.name,
    }));
  });
  /** The chosen target is one of the offered stages; an empty selector never saves. */
  protected readonly targetStageValid = computed(() => {
    if (!this.movesOpportunity() || !this.selectedOpportunity()) return true;
    const id = this.targetStageId();
    return id != null && this.stageOptions().some((option) => option.value === id);
  });
  /** Only helps with the saved task: everything but its status is read-only. */
  protected readonly supportOnly = computed(() => {
    const task = this.task();
    if (!task || this.canSeeAll()) return false;
    const userId = this.auth.userId();
    return isTaskSupporter(task, userId) && task.created_by?.id !== userId;
  });
  /** Support search through the tasks API (a seller may lack POS access). */
  protected readonly searchStaff = (term: string): Observable<StoreUserOption[]> =>
    this.crm.taskStaff(term).pipe(
      map((people) =>
        people.map((person) => ({
          id: person.id,
          name: personName(person) || `Usuario #${person.id}`,
        })),
      ),
    );
  /** The assignee is never a supporter too (the API drops it anyway). */
  protected readonly supportExcludedIds = computed(() => {
    const assignee = this.assignee();
    return assignee ? [assignee] : [];
  });
  private readonly supportIds = computed(() => {
    const assignee = this.assignee();
    return this.supporters().filter((id) => id !== assignee);
  });
  protected readonly tooManySupporters = computed(
    () => this.supportIds().length > CRM_TASK_MAX_SUPPORTERS,
  );
  protected readonly supportHintClass = computed(() =>
    this.tooManySupporters()
      ? 'text-xs text-[var(--color-error)]'
      : 'text-xs text-[var(--color-text-secondary)]',
  );
  protected readonly canSave = computed(
    () =>
      !this.supportOnly() &&
      !!this.title().trim() &&
      !this.tooManySupporters() &&
      this.targetStageValid(),
  );

  constructor() {
    effect(() => {
      if (!this.isOpen()) return;
      const task = this.task();
      untracked(() => {
        this.title.set(task?.title ?? '');
        this.dueAt.set(toLocalInput(task?.due_at));
        this.description.set(task?.description ?? '');
        this.assignee.set(task ? (task.assigned_user?.id ?? null) : this.auth.userId());
        this.assigneeLabel.set(
          task ? personName(task.assigned_user) || null : this.auth.userName(),
        );
        this.customer.set(
          task?.customer
            ? { id: task.customer.id, name: personName(task.customer) }
            : null,
        );
        const support = task?.support_users ?? [];
        this.knownSupporters.set(
          support.map((person) => ({ id: person.id, name: personName(person) })),
        );
        this.supporters.set(support.map((person) => person.id));
        this.opportunityId.set(task?.opportunity?.id ?? null);
        this.movesOpportunity.set(!!task?.move_to_stage);
        this.targetStageId.set(task?.move_to_stage?.id ?? null);
      });
    });

    // A new task detects the open opportunities of its customer, again on
    // every customer change. A saved one only loads the stages of its own.
    effect(() => {
      if (!this.isOpen()) return;
      const task = this.task();
      const customerId = task
        ? task.opportunity
          ? (task.customer?.id ?? this.fixedCustomer()?.id ?? null)
          : null
        : this.customerId();
      untracked(() => void this.loadOpportunities(customerId, task));
    });
  }

  protected selectOpportunity(id: number | null): void {
    this.opportunityId.set(id);
    this.movesOpportunity.set(false);
    this.targetStageId.set(null);
  }

  protected setMovesOpportunity(on: boolean): void {
    this.movesOpportunity.set(on);
    if (!on) this.targetStageId.set(null);
  }

  private async loadOpportunities(
    customerId: number | null,
    task: CrmTask | null,
  ): Promise<void> {
    const request = ++this.opportunityRequest;
    if (!task) this.selectOpportunity(null);
    this.opportunities.set([]);
    this.opportunitiesLoaded.set(false);
    if (!customerId) return;
    try {
      // Editing asks for its own opportunity too, so it is there past 20.
      const linkedId = task?.opportunity?.id;
      const list = await firstValueFrom(
        linkedId
          ? this.crm.openOpportunities(customerId, linkedId)
          : this.crm.openOpportunities(customerId),
      );
      if (request !== this.opportunityRequest) return;
      this.opportunities.set(list);
      this.opportunitiesLoaded.set(true);
      if (!task && list.length === 1) this.opportunityId.set(list[0].id);
      // A saved target that is no longer offered is cleared: choose again.
      if (task && !this.targetStageValid()) this.targetStageId.set(null);
    } catch {
      // Without pipeline access the task is simply saved without opportunity.
      if (request === this.opportunityRequest) this.opportunities.set([]);
    }
  }

  /** Opportunity fields of the body; only what the form can really change. */
  private opportunityBody(task: CrmTask | null): SaveCrmTask {
    const opportunity = this.selectedOpportunity();
    const stageId = opportunity && this.movesOpportunity() ? this.targetStageId() : null;
    if (!task) {
      if (!opportunity) return {};
      return {
        opportunity_id: opportunity.id,
        ...(stageId ? { move_to_stage_id: stageId } : {}),
      };
    }
    // An opportunity that is no longer open offers no stages: leave it as is.
    if (!opportunity || stageId === (task.move_to_stage?.id ?? null)) return {};
    return { move_to_stage_id: stageId };
  }

  /** Support set of the body; an edit only sends it when it changed. */
  private supportBody(task: CrmTask | null): SaveCrmTask {
    const ids = this.supportIds();
    if (!task) return ids.length ? { support_user_ids: ids } : {};
    const before = (task.support_users ?? []).map((person) => person.id);
    const same =
      before.length === ids.length && before.every((id) => ids.includes(id));
    return same ? {} : { support_user_ids: ids };
  }

  async save(): Promise<void> {
    const title = this.title().trim();
    if (!title || this.saving() || !this.canSave()) return;
    this.saving.set(true);
    const task = this.task();
    const customerId = this.fixedCustomer()?.id ?? this.customer()?.id;
    try {
      const body = {
        title,
        description: this.description().trim() || null,
        due_at: fromLocalInput(this.dueAt()),
        ...(this.canSeeAll() ? { assigned_user_id: this.assignee() } : {}),
        ...this.opportunityBody(task),
        ...this.supportBody(task),
      };
      const result = task
        ? await firstValueFrom(this.crm.updateTask(task.id, body))
        : await firstValueFrom(
            this.crm.createTask({
              ...body,
              description: body.description ?? undefined,
              due_at: body.due_at ?? undefined,
              ...(customerId ? { customer_id: customerId } : {}),
            }),
          );
      this.toast.success(task ? 'Tarea actualizada' : 'Tarea creada');
      this.saved.emit(result);
      this.isOpen.set(false);
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.saving.set(false);
    }
  }
}
