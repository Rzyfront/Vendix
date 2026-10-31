import { Component, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import {
  ButtonComponent,
  CustomerSelectComponent,
  type CustomerSelectOption,
  InputComponent,
  ModalComponent,
  StoreUserSelectComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../shared/components';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { CrmService } from './crm.service';
import { CrmPerson, CrmTask, personName } from './crm.interface';
import { crmCanSeeAll, fromLocalInput, toLocalInput } from './crm.utils';

/**
 * Create or edit a CRM task. A seller can only assign to themselves (the API
 * answers CRM_ASSIGN_001 otherwise), so the assignee picker is hidden for them.
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
    StoreUserSelectComponent,
    TextareaComponent,
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
        <app-input
          label="Qué hay que hacer"
          placeholder="Ej.: Llamar para confirmar la cotización"
          [maxlength]="200"
          [ngModel]="title()"
          (ngModelChange)="title.set($event)"
        ></app-input>

        <app-input
          label="Vence"
          type="datetime-local"
          [ngModel]="dueAt()"
          (ngModelChange)="dueAt.set($event)"
        ></app-input>

        @if (!fixedCustomer()) {
          <app-customer-select
            label="Cliente (opcional)"
            [allowCreate]="false"
            [selected]="customer()"
            (selectedChange)="customer.set($event)"
          ></app-customer-select>
        } @else {
          <p class="text-sm text-[var(--color-text-secondary)]">
            Cliente: <strong>{{ fixedCustomerName() }}</strong>
          </p>
        }

        @if (canSeeAll()) {
          <div class="flex flex-col gap-1">
            <span class="text-sm font-medium text-[var(--color-text-primary)]">Responsable</span>
            <app-store-user-select
              placeholder="Buscar persona del equipo..."
              lookupMode="staff"
              [value]="assignee()"
              (valueChange)="assignee.set($event)"
            ></app-store-user-select>
          </div>
        }

        <app-textarea
          label="Detalle (opcional)"
          [ngModel]="description()"
          (ngModelChange)="description.set($event)"
        ></app-textarea>
      </div>

      <div slot="footer" class="flex flex-wrap justify-end gap-3">
        <app-button variant="outline" size="md" (clicked)="isOpen.set(false)">Cancelar</app-button>
        <app-button
          variant="primary"
          size="md"
          [disabled]="!title().trim()"
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
  protected readonly customer = signal<CustomerSelectOption | null>(null);
  protected readonly saving = signal(false);
  protected readonly canSeeAll = () => crmCanSeeAll(this.auth);
  protected readonly fixedCustomerName = () => personName(this.fixedCustomer());

  constructor() {
    effect(() => {
      if (!this.isOpen()) return;
      const task = this.task();
      untracked(() => {
        this.title.set(task?.title ?? '');
        this.dueAt.set(toLocalInput(task?.due_at));
        this.description.set(task?.description ?? '');
        this.assignee.set(task ? (task.assigned_user?.id ?? null) : this.auth.userId());
        this.customer.set(
          task?.customer
            ? { id: task.customer.id, name: personName(task.customer) }
            : null,
        );
      });
    });
  }

  async save(): Promise<void> {
    const title = this.title().trim();
    if (!title || this.saving()) return;
    this.saving.set(true);
    const task = this.task();
    const customerId = this.fixedCustomer()?.id ?? this.customer()?.id;
    try {
      const body = {
        title,
        description: this.description().trim() || null,
        due_at: fromLocalInput(this.dueAt()),
        ...(this.canSeeAll() ? { assigned_user_id: this.assignee() } : {}),
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
