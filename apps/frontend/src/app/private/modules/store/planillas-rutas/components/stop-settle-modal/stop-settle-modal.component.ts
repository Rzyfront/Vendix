import { Component, computed, effect, input, output, signal } from "@angular/core";
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

        <div class="grid grid-cols-2 gap-2">
          <app-input
            label="Recaudado"
            [currency]="true"
            [(ngModel)]="collectedAmount"
            (inputChange)="recalcCredit()"
            [disabled]="isPrepaid()"
          ></app-input>
          <app-input
            label="Retención"
            [currency]="true"
            [(ngModel)]="withholdingAmount"
            (inputChange)="recalcCredit()"
          ></app-input>
          <app-input
            label="Cambio"
            [currency]="true"
            [(ngModel)]="changeAmount"
          ></app-input>
          <app-selector
            label="Método"
            [options]="paymentMethodOptions"
            [(ngModel)]="paymentMethod"
            [disabled]="isPrepaid()"
          ></app-selector>
        </div>

        @if (computedCredit() > 0) {
          <div class="text-xs text-yellow-700 bg-yellow-50 p-2 rounded">
            Saldo a crédito (calculado):
            <strong>{{ computedCredit() | currency }}</strong>
          </div>
        }

        <div class="text-xs text-text-secondary">
          <strong>Tip:</strong> Si el cliente es agente retenedor, registra el
          valor en "Retención".
        </div>
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
          [disabled]="submitting()"
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
   * that case; the modal surfaces a banner and disables the collected/method
   * fields so the operator does not enter a value that will be discarded.
   */
  readonly isPrepaid = input<boolean>(false);

  readonly close = output<void>();
  readonly submitted = output<SettleStopDto>();

  readonly resultOptions: SelectorOption[] = [
    { value: 'delivered', label: 'Entregada y cobrada' },
    { value: 'partial', label: 'Parcial (crédito y/o retención)' },
    { value: 'rejected', label: 'Rechazada' },
  ];

  readonly paymentMethodOptions: SelectorOption[] = [
    { value: 'cash', label: 'Efectivo' },
    { value: 'transfer', label: 'Transferencia' },
    { value: 'card', label: 'Tarjeta' },
  ];

  result: DispatchRouteStopResult = 'delivered';
  collectedAmount = 0;
  withholdingAmount = 0;
  changeAmount = 0;
  paymentMethod = 'cash';
  readonly submitting = signal(false);

  readonly computedCredit = signal(0);

  constructor() {
    // Recalculate the credit projection whenever the modal opens or the
    // grand-total input changes. Without this, the operator would see a
    // stale `0` until they edited the collected/withholding fields.
    effect(() => {
      this.grandTotal();
      this.recalcCredit();
    });
  }

  recalcCredit() {
    const net = Number(this.grandTotal()) || 0;
    const credit = Math.max(
      0,
      net - (Number(this.collectedAmount) || 0) - (Number(this.withholdingAmount) || 0),
    );
    this.computedCredit.set(credit);
  }

  submit() {
    this.submitting.set(true);
    const dto: SettleStopDto = {
      // Prepaid stops are always reported as fully delivered with no
      // cash collection; the result dropdown is hidden in that case but
      // we keep the same field for safety.
      result: this.isPrepaid() ? 'delivered' : this.result,
      collected_amount: this.isPrepaid() ? 0 : Number(this.collectedAmount) || 0,
      withholding_amount: Number(this.withholdingAmount) || 0,
      change_amount: Number(this.changeAmount) || 0,
      payment_method: this.isPrepaid() ? 'prepaid' : this.paymentMethod,
    };
    if (this.withholdingAmount > 0) {
      dto.withholding_breakdown = { retefuente: Number(this.withholdingAmount) };
    }
    this.submitted.emit(dto);
  }
}
