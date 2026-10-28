import { Component, OnInit, computed, effect, input, output, signal } from "@angular/core";
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
 * Settle modal. Asks only for what is really owed (`pending_amount`), once.
 *
 *   - Paid stop (prepaid / pending 0): no amount input; shows the remisión value
 *     with a «Pagada» badge; "Entregada" sends collected 0.
 *   - COD / free credit: collected + withholding must EQUAL the pending amount
 *     (prefilled with it).
 *   - Installments credit: any collection from 0 up to the pending amount; the
 *     rest stays in accounts receivable.
 *   - `rejected`: no collection.
 * Withholding capture only for withholding agents. The payload never carries
 * `result='partial'`, `anticipo_amount` or `credit_amount`.
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

        <!-- Valor de la remisión / monto a recaudar -->
        <div class="rounded-xl border border-border bg-surface p-3">
          @if (isPaid()) {
            <div class="flex items-center justify-between gap-2">
              <div>
                <span
                  class="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-text-secondary"
                >
                  Valor de la remisión
                </span>
                <span class="font-mono text-xl font-bold text-text-primary">
                  {{ grandTotal() | currency }}
                </span>
              </div>
              <span
                class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800"
              >
                <app-icon name="check" [size]="12"></app-icon>
                Pagada
              </span>
            </div>
            <p class="mt-2 text-xs text-text-secondary">
              Esta orden ya está pagada: no hay nada que recaudar. Solo confirma
              la entrega.
            </p>
          } @else {
            <span
              class="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-text-secondary"
            >
              A recaudar
            </span>
            <span class="font-mono text-xl font-bold text-text-primary">
              {{ pending() | currency }}
            </span>
            @if (pending() < grandTotalNum()) {
              <p class="mt-1 text-xs text-text-secondary">
                Valor de la remisión {{ grandTotal() | currency }}; ya se abonó
                {{ grandTotalNum() - pending() | currency }}.
              </p>
            }
          }
        </div>

        @if (isWithholdingAgent() && !isPaid()) {
          <div
            class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            <strong>Cliente agente retenedor.</strong> El cliente paga el
            <em>neto</em> y entrega un certificado de retención (retefuente /
            reteiva / reteica). Registra el desglose: el efectivo se ajusta
            solo para que <strong>efectivo + retención = a recaudar</strong>.
          </div>
        }

        <app-selector
          label="Resultado"
          [options]="resultOptions"
          [(ngModel)]="result"
        ></app-selector>

        @if (isDelivered() && !isPaid()) {
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

          @if (isInstallments()) {
            @if (overCollected()) {
              <div
                class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
              >
                El recaudo ({{ collectedAmount | currency }}) no puede superar
                lo que se debe ({{ pending() | currency }}).
              </div>
            } @else if (balanceLeft() > 0) {
              <div
                class="rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-secondary"
              >
                Saldo quedará en cartera:
                <strong class="text-text-primary">{{
                  balanceLeft() | currency
                }}</strong>
              </div>
            }
          } @else if (!coversTotal()) {
            <div
              class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
            >
              @if (isWithholdingAgent()) {
                Efectivo ({{ collectedAmount | currency }}) + retención ({{
                  withholdingTotal() | currency
                }}) debe ser igual a lo que se debe ({{ pending() | currency }}).
              } @else {
                El monto recaudado ({{ collectedAmount | currency }}) debe ser
                igual a lo que se debe ({{ pending() | currency }}). Cobra ese
                monto o registra la parada como <strong>rechazada</strong>.
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
          [disabled]="inFlight() || busy() || !canConfirm()"
          class="flex-1 rounded-md bg-primary-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {{ inFlight() || busy() ? 'Guardando...' : 'Confirmar' }}
        </button>
      </div>
    </app-modal>
  `,
})
export class StopSettleModalComponent implements OnInit {
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
   * Live amount still owed (backend `pending_amount`). When absent the modal
   * falls back to the remisión total (or 0 when prepaid).
   */
  readonly pendingAmount = input<number | null | undefined>(null);

  /** Parent request in flight: locks the confirm button (no double submit). */
  readonly busy = input<boolean>(false);

  readonly grandTotalNum = computed(() => Number(this.grandTotal()) || 0);

  /** What is still owed, in currency units, rounded to cents. */
  readonly pending = computed(() => {
    const p = this.pendingAmount();
    const base = p == null ? (this.isPrepaid() ? 0 : this.grandTotalNum()) : Number(p) || 0;
    return Math.max(Math.round(base * 100) / 100, 0);
  });

  /** Nothing left to collect: paid (prepaid) or zero pending. */
  readonly isPaid = computed(() => this.isPrepaid() || this.pending() <= 0);

  /**
   * Installments credit may be delivered with a partial (even 0) collection;
   * the balance stays in accounts receivable. Needs `order.payment_form` and
   * `order.credit_type` on the stop's dispatch note.
   */
  readonly isInstallments = computed(() => {
    const order = this.stop()?.dispatch_note?.order;
    return order?.payment_form === '2' && order?.credit_type === 'installments';
  });

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

  constructor() {
    // Unlock the confirm button once the parent request finishes (error path).
    effect(() => {
      if (!this.busy()) this.inFlight.set(false);
    });
  }

  ngOnInit(): void {
    // Prefill the collection with what is really owed (not the remisión total).
    if (!this.isPaid()) this.applyCollected(this.pending());
  }

  private collectedTouched = false;

  private applyCollected(value: number): void {
    const v = Math.max(Math.round(value * 100) / 100, 0);
    this._collectedAmount = v;
    this.collectedSig.set(v);
  }

  /** Keep cash = pending - withholding until the operator edits cash by hand. */
  private syncAutoCollected(): void {
    if (this.collectedTouched || !this.isWithholdingAgent()) return;
    this.applyCollected(this.pending() - this.withholdingTotal());
  }

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
    this.collectedTouched = true;
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
    this.syncAutoCollected();
  }

  private _reteiva = 0;
  get reteiva(): number {
    return this._reteiva;
  }
  set reteiva(value: number) {
    this._reteiva = value;
    this.reteivaSig.set(Number(value) || 0);
    this.syncAutoCollected();
  }

  private _reteica = 0;
  get reteica(): number {
    return this._reteica;
  }
  set reteica(value: number) {
    this._reteica = value;
    this.reteicaSig.set(Number(value) || 0);
    this.syncAutoCollected();
  }

  paymentMethod = 'cash';
  readonly inFlight = signal(false);

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

  private readonly toCents = (v: number) => Math.round((Number(v) || 0) * 100);

  private readonly paidSoFar = computed(
    () =>
      (this.collectedSig() || 0) +
      (this.isWithholdingAgent() ? this.withholdingTotal() : 0),
  );

  /**
   * COD / free credit: cash + withholding must EQUAL what is owed (compared in
   * integer cents, like the backend). Paid stops need nothing.
   */
  readonly coversTotal = computed(() => {
    if (this.isPaid()) return true;
    return this.toCents(this.paidSoFar()) === this.toCents(this.pending());
  });

  /** Installments credit: collected + withholding above the debt. */
  readonly overCollected = computed(
    () => this.toCents(this.paidSoFar()) > this.toCents(this.pending()),
  );

  /** Installments credit: balance that stays in accounts receivable. */
  readonly balanceLeft = computed(() =>
    Math.max(this.pending() - this.paidSoFar(), 0),
  );

  /**
   * Confirm is allowed when the stop is rejected; when it is paid (collected
   * 0); for installments credit with 0 <= paid <= pending; otherwise only when
   * cash + withholding equals what is owed. A withholding agent additionally
   * needs a breakdown sum > 0 (backend requirement).
   */
  readonly canConfirm = computed(() => {
    if (this.isRejected()) return true;
    if (!this.isDelivered()) return false;
    if (this.isPaid()) return true;
    if (this.isWithholdingAgent() && this.withholdingTotal() <= 0) return false;
    if (this.isInstallments()) return !this.overCollected();
    return this.coversTotal();
  });

  submit() {
    if (!this.canConfirm() || this.inFlight() || this.busy()) return;
    this.inFlight.set(true);

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
      collected_amount: this.isPaid() ? 0 : Number(this.collectedAmount) || 0,
      change_amount: 0,
      payment_method: this.isPaid() ? 'prepaid' : this.paymentMethod,
    };

    if (this.isWithholdingAgent() && !this.isPaid()) {
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
