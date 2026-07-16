import {
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  IconComponent,
} from '../../../../../../../shared/components/index';
import { Table, OpenTableSessionDto } from '../../interfaces';
import { PosCustomerSelectorComponent } from '../../../../pos/components/pos-customer-selector/pos-customer-selector.component';
import { PosCustomer } from '../../../../pos/models/customer.model';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';

/**
 * Modal for opening a new table session.
 *
 * Collects the optional guest count and confirms. The parent page owns
 * the actual `openSession` call so the resulting session can navigate
 * the user to the detail page.
 */
@Component({
  selector: 'app-open-table-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    IconComponent,
    PosCustomerSelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'sm'"
      [title]="'Abrir ' + (table()?.name ?? 'mesa')"
      [subtitle]="
        'Cuenta editable en tiempo real. Se creará una orden en estado draft.'
      "
    >
      <form [formGroup]="form" class="space-y-4">
        <div class="table-summary">
          <app-icon name="table" [size]="20"></app-icon>
          <div class="info">
            <strong>{{ table()?.name }}</strong>
            @if (table()?.zone) {
              <span>{{ table()?.zone }}</span>
            }
            @if (table()?.capacity) {
              <span>Capacidad: {{ table()?.capacity }}</span>
            }
          </div>
        </div>

        <app-input
          formControlName="guest_count"
          label="Número de comensales"
          type="number"
          [min]="1"
          [max]="table()?.capacity ?? 20"
          placeholder="Opcional"
          [required]="false"
          customWrapperClass="mt-0"
        />
      </form>

      <!-- Cliente opcional asociado a la cuenta de la mesa -->
      <div class="customer-block">
        <div class="customer-label">
          <app-icon name="user" [size]="16"></app-icon>
          <span>Cliente (opcional)</span>
        </div>
        @if (selectedCustomer(); as c) {
          <div class="customer-chip">
            <div class="chip-info">
              <app-icon name="user-check" [size]="16"></app-icon>
              <span>{{ c.first_name }} {{ c.last_name ?? '' }}</span>
            </div>
            <app-button
              variant="ghost"
              size="sm"
              (clicked)="clearCustomer()"
            >
              Quitar
            </app-button>
          </div>
        } @else {
          <app-pos-customer-selector
            [selectedCustomer]="selectedCustomer()"
            [allowAnonymous]="allowAnonymousSales()"
            (customerSelected)="onCustomerSelected($event)"
            (customerCleared)="clearCustomer()"
          />
        }

        <!-- Gate feedback: mirror the POS anonymous-sale rule. -->
        @if (!canOpen()) {
          <p class="customer-hint customer-hint--error">
            <app-icon name="circle-alert" [size]="14"></app-icon>
            Selecciona un cliente para abrir la mesa.
          </p>
        } @else if (allowAnonymousSales() && !selectedCustomer()) {
          <p class="customer-hint">
            <app-icon name="info" [size]="14"></app-icon>
            Se abrirá como consumidor final (venta anónima).
          </p>
        }
      </div>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="onCancel()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          [loading]="loading()"
          [disabled]="!canOpen()"
          (clicked)="onSubmit()"
        >
          Abrir mesa
        </app-button>
      </div>
    </app-modal>
  `,
  styleUrl: './open-table-modal.component.scss',
})
export class OpenTableModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly settingsFacade = inject(StoreSettingsFacade);

  readonly isOpen = input(false);
  readonly table = input<Table | null>(null);
  readonly loadingInput = input(false, { alias: 'loading' });
  readonly internalLoading = signal(false);
  readonly loading = computed(() => this.loadingInput() || this.internalLoading());

  readonly isOpenChange = output<boolean>();
  readonly open = output<OpenTableSessionDto>();

  readonly form: FormGroup;

  /** Cliente opcional seleccionado para asociar a la sesión/orden. */
  readonly selectedCustomer = signal<PosCustomer | null>(null);

  /**
   * Anonymous-sale settings, read from the SAME reactive facade the POS
   * payment interface uses (`pos.allow_anonymous_sales` /
   * `pos.anonymous_sales_as_default`). When anonymous sales are OFF a table
   * cannot be opened without a client — the backend rejects it with 422
   * (`TABLE_SESSION_CUSTOMER_REQUIRED`), so we gate the button to give the
   * operator immediate feedback instead of hitting that throw.
   */
  readonly allowAnonymousSales = computed(
    () => this.settingsFacade.pos()?.allow_anonymous_sales ?? false,
  );
  readonly anonymousSalesAsDefault = computed(
    () => this.settingsFacade.pos()?.anonymous_sales_as_default ?? false,
  );

  /**
   * Can the table be opened right now? Requires a selected client UNLESS
   * anonymous sales are enabled (then it opens as consumidor final with
   * `customer_id = null`).
   */
  readonly canOpen = computed(
    () => this.allowAnonymousSales() || this.selectedCustomer() != null,
  );

  constructor() {
    this.form = this.fb.group({
      guest_count: [null as number | null],
    });
  }

  onCustomerSelected(customer: PosCustomer): void {
    this.selectedCustomer.set(customer);
  }

  clearCustomer(): void {
    this.selectedCustomer.set(null);
  }

  onCancel(): void {
    this.selectedCustomer.set(null);
    this.isOpenChange.emit(false);
  }

  onSubmit(): void {
    if (this.form.invalid || !this.table() || !this.canOpen()) return;
    const v = this.form.getRawValue() as { guest_count: number | null };
    const customer = this.selectedCustomer();
    const customerId =
      customer &&
      Number.isFinite(Number(customer.id)) &&
      Number(customer.id) > 0
        ? Number(customer.id)
        : undefined;
    this.open.emit({
      table_id: this.table()!.id,
      guest_count: v.guest_count ?? undefined,
      ...(customerId ? { customer_id: customerId } : {}),
    });
  }
}
