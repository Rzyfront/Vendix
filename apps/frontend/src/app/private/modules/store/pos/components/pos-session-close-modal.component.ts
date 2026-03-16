import {
  Component,
  EventEmitter,
  Input,
  Output,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
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
    CommonModule,
    ReactiveFormsModule,
    ButtonComponent,
    ModalComponent,
    InputComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
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
            {{ session?.register?.name || 'Caja' }} — Abierta
            {{ session?.opened_at | date : 'shortTime' }}
          </p>
        </div>
      </div>

      <!-- Body -->
      <div class="space-y-5">
        <!-- Session summary cards -->
        @if (session) {
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
                {{ '$' }}{{ session.opening_amount | number : '1.0-0' }}
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
                {{ session.opened_by_user?.first_name }}
                {{ session.opened_by_user?.last_name }}
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
                <span class="font-medium text-text-primary">{{ '$' }}{{ movementsSummary.opening | number:'1.0-0' }}</span>
              </div>
              @if (movementsSummary.sales > 0) {
                <div class="flex justify-between">
                  <span class="text-green-600">+ Ventas ({{ movementsSummary.salesCount }})</span>
                  <span class="font-medium text-green-600">{{ '$' }}{{ movementsSummary.sales | number:'1.0-0' }}</span>
                </div>
              }
              @if (movementsSummary.cashIn > 0) {
                <div class="flex justify-between">
                  <span class="text-blue-600">+ Entradas</span>
                  <span class="font-medium text-blue-600">{{ '$' }}{{ movementsSummary.cashIn | number:'1.0-0' }}</span>
                </div>
              }
              @if (movementsSummary.refunds > 0) {
                <div class="flex justify-between">
                  <span class="text-red-600">- Reembolsos</span>
                  <span class="font-medium text-red-600">{{ '$' }}{{ movementsSummary.refunds | number:'1.0-0' }}</span>
                </div>
              }
              @if (movementsSummary.cashOut > 0) {
                <div class="flex justify-between">
                  <span class="text-amber-600">- Salidas</span>
                  <span class="font-medium text-amber-600">{{ '$' }}{{ movementsSummary.cashOut | number:'1.0-0' }}</span>
                </div>
              }
              <div class="border-t border-border pt-2 flex justify-between">
                <span class="font-semibold text-text-primary">Efectivo Esperado</span>
                <span class="font-bold text-text-primary">{{ '$' }}{{ movementsSummary.expectedTotal | number:'1.0-0' }}</span>
              </div>
            </div>
          </div>
        }

        <!-- Form -->
        <form [formGroup]="form" class="space-y-4">
          <app-input
            formControlName="actual_closing_amount"
            label="Conteo Real de Efectivo"
            placeholder="0.00"
            type="number"
            [size]="'md'"
            [required]="true"
            [min]="0"
            step="100"
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
                {{ '$' }}{{
                  (difference >= 0 ? difference : -difference)
                    | number : '1.0-0'
                }}
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
export class PosSessionCloseModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() session: CashRegisterSession | null = null;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() sessionClosed = new EventEmitter<any>();

  submitting = false;
  difference: number | null = null;
  movementsSummary: {
    opening: number;
    sales: number;
    salesCount: number;
    refunds: number;
    cashIn: number;
    cashOut: number;
    expectedTotal: number;
  } | null = null;

  form: FormGroup;

  constructor(
    private fb: FormBuilder,
    private cashRegisterService: PosCashRegisterService,
    private toastService: ToastService,
  ) {
    this.form = this.fb.group({
      actual_closing_amount: [0, [Validators.required, Validators.min(0)]],
      closing_notes: [''],
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['isOpen'] && this.isOpen) {
      this.difference = null;
      this.movementsSummary = null;
      this.form.reset({ actual_closing_amount: 0, closing_notes: '' });
      this.loadMovementsSummary();
    }
  }

  private loadMovementsSummary(): void {
    if (!this.session) return;

    this.cashRegisterService.getMovements(this.session.id).subscribe({
      next: (movements) => {
        const opening = movements
          .filter((m) => m.type === 'opening_balance')
          .reduce((s, m) => s + Number(m.amount), 0);
        const sales = movements.filter((m) => m.type === 'sale');
        const salesTotal = sales.reduce((s, m) => s + Number(m.amount), 0);
        const refunds = movements
          .filter((m) => m.type === 'refund')
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
          refunds,
          cashIn,
          cashOut,
          expectedTotal: opening + salesTotal + cashIn - refunds - cashOut,
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
    if (!this.form.valid || !this.session) return;
    this.submitting = true;

    const { actual_closing_amount, closing_notes } = this.form.value;

    this.cashRegisterService
      .closeSession(this.session.id, actual_closing_amount, closing_notes)
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
