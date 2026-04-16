import {
  Component,
  input,
  output,
  effect,
  untracked,
  inject,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import {
  ButtonComponent,
  ModalComponent,
  InputComponent,
  IconComponent,
} from '../../../../../shared/components';
import { CurrencyPipe } from '../../../../../shared/pipes/currency';
import {
  PosCashRegisterService,
  CashRegisterSession,
  CashRegisterMovement,
} from '../services/pos-cash-register.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

@Component({
  selector: 'app-pos-session-close-modal',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    ButtonComponent,
    ModalComponent,
    InputComponent,
    IconComponent,
    CurrencyPipe,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      [showCloseButton]="true"
    >
      <!-- Header -->
      <div slot="header" class="flex items-center gap-3">
        <div
          class="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center"
        >
          <app-icon name="lock" [size]="20" class="text-destructive"></app-icon>
        </div>
        <div>
          <h2 class="text-lg font-semibold text-text-primary">Cerrar Caja</h2>
          <p class="text-sm text-text-secondary">
            {{ session()?.register?.name || 'Caja' }} — Abierta
            {{ session()?.opened_at | date : 'shortTime' }}
          </p>
        </div>
      </div>

      <!-- Body -->
      <div class="space-y-5">
        <!-- Session summary cards -->
        @if (session()) {
          <div class="grid grid-cols-2 gap-3">
            <div
              class="bg-primary/5 border border-primary/20 p-3 rounded-xl text-center"
            >
              <p
                class="text-[10px] font-medium text-text-secondary uppercase tracking-wider mb-1"
              >
                Monto Apertura
              </p>
              <p class="text-xl font-bold text-text-primary">
                {{ session()!.opening_amount | currency:0 }}
              </p>
            </div>
            <div
              class="bg-primary/5 border border-primary/20 p-3 rounded-xl text-center"
            >
              <p
                class="text-[10px] font-medium text-text-secondary uppercase tracking-wider mb-1"
              >
                Cajero
              </p>
              <p class="text-xl font-bold text-text-primary">
                {{ session()!.opened_by_user?.first_name }}
                {{ session()!.opened_by_user?.last_name }}
              </p>
            </div>
          </div>
        }

        <!-- Movements Summary -->
        @if (movementsSummary) {
          <div class="border border-border rounded-xl p-4 space-y-2">
            <p class="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
              Resumen de Movimientos
            </p>
            <div class="space-y-1.5 text-sm">
              <div class="flex justify-between">
                <span class="text-text-secondary">Apertura</span>
                <span class="font-medium text-text-primary">{{ movementsSummary.opening | currency:0 }}</span>
              </div>

              @if (movementsSummary.salesByMethod.length > 0) {
                <p class="text-[10px] font-semibold text-text-secondary uppercase tracking-wider pt-1">Ventas por metodo</p>
                @for (entry of movementsSummary.salesByMethod; track entry.method) {
                  <div class="flex justify-between">
                    <span [class]="entry.method === 'cash' ? 'text-green-600' : 'text-slate-500'">
                      + {{ entry.label }} ({{ entry.count }})
                    </span>
                    <span class="font-medium" [class]="entry.method === 'cash' ? 'text-green-600' : 'text-slate-500'">
                      {{ entry.total | currency:0 }}
                    </span>
                  </div>
                }
              }

              @if (movementsSummary.cashIn > 0) {
                <div class="flex justify-between">
                  <span class="text-blue-600">+ Entradas de efectivo</span>
                  <span class="font-medium text-blue-600">{{ movementsSummary.cashIn | currency:0 }}</span>
                </div>
              }
              @if (movementsSummary.cashRefunds > 0) {
                <div class="flex justify-between">
                  <span class="text-red-600">- Reembolsos (efectivo)</span>
                  <span class="font-medium text-red-600">{{ movementsSummary.cashRefunds | currency:0 }}</span>
                </div>
              }
              @if (movementsSummary.cashOut > 0) {
                <div class="flex justify-between">
                  <span class="text-amber-600">- Salidas de efectivo</span>
                  <span class="font-medium text-amber-600">{{ movementsSummary.cashOut | currency:0 }}</span>
                </div>
              }
              <div class="border-t border-border pt-2 flex justify-between">
                <span class="font-semibold text-text-primary">Efectivo Esperado en Caja</span>
                <span class="font-bold text-text-primary">{{ movementsSummary.expectedCashTotal | currency:0 }}</span>
              </div>
              @if (movementsSummary.nonCashTotal > 0) {
                <div class="flex justify-between text-xs pt-1">
                  <span class="text-text-secondary">Ventas por otros medios</span>
                  <span class="text-text-secondary">{{ movementsSummary.nonCashTotal | currency:0 }}</span>
                </div>
              }
            </div>
          </div>
        }

        <!-- Form -->
        <form [formGroup]="form" class="space-y-4">
          <app-input
            formControlName="actual_closing_amount"
            label="Conteo Real de Efectivo"
            placeholder="0.00"
            [currency]="true"
            [size]="'md'"
            [required]="true"
            [prefixIcon]="true"
            [error]="getFieldError('actual_closing_amount')"
            (inputBlur)="onFieldBlur('actual_closing_amount')"
          ></app-input>

          <app-input
            formControlName="closing_notes"
            label="Notas de Cierre"
            placeholder="Observaciones del cierre..."
            type="text"
            [size]="'md'"
            helperText="Opcional — novedades del turno, faltantes, etc."
          ></app-input>
        </form>

        <!-- Difference indicator (shown after closing) -->
        @if (difference !== null) {
          <div
            class="p-4 rounded-xl flex items-center gap-3 border"
            [class]="
              difference >= 0
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'bg-red-50 text-red-700 border-red-200'
            "
          >
            <div
              class="w-9 h-9 rounded-full flex items-center justify-center"
              [class]="difference >= 0 ? 'bg-green-100' : 'bg-red-100'"
            >
              <app-icon
                [name]="difference >= 0 ? 'trending-up' : 'trending-down'"
                [size]="18"
              ></app-icon>
            </div>
            <div>
              <p class="text-xs font-medium opacity-70">
                {{ difference >= 0 ? 'Sobrante' : 'Faltante' }}
              </p>
              <p class="text-lg font-bold">
                {{ (difference >= 0 ? difference : -difference) | currency:0 }}
              </p>
            </div>
          </div>
        }
      </div>

      <!-- Footer -->
      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="secondary" size="md" (clicked)="onCancel()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          size="md"
          (clicked)="onClose()"
          [disabled]="!form.valid || submitting"
        >
          <app-icon name="lock" [size]="16" slot="icon"></app-icon>
          @if (submitting) {
            Cerrando...
          } @else {
            Cerrar Caja
          }
        </app-button>
      </div>
    </app-modal>
  `,
})
export class PosSessionCloseModalComponent {
  readonly isOpen = input<boolean>(false);
  readonly session = input<CashRegisterSession | null>(null);
  readonly isOpenChange = output<boolean>();
  readonly sessionClosed = output<any>();

  submitting = false;
  difference: number | null = null;
  movementsSummary: {
    opening: number;
    sales: number;
    salesCount: number;
    salesByMethod: { method: string; label: string; count: number; total: number }[];
    cashSales: number;
    refunds: number;
    cashRefunds: number;
    cashIn: number;
    cashOut: number;
    expectedCashTotal: number;
    nonCashTotal: number;
  } | null = null;

  form: FormGroup;

  private fb = inject(FormBuilder);
  private cashRegisterService = inject(PosCashRegisterService);
  private toastService = inject(ToastService);

  constructor() {
    this.form = this.fb.group({
      actual_closing_amount: [0, [Validators.required, Validators.min(0)]],
      closing_notes: [''],
    });

    effect(() => {
      if (this.isOpen()) {
        untracked(() => {
          this.difference = null;
          this.movementsSummary = null;
          this.form.reset({ actual_closing_amount: 0, closing_notes: '' });
          this.loadMovementsSummary();
        });
      }
    });
  }

  private loadMovementsSummary(): void {
    if (!this.session()) return;

    const methodLabels: Record<string, string> = {
      cash: 'Efectivo',
      card: 'Tarjeta',
      bank_transfer: 'Transferencia',
      voucher: 'Voucher',
      wompi: 'Wompi',
      wallet: 'Wallet',
      paypal: 'PayPal',
    };

    this.cashRegisterService.getMovements(this.session()!.id).subscribe({
      next: (movements) => {
        const opening = movements
          .filter((m) => m.type === 'opening_balance')
          .reduce((s, m) => s + Number(m.amount), 0);

        const sales = movements.filter((m) => m.type === 'sale');
        const salesTotal = sales.reduce((s, m) => s + Number(m.amount), 0);

        // Group sales by payment method
        const salesMap = new Map<string, { count: number; total: number }>();
        for (const sale of sales) {
          const method = sale.payment_method || 'cash';
          const entry = salesMap.get(method) || { count: 0, total: 0 };
          entry.count++;
          entry.total += Number(sale.amount);
          salesMap.set(method, entry);
        }
        const salesByMethod = Array.from(salesMap.entries())
          .map(([method, data]) => ({
            method,
            label: methodLabels[method] || method,
            count: data.count,
            total: data.total,
          }))
          .sort((a, b) => {
            if (a.method === 'cash') return -1;
            if (b.method === 'cash') return 1;
            return a.label.localeCompare(b.label);
          });

        const cashSales = salesMap.get('cash')?.total || 0;

        const refunds = movements
          .filter((m) => m.type === 'refund')
          .reduce((s, m) => s + Number(m.amount), 0);
        const cashRefunds = movements
          .filter((m) => m.type === 'refund' && m.payment_method === 'cash')
          .reduce((s, m) => s + Number(m.amount), 0);
        const cashIn = movements
          .filter((m) => m.type === 'cash_in')
          .reduce((s, m) => s + Number(m.amount), 0);
        const cashOut = movements
          .filter((m) => m.type === 'cash_out')
          .reduce((s, m) => s + Number(m.amount), 0);

        this.movementsSummary = {
          opening,
          sales: salesTotal,
          salesCount: sales.length,
          salesByMethod,
          cashSales,
          refunds,
          cashRefunds,
          cashIn,
          cashOut,
          expectedCashTotal: opening + cashSales + cashIn - cashRefunds - cashOut,
          nonCashTotal: salesTotal - cashSales,
        };
      },
      error: () => {
        this.movementsSummary = null;
      },
    });
  }

  getFieldError(fieldName: string): string | undefined {
    const field = this.form.get(fieldName);
    if (field && field.errors && field.touched) {
      if (field.errors['required']) return 'Este campo es requerido';
      if (field.errors['min']) return 'El monto no puede ser negativo';
    }
    return undefined;
  }

  onFieldBlur(fieldName: string): void {
    this.form.get(fieldName)?.markAsTouched();
  }

  onClose() {
    if (!this.form.valid || !this.session()) return;
    this.submitting = true;

    const { actual_closing_amount, closing_notes } = this.form.value;

    this.cashRegisterService
      .closeSession(this.session()!.id, actual_closing_amount, closing_notes)
      .subscribe({
        next: (closedSession) => {
          this.submitting = false;
          this.difference = Number(closedSession.difference || 0);
          this.toastService.success('Caja cerrada correctamente');
          this.sessionClosed.emit(closedSession);
          this.isOpenChange.emit(false);
        },
        error: (err) => {
          this.submitting = false;
          this.toastService.error(
            err.error?.message || 'Error al cerrar la caja',
          );
        },
      });
  }

  onCancel() {
    this.isOpenChange.emit(false);
  }
}
