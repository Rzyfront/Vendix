import {
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { ReactiveFormsModule, FormGroup, FormBuilder } from '@angular/forms';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  TextareaComponent,
  IconComponent,
} from '../../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { DispatchNote } from '../../interfaces/dispatch-note.interface';

@Component({
  selector: 'app-deliver-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    TextareaComponent,
    IconComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Marcar como Entregada"
      size="md"
    >
      <!-- Header icon -->
      <div slot="header" class="flex items-center justify-center w-10 h-10 rounded-full bg-emerald-100">
        <app-icon name="truck" [size]="20" class="text-emerald-600"></app-icon>
      </div>

      <!-- Body -->
      <div class="space-y-5">
        <!-- Summary Card -->
        <div class="rounded-xl bg-[var(--color-background)] border border-[var(--color-border)] p-4 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-[var(--fs-sm)] text-[var(--color-text-secondary)]">Remision</span>
            <span class="text-[var(--fs-base)] font-[var(--fw-semibold)] text-[var(--color-text-primary)]">
              {{ dispatchNote().dispatch_number }}
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[var(--fs-sm)] text-[var(--color-text-secondary)]">Cliente</span>
            <span class="text-[var(--fs-sm)] text-[var(--color-text-primary)]">
              {{ dispatchNote().customer_name }}
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[var(--fs-sm)] text-[var(--color-text-secondary)]">Items</span>
            <span class="text-[var(--fs-sm)] text-[var(--color-text-primary)]">
              {{ dispatchNote().dispatch_note_items?.length || 0 }}
            </span>
          </div>
          <div class="flex items-center justify-between pt-2 border-t border-[var(--color-border)]">
            <span class="text-[var(--fs-sm)] font-[var(--fw-medium)] text-[var(--color-text-secondary)]">Total</span>
            <span class="text-[var(--fs-base)] font-[var(--fw-semibold)] text-[var(--color-text-primary)]">
              {{ formatCurrency(dispatchNote().grand_total) }}
            </span>
          </div>
        </div>

        <!-- Form -->
        <form [formGroup]="form" class="space-y-4">
          <app-input
            label="Fecha de entrega"
            type="date"
            formControlName="actual_delivery_date"
            [control]="form.get('actual_delivery_date')"
          ></app-input>

          <app-textarea
            label="Notas de entrega"
            formControlName="notes"
            placeholder="Notas de entrega, observaciones del despacho..."
            [rows]="3"
          ></app-textarea>
        </form>

        <!-- Info text -->
        <p class="text-[var(--fs-xs)] text-[var(--color-text-secondary)] flex items-center gap-1.5">
          <app-icon name="user" [size]="14" class="text-[var(--color-text-muted)]"></app-icon>
          La entrega sera registrada a nombre del usuario actual.
        </p>
      </div>

      <!-- Footer -->
      <div slot="footer">
        <div class="flex items-center justify-end gap-3">
          <app-button variant="outline" (clicked)="onClose()">
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            iconName="truck"
            (clicked)="onConfirm()"
          >
            Confirmar Entrega
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class DeliverModalComponent {
  private fb = inject(FormBuilder);
  private currencyService = inject(CurrencyFormatService);

  readonly isOpen = input<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly dispatchNote = input.required<DispatchNote>();
  readonly delivered = output<{ actual_delivery_date: string; notes?: string }>();

  form: FormGroup = this.fb.group({
    actual_delivery_date: [this.getTodayDate()],
    notes: [''],
  });

  private getTodayDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  formatCurrency(value: any): string {
    return this.currencyService.format(Number(value) || 0);
  }

  onConfirm(): void {
    const { actual_delivery_date, notes } = this.form.value;
    const payload: { actual_delivery_date: string; notes?: string } = {
      actual_delivery_date,
    };
    if (notes?.trim()) {
      payload.notes = notes.trim();
    }
    this.delivered.emit(payload);
  }

  onClose(): void {
    this.form.reset({
      actual_delivery_date: this.getTodayDate(),
      notes: '',
    });
    this.isOpenChange.emit(false);
  }
}
