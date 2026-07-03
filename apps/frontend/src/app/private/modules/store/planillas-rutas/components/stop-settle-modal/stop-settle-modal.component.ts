import { Component, computed, input, output, signal } from "@angular/core";
import { FormsModule } from '@angular/forms';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  DispatchRouteStop,
  DispatchRouteStopResult,
  SettleStopDto,
} from '../../interfaces/planilla.interface';

/**
 * Settle modal — TOTAL payment only (NO partial / credit / advance).
 *
 * Per the dispatch-route business rule a stop is settled as fully paid or not
 * paid at all. There are NO partial payments, NO credit, and NO advance
 * ("anticipo"). Result options are therefore:
 *
 *   - `delivered`: the order is 100% settled. For a normal customer the cash
 *     collected MUST cover the total. For a **withholding agent** the customer
 *     pays the NET in cash and hands over a withholding certificate
 *     (retefuente / reteiva / reteica); the order is still 100% settled with
 *     NO accounts receivable, so the rule becomes
 *     `collected_amount (cash) + withholding_amount >= total`.
 *   - `rejected`:  customer refused delivery — no cash collected.
 *
 * Withholding capture is shown **only** when the customer is a withholding
 * agent (`customer_is_withholding_agent`). For everyone else the modal stays a
 * clean total-payment flow with no withholding fields. The "Liberar" path lives
 * in its own modal. The payload NEVER carries `result='partial'`,
 * `anticipo_amount`, or `credit_amount`.
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
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="true"
      title="Liquidar Parada"
      size="md"
      (cancel)="close.emit()"
    >
      <div class="space-y-4">
        <!-- Cliente + remisión -->
        <div class="flex items-start gap-3">
          <span
            class="flex h-10 w-10 items-center justify-center rounded-[0.625rem] flex-shrink-0"
            style="color: var(--color-primary); background: rgba(var(--color-primary-rgb, 126, 215, 165), 0.1); border: 1px solid rgba(var(--color-primary-rgb, 126, 215, 165), 0.18);"
          >
            <app-icon name="user" [size]="20"></app-icon>
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-bold text-text-primary truncate">
              {{ customerName() }}
            </p>
            <div class="mt-1 flex flex-wrap items-center gap-2">
              <span
                class="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-text-secondary"
              >
                <app-icon name="file-text" [size]="12"></app-icon>
                {{ dispatchNumber() }}
              </span>
              <span class="text-[11px] text-text-secondary">
                Parada #{{ stop().stop_sequence }}
              </span>
            </div>
          </div>
        </div>

        <!-- Total a cobrar (prominente) -->
        <div class="rounded-xl border border-border bg-surface p-3">
          <span
            class="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-text-secondary"
          >
            Total a cobrar
          </span>
          <span class="font-mono text-xl font-bold text-text-primary">
            {{ grandTotal() | currency }}
          </span>
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

        @if (isWithholdingAgent() && !isPrepaid()) {
          <div
            class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            <strong>Cliente agente retenedor.</strong> El cliente paga el
            <em>neto</em> en efectivo y entrega un certificado de retención
            (retefuente / reteiva / reteica). La orden queda
            <strong>100% saldada</strong> (sin cuenta por cobrar): registra el
            desglose de retención y el efectivo de modo que
            <strong>efectivo + retención = total</strong>.
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
              label="Recaudado (efectivo)"
              [currency]="true"
              [(ngModel)]="collectedAmount"
            ></app-input>
            <app-selector
              label="Método"
              [options]="paymentMethodOptions"
              [(ngModel)]="paymentMethod"
            ></app-selector>
          </div>

          @if (isWithholdingAgent()) {
            <div class="rounded-md border border-border bg-surface p-2 space-y-2">
              <p class="text-xs font-medium text-text-secondary">
                Desglose de retención (la suma se descuenta del total a cobrar
                en efectivo):
              </p>
              <div class="grid grid-cols-3 gap-2">
                <app-input
                  label="Retefuente"
                  [currency]="true"
                  [(ngModel)]="retefuente"
                ></app-input>
                <app-input
                  label="Reteiva"
                  [currency]="true"
                  [(ngModel)]="reteiva"
                ></app-input>
                <app-input
                  label="Reteica"
                  [currency]="true"
                  [(ngModel)]="reteica"
                ></app-input>
              </div>
              <div class="flex justify-between text-xs text-text-secondary">
                <span>Retención total</span>
                <strong class="text-text-primary">{{
                  withholdingTotal() | currency
                }}</strong>
              </div>
            </div>
          }

          @if (!coversTotal()) {
            <div
              class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
            >
              @if (isWithholdingAgent()) {
                Efectivo ({{ collectedAmount | currency }}) + retención ({{
                  withholdingTotal() | currency
                }}) deben cubrir el total ({{ grandTotal() | currency }}). No se
                permiten pagos parciales: completa el desglose y el efectivo, o
                registra la parada como <strong>rechazada</strong>.
              } @else {
                El monto recaudado ({{ collectedAmount | currency }}) debe ser
                igual al total ({{ grandTotal() | currency }}). No se permiten
                pagos parciales: cobra el total o registra la parada como
                <strong>rechazada</strong>.
              }
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

  /**
   * True when the dispatch note's customer is a withholding agent. Sourced
   * from `dispatch_note.customer_is_withholding_agent` (top-level alias) with a
   * fallback to the nested `customer.is_withholding_agent`. Only then does the
   * modal expose the retefuente/reteiva/reteica capture; the backend
   * re-validates the rule on settle (requires a breakdown with sum > 0 for a
   * `delivered` withholding-agent stop).
   */
  readonly isWithholdingAgent = computed(() => {
    const note = this.stop()?.dispatch_note;
    return !!(
      note?.customer_is_withholding_agent ?? note?.customer?.is_withholding_agent
    );
  });

  /** Customer name for the summary header (falls back to a placeholder). */
  readonly customerName = computed<string>(
    () => this.stop()?.dispatch_note?.customer_name || '(Cliente)',
  );

  /** Dispatch-note number shown as a chip in the summary header. */
  readonly dispatchNumber = computed<string>(
    () => this.stop()?.dispatch_note?.dispatch_number || '—',
  );

  readonly close = output<void>();
  readonly submitted = output<SettleStopDto>();

  /**
   * Only TWO outcomes are allowed: full delivery (cobro total) or rejection.
   * "Partial" was removed entirely — half/credit/advance payments are not a
   * supported flow on a dispatch route. A withholding agent is still a FULL
   * delivery: cash + withholding certificate together cover the total.
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

  /** Withholding breakdown fields (only used for withholding agents). */
  private _retefuente = 0;
  get retefuente(): number {
    return this._retefuente;
  }
  set retefuente(value: number) {
    this._retefuente = value;
    this.retefuenteSig.set(Number(value) || 0);
  }

  private _reteiva = 0;
  get reteiva(): number {
    return this._reteiva;
  }
  set reteiva(value: number) {
    this._reteiva = value;
    this.reteivaSig.set(Number(value) || 0);
  }

  private _reteica = 0;
  get reteica(): number {
    return this._reteica;
  }
  set reteica(value: number) {
    this._reteica = value;
    this.reteicaSig.set(Number(value) || 0);
  }

  paymentMethod = 'cash';
  readonly submitting = signal(false);

  // Signal mirrors so templates/computed react in the zoneless runtime.
  private readonly resultSig = signal<DispatchRouteStopResult>('delivered');
  private readonly collectedSig = signal(0);
  private readonly retefuenteSig = signal(0);
  private readonly reteivaSig = signal(0);
  private readonly reteicaSig = signal(0);

  readonly isDelivered = computed(() => this.resultSig() === 'delivered');
  readonly isRejected = computed(() => this.resultSig() === 'rejected');

  /** Sum of the withholding breakdown = `withholding_amount` sent to the backend. */
  readonly withholdingTotal = computed(
    () => this.retefuenteSig() + this.reteivaSig() + this.reteicaSig(),
  );

  /**
   * Whether cash + withholding fully covers the total. Prepaid stops cover the
   * total by definition (collection happened before dispatch). For a normal
   * customer withholding is always 0, so this reduces to "cash >= total".
   */
  readonly coversTotal = computed(() => {
    if (this.isPrepaid()) return true;
    const total = Number(this.grandTotal()) || 0;
    const withholding = this.isWithholdingAgent() ? this.withholdingTotal() : 0;
    return (this.collectedSig() || 0) + withholding >= total;
  });

  /**
   * Confirm is allowed when the stop is rejected, or when it is delivered with
   * cash + withholding that covers the total. For a withholding agent the
   * breakdown sum must additionally be > 0 (backend hard requirement).
   * Never with a partial amount.
   */
  readonly canConfirm = computed(() => {
    if (this.isRejected()) return true;
    if (this.isPrepaid()) return true;
    if (!this.isDelivered()) return false;
    if (this.isWithholdingAgent() && this.withholdingTotal() <= 0) return false;
    return this.coversTotal();
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
    // must cover the full total (guarded by canConfirm). Withholding agents
    // settle the order 100% via cash + withholding certificate (no AR).
    const dto: SettleStopDto = {
      result: 'delivered',
      collected_amount: this.isPrepaid() ? 0 : Number(this.collectedAmount) || 0,
      change_amount: 0,
      payment_method: this.isPrepaid() ? 'prepaid' : this.paymentMethod,
    };

    if (this.isWithholdingAgent() && !this.isPrepaid()) {
      const breakdown: { retefuente?: number; reteiva?: number; reteica?: number } = {};
      if (this.retefuenteSig() > 0) breakdown.retefuente = this.retefuenteSig();
      if (this.reteivaSig() > 0) breakdown.reteiva = this.reteivaSig();
      if (this.reteicaSig() > 0) breakdown.reteica = this.reteicaSig();
      dto.withholding_breakdown = breakdown;
      dto.withholding_amount = this.withholdingTotal();
    }

    this.submitted.emit(dto);
  }
}
