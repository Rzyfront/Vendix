import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { RouterLink } from '@angular/router';
import {
  Subscription,
  exhaustMap,
  startWith,
  take,
  takeWhile,
  timer,
} from 'rxjs';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { CustomerModalComponent } from '../../../customers/components/customer-modal/customer-modal.component';
import {
  Customer,
  CreateCustomerRequest,
} from '../../../customers/models/customer.model';
import { CustomersService } from '../../../customers/services/customers.service';
import { AddressPayload } from '../../../../../../shared/components/address-form-fields/address-form-fields.component';
import {
  InvoiceHolderChangeService,
  HolderChangeContext,
  HolderChangeOperation,
  HolderChangeCommand,
} from '../../services/invoice-holder-change.service';
import * as ActionsInvoice from '../../state/actions/invoicing.actions';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';

let nextHolderChangeRequestId = 0;
@Component({
  selector: 'vendix-invoice-holder-change',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    CustomerModalComponent,
    RouterLink,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` @if (context(); as ctx) {
      @if (ctx.operation || ctx.can_remake || ctx.can_release) {
        <button type="button" (click)="open()">
          {{
            ctx.operation
              ? 'Continuar refacturación'
              : 'Rehacer / liberar factura'
          }}
        </button>
      } @else if (ctx.reason) {
        <small>{{ reasonLabel(ctx.reason) }}</small>
      }
    }
    <app-modal
      [(isOpen)]="isOpen"
      title="Rehacer factura"
      size="lg"
      (cancel)="stopPolling()"
    >
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
      @if (operation(); as op) {
        <section aria-live="polite">
          <h3>{{ phaseLabel() }}</h3>
          <p>{{ op.last_error_message || phaseDescription() }}</p>
          <p>
            Original #{{ op.original_invoice_id }}
            @if (op.credit_note_id) {
              · Nota crédito #{{ op.credit_note_id }}
            }
            @if (op.new_invoice_id) {
              · Nueva factura #{{ op.new_invoice_id }}
            }
          </p>
          <div class="history-links">
            <a
              [routerLink]="['/admin/invoicing/invoices']"
              [queryParams]="{ invoiceId: op.original_invoice_id }"
              >Consultar original</a
            >
            @if (op.credit_note_id) {
              <a
                [routerLink]="['/admin/invoicing/invoices']"
                [queryParams]="{ invoiceId: op.credit_note_id }"
                >Consultar nota crédito</a
              >
            }
            @if (op.new_invoice_id) {
              <a
                [routerLink]="['/admin/invoicing/invoices']"
                [queryParams]="{ invoiceId: op.new_invoice_id }"
                >Consultar nueva factura</a
              >
            }
          </div>
          @if (canChooseCustomer()) {
            <label
              >Buscar cliente por nombre o documento<input
                [formControl]="search" /></label
            ><button
              type="button"
              [disabled]="busy()"
              (click)="findCustomers()"
            >
              Buscar
            </button>
            <ul>
              @for (customer of customers(); track customer.id) {
                <li>
                  <button
                    type="button"
                    [disabled]="busy()"
                    (click)="chooseCustomer(customer)"
                  >
                    {{ customer.legal_name || customer.first_name }}
                    {{ customer.last_name }} · {{ customer.document_number }}
                  </button>
                </li>
              }
            </ul>
            <button
              type="button"
              [disabled]="busy()"
              (click)="lookupExternal()"
            >
              Consultar RUES por documento
            </button>
            <button
              type="button"
              [disabled]="busy()"
              (click)="createCustomer()"
            >
              Crear cliente con datos de facturación
            </button>
          }
          @if (!op.fiscal_completed && !canChooseCustomer()) {
            <button type="button" [disabled]="busy()" (click)="refresh()">
              Actualizar estado
            </button>
          }
          @if (
            (op.can_retry &&
              op.run_status !== 'waiting' &&
              op.run_status !== 'running') ||
            op.phase === 'customer_ready'
          ) {
            <button type="button" [disabled]="busy()" (click)="resume()">
              {{
                op.phase === 'customer_ready'
                  ? 'Emitir nueva factura'
                  : 'Reintentar / continuar'
              }}
            </button>
          }
        </section>
      } @else {
        <p>
          La factura original y su nota crédito se conservarán. La nueva factura
          solo se emitirá después de la aceptación de la nota crédito por la
          DIAN.
        </p>
        <label
          >Motivo *<textarea
            [formControl]="reason"
            rows="3"
            maxlength="500"
          ></textarea>
        </label>
        <p>
          Rehacer continúa con un nuevo titular. Liberar solo desvincula la
          factura cuando existe una anulación total aceptada y no emite una
          nueva automáticamente.
        </p>
        <button
          type="button"
          [disabled]="
            busy() || reasonStatus() !== 'VALID' || !context()?.can_remake
          "
          (click)="begin('remake')"
        >
          Confirmar y rehacer factura
        </button>
        <button
          type="button"
          [disabled]="
            busy() || reasonStatus() !== 'VALID' || !context()?.can_release
          "
          (click)="begin('release')"
        >
          Solo liberar orden
        </button>
      }
      <button
        slot="footer"
        type="button"
        (click)="isOpen.set(false); stopPolling()"
      >
        Cerrar (el proceso se conserva)
      </button>
    </app-modal>
    <app-customer-modal
      [isOpen]="showCustomerModal()"
      [forceBilling]="true"
      [initialValues]="customerPrefill()"
      [initialBillingAddress]="billingPrefill()"
      [loading]="busy()"
      (isOpenChange)="showCustomerModal.set($event)"
      (closed)="showCustomerModal.set(false)"
      (addressData)="newAddress.set($event)"
      (save)="saveNewCustomer($event)"
    />`,
  styles: [
    `
      :host {
        display: block;
      }
      button {
        min-height: 44px;
        padding: 0.55rem 0.8rem;
        margin: 0.35rem;
        border: 1px solid var(--color-border, #ccc);
        border-radius: 0.5rem;
        background: var(--color-surface, #fff);
        color: var(--color-text-primary, #222);
      }
      button:disabled {
        opacity: 0.5;
      }
      label {
        display: grid;
        gap: 0.4rem;
        margin: 1rem 0;
      }
      input,
      textarea {
        padding: 0.65rem;
        border: 1px solid var(--color-border, #bbb);
        border-radius: 0.5rem;
        background: var(--color-surface, #fff);
        color: inherit;
        font: inherit;
      }
      button:focus-visible,
      input:focus-visible,
      textarea:focus-visible {
        outline: 2px solid var(--color-primary, #2563eb);
        outline-offset: 2px;
      }
      .history-links {
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;
      }
      a {
        color: var(--color-primary, #2563eb);
      }
      small {
        display: block;
        color: var(--color-text-secondary, #555);
      }
    `,
  ],
})
export class InvoiceHolderChangeComponent {
  readonly invoiceId = input.required<number>();
  readonly initialOperationId = input<number | null>(null);
  readonly changed = output<HolderChangeOperation>();
  private readonly service = inject(InvoiceHolderChangeService);
  private readonly customersService = inject(CustomersService);
  private readonly store = inject(Store);
  private readonly actions = inject(Actions);
  private readonly destroyRef = inject(DestroyRef);
  readonly context = signal<HolderChangeContext | null>(null);
  readonly operation = signal<HolderChangeOperation | null>(null);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly isOpen = signal(false);
  readonly showCustomerModal = signal(false);
  readonly customerPrefill = signal<Partial<CreateCustomerRequest> | null>(
    null,
  );
  readonly billingPrefill = signal<AddressPayload | null>(null);
  readonly newAddress = signal<AddressPayload | null>(null);
  readonly customers = signal<Customer[]>([]);
  readonly reason = new FormControl('', {
    nonNullable: true,
    validators: [
      Validators.required,
      Validators.minLength(10),
      Validators.maxLength(500),
    ],
  });
  readonly search = new FormControl('', { nonNullable: true });
  readonly reasonStatus = toSignal(
    this.reason.statusChanges.pipe(startWith(this.reason.status)),
    { initialValue: this.reason.status },
  );
  readonly canChooseCustomer = computed(() =>
    ['order_released', 'awaiting_customer'].includes(
      this.operation()?.phase || '',
    ),
  );
  readonly phaseLabel = computed(() => {
    const op = this.operation();
    if (op?.fiscal_completed)
      return op.accounting_pending
        ? 'Factura aceptada · conciliación pendiente'
        : 'Factura emitida';
    if (this.canChooseCustomer())
      return 'Orden liberada · elige el nuevo titular';
    if (op?.phase === 'customer_ready')
      return 'Cliente listo · confirma la emisión';
    if (op?.run_status === 'action_required') return 'Requiere atención';
    return 'Procesando refacturación';
  });
  readonly phaseDescription = computed(() =>
    this.operation()?.phase?.includes('credit')
      ? 'Esperando la nota crédito aceptada por la DIAN. No se emitirá antes la nueva factura.'
      : 'Puedes cerrar y volver: el proceso conserva sus documentos y avances.',
  );
  private polling?: Subscription;
  private pendingRequestId = '';
  private loadedInvoiceId = 0;
  constructor() {
    effect(() => {
      const id = this.invoiceId();
      const operationId = this.initialOperationId();
      if (id !== this.loadedInvoiceId) {
        this.loadedInvoiceId = id;
        this.pendingRequestId = '';
        this.stopPolling();
        this.operation.set(null);
        this.context.set(null);
        this.busy.set(false);
        this.isOpen.set(false);
        if (id > 0) this.loadContext(id);
      }
      if (operationId) this.loadOperation(operationId);
    });
    this.actions
      .pipe(
        ofType(ActionsInvoice.holderChangeCommandSuccess),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ requestId, operation }) => {
        if (requestId !== this.pendingRequestId) return;
        this.busy.set(false);
        this.operation.set(operation);
        this.showCustomerModal.set(false);
        this.changed.emit(operation);
        this.loadContext(this.invoiceId());
        if (this.isOpen()) this.startPolling();
      });
    this.actions
      .pipe(
        ofType(ActionsInvoice.holderChangeCommandFailure),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ requestId, error }) => {
        if (requestId === this.pendingRequestId) {
          this.busy.set(false);
          this.error.set(error);
        }
      });
  }
  private loadContext(id: number): void {
    this.service
      .context(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (ctx) => {
          if (id === this.invoiceId()) {
            this.context.set(ctx);
            if (ctx.operation) this.operation.set(ctx.operation);
          }
        },
        error: (e) => this.error.set(parseApiError(e).userMessage),
      });
  }
  private loadOperation(id: number): void {
    this.service
      .operation(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (op) => {
          if (op.original_invoice_id === this.invoiceId())
            this.operation.set(op);
        },
        error: (e) => this.error.set(parseApiError(e).userMessage),
      });
  }
  reasonLabel(reason: string): string {
    return (
      (
        {
          unsupported_document:
            'Este documento no admite cambio de titular (tipo no compatible o cuenta dividida).',
          admission_disabled:
            'El cambio de titular no está habilitado en esta tienda.',
          existing_operation:
            'Esta factura ya tiene un proceso. Usa Continuar refacturación.',
        } as Record<string, string>
      )[reason] || 'Este documento no admite un nuevo cambio de titular.'
    );
  }
  open(): void {
    this.isOpen.set(true);
    this.error.set('');
    this.loadContext(this.invoiceId());
    if (this.operation()) this.startPolling();
  }
  begin(kind: 'remake' | 'release'): void {
    if (this.reason.invalid || this.busy()) return;
    this.command({
      kind,
      invoiceId: this.invoiceId(),
      reason: this.reason.value.trim(),
    });
  }
  resume(): void {
    const op = this.operation();
    if (op) this.command({ kind: 'resume', operationId: op.id });
  }
  refresh(): void {
    const id = this.operation()?.id;
    if (id) this.loadOperation(id);
    else this.loadContext(this.invoiceId());
  }
  findCustomers(): void {
    if (!this.search.value.trim()) return;
    this.customersService
      .getCustomers(1, 15, { search: this.search.value.trim() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => this.customers.set(r.data),
        error: (e) => this.error.set(parseApiError(e).userMessage),
      });
  }
  createCustomer(): void {
    this.customerPrefill.set(null);
    this.billingPrefill.set(null);
    this.newAddress.set(null);
    this.showCustomerModal.set(true);
  }
  lookupExternal(): void {
    if (!this.search.value.trim()) return;
    this.customersService
      .lookupExternalByDocument(this.search.value.trim())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          if (r.found && r.identity) {
            this.customerPrefill.set({
              person_type: r.identity.person_type,
              document_type: r.identity.document_type,
              document_number: r.identity.document_number,
              verification_digit: r.identity.verification_digit,
              legal_name: r.identity.legal_name,
              first_name: r.identity.first_name || '',
              last_name: r.identity.last_name || '',
            });
            this.showCustomerModal.set(true);
          } else
            this.error.set(
              'No encontramos datos públicos. Puedes crear el cliente manualmente.',
            );
        },
        error: (e) => this.error.set(parseApiError(e).userMessage),
      });
  }
  chooseCustomer(customer: Customer): void {
    const op = this.operation();
    if (!op || this.busy()) return;
    this.customersService
      .getCustomer(customer.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const full =
            'data' in response
              ? (response as unknown as { data: Customer }).data
              : response;
          const billing =
            full.billing_address ??
            full.addresses?.find((a) => a.type === 'billing');
          if (
            full.email &&
            full.document_number &&
            billing?.address_line1 &&
            billing.municipality_code
          ) {
            this.command({
              kind: 'customer',
              operationId: op.id,
              customer: { customer_id: customer.id },
            });
            return;
          }
          this.customerPrefill.set({ ...full });
          this.billingPrefill.set(
            billing
              ? {
                  address_line1: billing.address_line1 ?? null,
                  address_line2: billing.address_line2 ?? null,
                  city: billing.city ?? null,
                  state_province: billing.state_province ?? null,
                  country_code: billing.country_code ?? 'CO',
                  postal_code: billing.postal_code ?? null,
                  phone_number: billing.phone_number ?? null,
                  latitude: billing.latitude ?? null,
                  longitude: billing.longitude ?? null,
                  municipality_code: billing.municipality_code ?? null,
                }
              : null,
          );
          this.showCustomerModal.set(true);
        },
        error: (e) => this.error.set(parseApiError(e).userMessage),
      });
  }
  saveNewCustomer(data: CreateCustomerRequest): void {
    const op = this.operation(),
      address = this.newAddress();
    if (!op || !address?.municipality_code) {
      this.error.set(
        'Completa la dirección fiscal y su municipio antes de continuar.',
      );
      return;
    }
    this.command({
      kind: 'customer',
      operationId: op.id,
      customer: {
        snapshot: {
          person_type: data.person_type,
          document_type: data.document_type,
          document_number: data.document_number,
          verification_digit: data.verification_digit || undefined,
          first_name: data.first_name || undefined,
          last_name: data.last_name || undefined,
          legal_name: data.legal_name || undefined,
          tax_regime: data.tax_regime || undefined,
          fiscal_responsibilities: data.fiscal_responsibilities,
          email: data.email,
          phone: data.phone || undefined,
          address: {
            address_line1: address.address_line1,
            city: address.city,
            state_province: address.state_province,
            country_code: address.country_code,
            municipality_code: address.municipality_code,
          },
        },
      },
    });
  }
  private command(command: HolderChangeCommand): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.pendingRequestId = `holder-${this.invoiceId()}-${++nextHolderChangeRequestId}-${Date.now()}`;
    this.store.dispatch(
      ActionsInvoice.holderChangeCommand({
        requestId: this.pendingRequestId,
        command,
      }),
    );
  }
  stopPolling(): void {
    this.polling?.unsubscribe();
  }
  private startPolling(): void {
    this.stopPolling();
    const id = this.operation()?.id;
    if (!id) return;
    this.polling = timer(3000, 5000)
      .pipe(
        take(60),
        exhaustMap(() => this.service.operation(id)),
        takeWhile(() => !this.operation()?.fiscal_completed, true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (op) => {
          const previous = this.operation();
          this.operation.set(op);
          if (
            previous?.phase !== op.phase ||
            previous?.run_status !== op.run_status ||
            previous?.new_invoice_id !== op.new_invoice_id
          )
            this.changed.emit(op);
        },
        error: (e) => this.error.set(parseApiError(e).userMessage),
      });
  }
}
