import { Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import {
  ButtonComponent,
  CustomerSelectComponent,
  type CustomerSelectOption,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  StoreUserSelectComponent,
  ToastService,
} from '../../../../../../shared/components';
import type { SelectorOption } from '../../../../../../shared/components';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { CrmService } from '../shared/crm.service';
import {
  CrmOpportunity,
  CrmStage,
  SaveCrmOpportunity,
  personName,
} from '../shared/crm.interface';
import { crmCanSeeAll } from '../shared/crm.utils';

export type OpportunityModalAction = 'saved' | 'won' | 'lose';

/**
 * Create or edit an opportunity. The stage is chosen on creation; afterwards
 * it changes by dragging on the board, "Mover a" or the win/lose buttons.
 */
@Component({
  selector: 'app-crm-opportunity-form-modal',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    CustomerSelectComponent,
    InputComponent,
    ModalComponent,
    SelectorComponent,
    StoreUserSelectComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      [title]="opportunity() ? 'Editar oportunidad' : 'Nueva oportunidad'"
      size="md"
    >
      <div class="flex flex-col gap-4">
        @if (opportunity(); as o) {
          <p class="text-sm text-[var(--color-text-secondary)]">
            Cliente: <strong>{{ name(o.customer) }}</strong> · Etapa: <strong>{{ o.stage?.name }}</strong>
            @if (o.status === 'lost' && o.lost_reason) {
              · Motivo: {{ o.lost_reason }}
            }
          </p>
        } @else {
          <app-customer-select
            label="Cliente"
            [allowCreate]="false"
            [selected]="customer()"
            (selectedChange)="onCustomer($event)"
          ></app-customer-select>
        }

        <app-input
          label="Oportunidad"
          placeholder="Ej.: Dotación de uniformes 2027"
          [maxlength]="160"
          [ngModel]="title()"
          (ngModelChange)="title.set($event)"
        ></app-input>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <app-input
            label="Valor"
            type="number"
            [min]="0"
            step="0.01"
            [ngModel]="amount()"
            (ngModelChange)="amount.set($event)"
          ></app-input>
          <app-input
            label="Fecha esperada de cierre"
            type="date"
            [ngModel]="expectedDate()"
            (ngModelChange)="expectedDate.set($event)"
          ></app-input>
        </div>

        @if (!opportunity()) {
          <app-selector
            label="Etapa"
            [options]="stageOptions()"
            [ngModel]="stageId()"
            (ngModelChange)="stageId.set($event ? +$event : null)"
          ></app-selector>
        }

        @if (canSeeAll()) {
          <div class="flex flex-col gap-1">
            <span class="text-sm font-medium text-[var(--color-text-primary)]">Responsable</span>
            <app-store-user-select
              placeholder="Buscar persona del equipo..."
              lookupMode="staff"
              [value]="ownerId()"
              (valueChange)="ownerId.set($event)"
            ></app-store-user-select>
          </div>
        }

        @if (canReadQuotations()) {
          <app-selector
            label="Cotización vinculada (opcional)"
            placeholder="Sin cotización"
            helpText="Si la cotización se acepta o se convierte en pedido, la oportunidad pasa a ganada."
            [options]="quotationOptions()"
            [disabled]="!customerIdForQuotes()"
            [ngModel]="quotationId() ?? ''"
            (ngModelChange)="quotationId.set($event ? +$event : null)"
          ></app-selector>
        }
      </div>

      <div slot="footer" class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex gap-2">
          @if (opportunity(); as o) {
            @if (o.status !== 'won') {
              <app-button variant="outline-success" size="md" [disabled]="saving()" (clicked)="action.emit('won')">
                Ganada
              </app-button>
            }
            @if (o.status !== 'lost') {
              <app-button variant="outline-danger" size="md" [disabled]="saving()" (clicked)="action.emit('lose')">
                Perdida
              </app-button>
            }
          }
        </div>
        <div class="flex gap-2">
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
      </div>
    </app-modal>
  `,
})
export class OpportunityFormModalComponent {
  private readonly crm = inject(CrmService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthFacade);

  readonly isOpen = model(false);
  readonly opportunity = input<CrmOpportunity | null>(null);
  readonly stages = input<CrmStage[]>([]);
  readonly saved = output<CrmOpportunity>();
  readonly action = output<OpportunityModalAction>();

  protected readonly customer = signal<CustomerSelectOption | null>(null);
  protected readonly title = signal('');
  protected readonly amount = signal<string | number>('');
  protected readonly expectedDate = signal('');
  protected readonly stageId = signal<number | null>(null);
  protected readonly ownerId = signal<number | null>(null);
  protected readonly quotationId = signal<number | null>(null);
  protected readonly quotationOptions = signal<SelectorOption[]>([]);
  protected readonly saving = signal(false);

  protected readonly name = personName;
  protected readonly canSeeAll = computed(() => crmCanSeeAll(this.auth));
  protected readonly canReadQuotations = computed(
    () => this.auth.isOwner() || this.auth.hasPermission('store:quotations:read'),
  );
  protected readonly stageOptions = computed<SelectorOption[]>(() =>
    this.stages()
      .filter((stage) => stage.is_active !== false && stage.kind !== 'lost')
      .map((stage) => ({ value: stage.id, label: stage.name })),
  );
  protected readonly customerIdForQuotes = computed(
    () => this.opportunity()?.customer?.id ?? this.customer()?.id ?? null,
  );
  protected readonly canSave = computed(
    () =>
      !!this.title().trim() &&
      (!!this.opportunity() || (!!this.customer() && !!this.stageId())),
  );

  constructor() {
    effect(() => {
      if (!this.isOpen()) return;
      const o = this.opportunity();
      untracked(() => {
        this.customer.set(null);
        this.title.set(o?.title ?? '');
        this.amount.set(o?.amount ?? '');
        this.expectedDate.set(o?.expected_close_date ?? '');
        this.stageId.set(
          o?.stage_id ?? (this.stageOptions()[0]?.value as number | undefined) ?? null,
        );
        this.ownerId.set(o ? (o.owner?.id ?? null) : this.auth.userId());
        this.quotationId.set(o?.quotation?.id ?? null);
        this.quotationOptions.set(
          o?.quotation
            ? [{ value: o.quotation.id, label: o.quotation.quotation_number }]
            : [],
        );
        if (o?.customer) void this.loadQuotations(o.customer.id);
      });
    });
  }

  onCustomer(customer: CustomerSelectOption | null): void {
    this.customer.set(customer);
    this.quotationId.set(null);
    this.quotationOptions.set([]);
    if (customer) void this.loadQuotations(customer.id);
  }

  private async loadQuotations(customerId: number): Promise<void> {
    if (!this.canReadQuotations()) return;
    try {
      const rows = await firstValueFrom(this.crm.customerQuotations(customerId));
      this.quotationOptions.set(
        rows.map((row) => ({
          value: row.id,
          label: `${row.quotation_number} · ${row.status}`,
        })),
      );
    } catch {
      // Linking a quotation is optional.
    }
  }

  async save(): Promise<void> {
    if (!this.canSave() || this.saving()) return;
    this.saving.set(true);
    const o = this.opportunity();
    const rawAmount = this.amount();
    const amount =
      rawAmount === '' || rawAmount === null ? null : Number(rawAmount);
    const body: SaveCrmOpportunity = {
      title: this.title().trim(),
      amount: amount !== null && Number.isFinite(amount) ? amount : null,
      expected_close_date: this.expectedDate() || null,
      quotation_id: this.quotationId(),
      ...(this.canSeeAll() ? { owner_user_id: this.ownerId() } : {}),
    };
    try {
      const result = o
        ? await firstValueFrom(this.crm.updateOpportunity(o.id, body))
        : await firstValueFrom(
            this.crm.createOpportunity({
              ...body,
              customer_id: this.customer()!.id,
              stage_id: this.stageId()!,
              amount: body.amount ?? undefined,
              expected_close_date: body.expected_close_date ?? undefined,
              quotation_id: body.quotation_id ?? undefined,
            }),
          );
      this.toast.success(o ? 'Oportunidad actualizada' : 'Oportunidad creada');
      this.saved.emit(result);
      this.isOpen.set(false);
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.saving.set(false);
    }
  }
}
