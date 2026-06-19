import {
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlanillasRutasService } from '../../services/planillas-rutas.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  DispatchRouteStop,
  DispatchRouteStopResult,
  SettleStopDto,
} from '../../interfaces/planilla.interface';

@Component({
  selector: 'app-stop-settle-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div
      class="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center"
      (click)="close.emit()"
    >
      <div
        class="bg-background rounded-t-2xl md:rounded-2xl w-full md:max-w-md p-4 space-y-3"
        (click)="$event.stopPropagation()"
      >
        <h2 class="text-lg font-semibold">Liquidar Parada</h2>
        <div class="text-sm text-muted-foreground">
          Remisión: <strong>{{ stop.dispatch_note?.dispatch_number }}</strong><br />
          Cliente: {{ stop.dispatch_note?.customer_name }}<br />
          Total: <strong>{{ grandTotal | currency: 'COP' : 'symbol' : '1.0-0' }}</strong>
        </div>

        <div>
          <label class="block text-sm font-medium mb-1">Resultado</label>
          <select
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            [(ngModel)]="result"
          >
            <option value="delivered">Entregada y cobrada</option>
            <option value="partial">Parcial (crédito y/o retención)</option>
            <option value="rejected">Rechazada</option>
          </select>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-xs font-medium mb-1">Recaudado</label>
            <input
              type="number"
              class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              [(ngModel)]="collectedAmount"
              (input)="recalcCredit()"
              min="0"
            />
          </div>
          <div>
            <label class="block text-xs font-medium mb-1">Retención</label>
            <input
              type="number"
              class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              [(ngModel)]="withholdingAmount"
              (input)="recalcCredit()"
              min="0"
            />
          </div>
          <div>
            <label class="block text-xs font-medium mb-1">Cambio</label>
            <input
              type="number"
              class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              [(ngModel)]="changeAmount"
              min="0"
            />
          </div>
          <div>
            <label class="block text-xs font-medium mb-1">Método</label>
            <select
              class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              [(ngModel)]="paymentMethod"
            >
              <option value="cash">Efectivo</option>
              <option value="transfer">Transferencia</option>
              <option value="card">Tarjeta</option>
            </select>
          </div>
        </div>

        @if (computedCredit() > 0) {
          <div class="text-xs text-yellow-700 bg-yellow-50 p-2 rounded">
            Saldo a crédito (calculado): <strong>{{ computedCredit() | currency: 'COP' : 'symbol' : '1.0-0' }}</strong>
          </div>
        }

        <div class="text-xs text-muted-foreground">
          <strong>Tip:</strong> Si el cliente es agente retenedor, registra el valor en "Retención".
        </div>

        <div class="flex gap-2 pt-2">
          <button
            (click)="close.emit()"
            class="flex-1 rounded-md border border-input bg-background px-4 py-2 text-sm"
          >Cancelar</button>
          <button
            (click)="submit()"
            [disabled]="submitting()"
            class="flex-1 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
          >
            {{ submitting() ? 'Guardando...' : 'Confirmar' }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class StopSettleModalComponent {
  @Input({ required: true }) stop!: DispatchRouteStop;
  @Input({ required: true }) grandTotal!: number;

  @Output() close = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<SettleStopDto>();

  private readonly service = inject(PlanillasRutasService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  result: DispatchRouteStopResult = 'delivered';
  collectedAmount = 0;
  withholdingAmount = 0;
  changeAmount = 0;
  paymentMethod = 'cash';
  submitting = signal(false);

  computedCredit = signal(0);

  recalcCredit() {
    const net = Number(this.grandTotal) || 0;
    const credit = Math.max(0, net - (Number(this.collectedAmount) || 0) - (Number(this.withholdingAmount) || 0));
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
