import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  ToastService,
} from '../../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { extractApiErrorMessage } from '../../../../../../../core/utils/api-error-handler';
import { ReservationsService } from '../../../services/reservations.service';
import {
  Booking,
  BookingDeposit,
  DepositDecisionAction,
  DepositDecisionInput,
  DepositRefundMethod,
} from '../../../interfaces/reservation.interface';

type DialogView = 'cancel' | 'decide';

interface DecisionOption {
  value: DepositDecisionAction;
  label: string;
  hint: string;
  icon: string;
}

/**
 * Deposit dialog of a booking (S17). `cancel` asks "¿Devolver o dejar saldo a favor?" before cancelling;
 * `decide` is the administrator's decision for a deposit that was paid (retain, reschedule, refund, credit).
 * Every money movement is an explicit choice here: nothing is charged or closed on its own (D4).
 */
@Component({
  selector: 'app-booking-deposit-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ModalComponent, ButtonComponent, IconComponent, InputComponent, SelectorComponent, CurrencyPipe],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="$event ? null : closed.emit()"
      (opened)="onOpen()"
      [dialog]="true"
      [title]="view() === 'cancel' ? 'Cancelar reserva' : 'Decidir anticipo'"
      [subtitle]="'Reserva #' + (booking()?.booking_number ?? '')"
      size="md"
    >
      @if (deposit(); as dep) {
        <div class="space-y-4">
          <div class="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <span class="text-sm text-[var(--color-text-secondary)]">Anticipo disponible</span>
            <strong class="text-base text-[var(--color-text-primary)]">{{ dep.balance | currency }}</strong>
          </div>

          @if (view() === 'cancel') {
            <p class="text-sm text-[var(--color-text-primary)]">¿Devolver o dejar saldo a favor?</p>
          }

          <div class="grid gap-2" role="radiogroup" aria-label="Qué pasa con el anticipo">
            @for (option of options(); track option.value) {
              <button
                type="button"
                role="radio"
                [attr.aria-checked]="action() === option.value"
                class="flex items-start gap-3 rounded-xl border p-3 text-left transition-colors"
                [class]="action() === option.value
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
                  : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/50'"
                (click)="action.set(option.value)"
              >
                <app-icon [name]="option.icon" [size]="18" class="mt-0.5 text-[var(--color-primary)]"></app-icon>
                <span class="flex flex-col">
                  <span class="text-sm font-semibold text-[var(--color-text-primary)]">{{ option.label }}</span>
                  <span class="text-xs text-[var(--color-text-secondary)]">{{ option.hint }}</span>
                </span>
              </button>
            }
          </div>

          @if (action() === 'refund') {
            <app-selector
              label="Medio de devolución"
              [ngModel]="refundMethod()"
              (ngModelChange)="refundMethod.set($event)"
              [options]="refundMethodOptions"
            ></app-selector>
          }

          @if (action() === 'reschedule') {
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <app-input label="Nueva fecha" type="date" [ngModel]="newDate()" (ngModelChange)="newDate.set($event)" [required]="true"></app-input>
              <app-input label="Hora de inicio" type="time" [ngModel]="newStart()" (ngModelChange)="newStart.set($event)" [required]="true"></app-input>
              <app-input label="Hora de fin" type="time" [ngModel]="newEnd()" (ngModelChange)="newEnd.set($event)" [required]="true"></app-input>
            </div>
            <p class="text-xs text-[var(--color-text-secondary)]">El anticipo pasa con la reserva a la nueva fecha.</p>
          }

          @if (errorMessage(); as message) {
            <div class="flex items-start gap-2 rounded-xl border border-[var(--color-error)]/40 bg-[var(--color-error)]/5 p-3 text-sm text-[var(--color-text-primary)]" role="alert">
              <app-icon name="alert-triangle" [size]="16" class="mt-0.5 text-[var(--color-error)]"></app-icon>
              <span>{{ message }}</span>
            </div>
            @if (view() === 'cancel') {
              <button type="button" class="text-sm font-medium text-[var(--color-primary)] underline" (click)="switchToDecision()">
                Decidir el anticipo en su lugar
              </button>
            }
          }
        </div>
      }

      <div slot="footer" class="flex items-center justify-end gap-2">
        <app-button variant="ghost" size="sm" (clicked)="closed.emit()">Volver</app-button>
        <app-button
          [variant]="view() === 'cancel' ? 'danger' : 'primary'"
          size="sm"
          [disabled]="!canSubmit()"
          [loading]="submitting()"
          (clicked)="submit()"
        >
          {{ view() === 'cancel' ? 'Cancelar reserva' : 'Confirmar decisión' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class BookingDepositDialogComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly reservationsService = inject(ReservationsService);
  private readonly toastService = inject(ToastService);

  readonly isOpen = input<boolean>(false);
  readonly booking = input<Booking | null>(null);
  readonly deposit = input<BookingDeposit | null>(null);
  /** Which question opens first: cancelling the booking or the no-show decision. */
  readonly mode = input<DialogView>('decide');

  readonly closed = output<void>();
  /** The booking was cancelled or its deposit decided: the parent reloads and closes. */
  readonly done = output<void>();

  readonly view = signal<DialogView>('decide');
  readonly action = signal<DepositDecisionAction>('credit');
  readonly refundMethod = signal<DepositRefundMethod>('cash');
  readonly newDate = signal('');
  readonly newStart = signal('');
  readonly newEnd = signal('');
  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  private requestId = '';

  readonly refundMethodOptions = [
    { value: 'cash', label: 'Efectivo' },
    { value: 'bank_transfer', label: 'Transferencia' },
    { value: 'card', label: 'Tarjeta' },
    { value: 'wompi', label: 'Wompi' },
  ];

  private readonly leftoverOptions: DecisionOption[] = [
    { value: 'credit', label: 'Dejar saldo a favor', hint: 'El anticipo queda en la cuenta del cliente para su próxima compra.', icon: 'wallet' },
    { value: 'refund', label: 'Devolver', hint: 'Se devuelve el dinero al cliente por el medio que elijas.', icon: 'banknote' },
  ];

  private readonly decisionOptions: DecisionOption[] = [
    { value: 'retain', label: 'Retener como gastos de reserva', hint: 'Se factura como "Gastos de reserva" y la reserva queda como no asistida.', icon: 'check-circle' },
    { value: 'reschedule', label: 'Reagendar', hint: 'Se mueve la reserva a otra fecha y el anticipo la acompaña.', icon: 'calendar-clock' },
    ...this.leftoverOptions.slice().reverse(),
  ];

  readonly options = computed(() => (this.view() === 'cancel' ? this.leftoverOptions : this.decisionOptions));

  readonly canSubmit = computed(() => {
    if (this.submitting() || !this.booking()) return false;
    if (this.view() === 'decide' && this.action() === 'reschedule') {
      return !!this.newDate() && !!this.newStart() && !!this.newEnd();
    }
    return true;
  });

  onOpen(): void {
    this.view.set(this.mode());
    this.action.set(this.mode() === 'cancel' ? 'credit' : 'retain');
    this.refundMethod.set('cash');
    this.newDate.set('');
    this.newStart.set('');
    this.newEnd.set('');
    this.errorMessage.set(null);
    this.submitting.set(false);
    // One key per open: a double click or a retry reaches the backend as the same decision.
    this.requestId = crypto.randomUUID();
  }

  switchToDecision(): void {
    this.view.set('decide');
    this.action.set('retain');
    this.errorMessage.set(null);
  }

  submit(): void {
    const booking = this.booking();
    if (!booking || !this.canSubmit()) return;
    this.submitting.set(true);
    this.errorMessage.set(null);
    const refund = this.action() === 'refund' ? this.refundMethod() : undefined;

    if (this.view() === 'cancel') {
      this.reservationsService
        .cancelReservation(booking.id, { leftover_action: this.action() === 'refund' ? 'refund' : 'credit', refund_method: refund })
        .pipe(finalize(() => this.submitting.set(false)), takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => this.finish('Reserva cancelada'),
          error: (err) => this.errorMessage.set(extractApiErrorMessage(err)),
        });
      return;
    }

    const body: DepositDecisionInput = {
      action: this.action(),
      request_id: this.requestId,
      refund_method: refund,
      ...(this.action() === 'reschedule'
        ? { new_date: this.newDate(), new_start_time: this.newStart(), new_end_time: this.newEnd() }
        : {}),
    };
    this.reservationsService
      .decideDeposit(booking.id, body)
      .pipe(finalize(() => this.submitting.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.finish('Decisión del anticipo registrada'),
        error: (err) => this.errorMessage.set(extractApiErrorMessage(err)),
      });
  }

  private finish(message: string): void {
    this.toastService.success(message);
    this.done.emit();
  }
}
