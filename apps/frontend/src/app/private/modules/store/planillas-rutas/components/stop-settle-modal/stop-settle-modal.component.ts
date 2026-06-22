import { Component, computed, input, output, signal } from "@angular/core";
import { FormsModule } from '@angular/forms';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import {
  DispatchRouteStop,
  DispatchRouteStopResult,
  SettleStopDto,
} from '../../interfaces/planilla.interface';

/**
 * Settle modal — TOTAL payment only.
 *
 * Per the dispatch-route business rule, a stop can only be settled as fully
 * paid or not paid at all. There are NO partial payments, NO credit, and NO
 * advance ("anticipo"). The result options are therefore reduced to:
 *
 *   - `delivered`: full payment — the collected amount MUST equal the total
 *     (prepaid stops collect 0 and are recorded with payment_method=`prepaid`).
 *   - `rejected`:  customer refused delivery — no cash collected.
 *
 * The "Liberar" path (release) lives in its own modal. The payload NEVER
 * carries `result='partial'`, `anticipo_amount`, or `credit_amount`.
 */
@Component({
  selector: 'app-stop-settle-modal',
  standalone: true,
  imports: [
    FormsModule,
    CurrencyPipe,
    ModalComponent,
    InputComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="true"
      title="Liquidar Parada"
      size="md"
      (cancel)="close.emit()"
    >
      <div class="space-y-3">
        <div class="text-sm text-text-secondary">
          Remisión: <strong>{{ stop().dispatch_note?.dispatch_number }}</strong
          ><br />
          Cliente: {{ stop().dispatch_note?.customer_name }}<br />
          Total: <strong>{{ grandTotal() | currency }}</strong>
        </div>

        @if (isPrepaid()) {
          <div
            class="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"
          >
            <strong>Parada prepagada.</strong> El recaudo se hizo antes del
            despacho; al liquidar se registrará como <em>entregada</em> con
            <code>collected_amount = 0</code> y método de pago
            <code>prepaid</code>. El sistema no generará movimiento de caja.
          </div>
        }

        <app-selector
          label="Resultado"
          [options]="resultOptions"
          [(ngModel)]="result"
        ></app-selector>

        @if (isDelivered() && !isPrepaid()) {
          <div class="grid grid-cols-2 gap-2">
            <app-input
              label="Recaudado (debe cubrir el total)"
              [currency]="true"
              [(ngModel)]="collectedAmount"
            ></app-input>
            <app-selector
              label="Método"
              [options]="paymentMethodOptions"
              [(ngModel)]="paymentMethod"
            ></app-selector>
          </div>

          @if (!collectedCoversTotal()) {
            <div
              class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
            >
              El monto recaudado ({{ collectedAmount | currency }}) debe ser
              igual al total ({{ grandTotal() | currency }}). No se permiten
              pagos parciales: cobra el total o registra la parada como
              <strong>rechazada</strong>.
            </div>
          }
        }

        @if (isRejected()) {
          <div
            class="rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-secondary"
          >
            La parada se marcará como <strong>rechazada</strong>. No se
            registrará recaudo.
          </div>
        }
      </div>

      <div slot="footer" class="flex gap-2">
        <button
          type="button"
          (click)="close.emit()"
          class="flex-1 rounded-md border border-border bg-surface px-4 py-2 text-sm"
        >
          Cancelar
        </button>
        <button
          type="button"
          (click)="submit()"
          [disabled]="submitting() || !canConfirm()"
          class="flex-1 rounded-md bg-primary-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {{ submitting() ? 'Guardando...' : 'Confirmar' }}
        </button>
      </div>
    </app-modal>
  `,
})
export class StopSettleModalComponent {
  readonly stop = input.required<DispatchRouteStop>();
  readonly grandTotal = input.required<number>();
  /**
   * True when the stop's dispatch note was already paid before dispatch.
   * The backend forces collected_amount=0 and payment_method='prepaid' in
   * that case; the modal surfaces a banner and hides the collected/method
   * fields so the operator does not enter a value that will be discarded.
   */
  readonly isPrepaid = input<boolean>(false);

  readonly close = output<void>();
  readonly submitted = output<SettleStopDto>();

  /**
   * Only TWO outcomes are allowed: full delivery (cobro total) or rejection.
   * "Partial" was removed entirely — half/credit/advance payments are not a
   * supported flow on a dispatch route.
   */
  readonly resultOptions: SelectorOption[] = [
    { value: 'delivered', label: 'Entregada y cobrada (total)' },
    { value: 'rejected', label: 'Rechazada' },
  ];

  readonly paymentMethodOptions: SelectorOption[] = [
    { value: 'cash', label: 'Efectivo' },
    { value: 'transfer', label: 'Transferencia' },
    { value: 'card', label: 'Tarjeta' },
  ];

  /** Selected outcome — bound to the selector via ngModel. Mirrored to a signal. */
  private _result: DispatchRouteStopResult = 'delivered';
  get result(): DispatchRouteStopResult {
    return this._result;
  }
  set result(value: DispatchRouteStopResult) {
    this._result = value;
    this.resultSig.set(value);
  }

  /** Collected amount (raw numeric from the currency CVA). Mirrored to a signal. */
  private _collectedAmount = 0;
  get collectedAmount(): number {
    return this._collectedAmount;
  }
  set collectedAmount(value: number) {
    this._collectedAmount = value;
    this.collectedSig.set(Number(value) || 0);
  }

  paymentMethod = 'cash';
  readonly submitting = signal(false);

  // Signal mirrors so templates/computed react in the zoneless runtime.
  private readonly resultSig = signal<DispatchRouteStopResult>('delivered');
  private readonly collectedSig = signal(0);

  readonly isDelivered = computed(() => this.resultSig() === 'delivered');
  readonly isRejected = computed(() => this.resultSig() === 'rejected');

  /**
   * Whether the collected amount fully covers the total. Prepaid stops cover
   * the total by definition (collection happened before dispatch).
   */
  readonly collectedCoversTotal = computed(() => {
    if (this.isPrepaid()) return true;
    const total = Number(this.grandTotal()) || 0;
    return (this.collectedSig() || 0) >= total;
  });

  /**
   * Confirm is allowed when the stop is rejected, or when it is delivered with
   * a collected amount that covers the total. Never with a partial amount.
   */
  readonly canConfirm = computed(() => {
    if (this.isRejected()) return true;
    if (this.isPrepaid()) return true;
    return this.isDelivered() && this.collectedCoversTotal();
  });

  submit() {
    if (!this.canConfirm()) return;
    this.submitting.set(true);

    if (this.isRejected()) {
      this.submitted.emit({
        result: 'rejected',
        collected_amount: 0,
        change_amount: 0,
        payment_method: this.paymentMethod,
      });
      return;
    }

    // Delivered: full payment only. Prepaid stops collect 0; everyone else
    // must have collected the full total (guarded by canConfirm).
    const dto: SettleStopDto = {
      result: 'delivered',
      collected_amount: this.isPrepaid() ? 0 : Number(this.collectedAmount) || 0,
      change_amount: 0,
      payment_method: this.isPrepaid() ? 'prepaid' : this.paymentMethod,
    };
    this.submitted.emit(dto);
  }
}
