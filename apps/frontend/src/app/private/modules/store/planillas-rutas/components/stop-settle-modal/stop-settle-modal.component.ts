import { Component, computed, input, output, signal } from '@angular/core';
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
      result: this.result,
      collected_amount: Number(this.collectedAmount) || 0,
      withholding_amount: Number(this.withholdingAmount) || 0,
      change_amount: Number(this.changeAmount) || 0,
      payment_method: this.paymentMethod,
    };
    if (this.withholdingAmount > 0) {
      dto.withholding_breakdown = { retefuente: Number(this.withholdingAmount) };
    }
    this.submitted.emit(dto);
  }
}
