import { Component, inject, input, output, signal } from '@angular/core';

import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Invoice } from '../../interfaces/invoice.interface';
import { createCreditNote, createDebitNote } from '../../state/actions/invoicing.actions';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';

@Component({
  selector: 'vendix-credit-note-create',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    TextareaComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [title]="noteType() === 'credit' ? 'Nueva Nota Crédito' : 'Nueva Nota Débito'"
      size="md"
      >
      <div class="p-4">
        <!-- Note Type Selector -->
        <div class="flex gap-2 mb-4">
          <button
            type="button"
            class="flex-1 px-3 py-2 text-sm rounded-lg border transition-colors"
            [class.bg-primary]="noteType() === 'credit'"
            [class.text-white]="noteType() === 'credit'"
            [class.border-primary]="noteType() === 'credit'"
            [class.bg-surface]="noteType() !== 'credit'"
            [class.text-text-primary]="noteType() !== 'credit'"
            [class.border-border]="noteType() !== 'credit'"
            (click)="noteType.set('credit')"
            >
            Nota Crédito
          </button>
          <button
            type="button"
            class="flex-1 px-3 py-2 text-sm rounded-lg border transition-colors"
            [class.bg-primary]="noteType() === 'debit'"
            [class.text-white]="noteType() === 'debit'"
            [class.border-primary]="noteType() === 'debit'"
            [class.bg-surface]="noteType() !== 'debit'"
            [class.text-text-primary]="noteType() !== 'debit'"
            [class.border-border]="noteType() !== 'debit'"
            (click)="noteType.set('debit')"
            >
            Nota Débito
          </button>
        </div>
    
        <!-- Source Invoice Info -->
        @if (sourceInvoice()) {
          <div class="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100 text-sm">
            <div class="font-medium text-blue-700 mb-1">Factura de referencia</div>
            <div class="text-blue-600">
              {{ sourceInvoice()!.invoice_number }} - {{ sourceInvoice()!.customer_name || 'Sin cliente' }}
              ({{ formatAmount(sourceInvoice()!.total_amount) }})
            </div>
          </div>
        }
    
        <form [formGroup]="noteForm" (ngSubmit)="onSubmit()" class="space-y-4">
          <app-textarea
            label="Razón / Motivo"
            formControlName="reason"
            [control]="noteForm.get('reason')"
            placeholder="Explique el motivo de la nota..."
            [rows]="3"
            [required]="true"
          ></app-textarea>
        </form>
      </div>
    
      <!-- Footer -->
      <div slot="footer">
        <div class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <app-button
            variant="outline"
            (clicked)="onClose()">
            Cancelar
          </app-button>
    
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="noteForm.invalid || submitting()"
            [loading]="submitting()">
            {{ noteType() === 'credit' ? 'Crear Nota Crédito' : 'Crear Nota Débito' }}
          </app-button>
        </div>
      </div>
    </app-modal>
    `
})
export class CreditNoteCreateComponent {
  readonly isOpen = input<boolean>(false);
  readonly sourceInvoice = input<Invoice | null>(null);
  readonly isOpenChange = output<boolean>();

  readonly noteType = signal<'credit' | 'debit'>('credit');
  readonly submitting = signal(false);

  noteForm: FormGroup;

  private fb = inject(FormBuilder);
  private store = inject(Store);

  constructor() {
    this.noteForm = this.fb.group({
      reason: ['', [Validators.required, Validators.minLength(5)]],
    });
  }

  onSubmit(): void {
    const sourceInv = this.sourceInvoice();
    if (this.noteForm.invalid || !sourceInv) {
      this.noteForm.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    const reason = this.noteForm.value.reason;
    const originalInvoiceId = sourceInv.id;

    if (this.noteType() === 'credit') {
      this.store.dispatch(createCreditNote({
        dto: { original_invoice_id: originalInvoiceId, reason },
      }));
    } else {
      this.store.dispatch(createDebitNote({
        dto: { original_invoice_id: originalInvoiceId, reason },
      }));
    }

    this.submitting.set(false);
    this.resetForm();
    this.onClose();
  }

  formatAmount(value: number): string {
    return `$${Number(value).toFixed(2)}`;
  }

  private resetForm(): void {
    this.noteForm.reset();
    this.noteType.set('credit');
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }
}
