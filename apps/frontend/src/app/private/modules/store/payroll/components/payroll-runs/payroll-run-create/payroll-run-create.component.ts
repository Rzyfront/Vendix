import { Component, Output, EventEmitter, Input, inject } from '@angular/core';

import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { createPayrollRun } from '../../../state/actions/payroll.actions';
import { selectPayrollRunsLoading } from '../../../state/selectors/payroll.selectors';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { SelectorComponent, SelectorOption } from '../../../../../../../shared/components/selector/selector.component';
import { toLocalDateString } from '../../../../../../../shared/utils/date.util';

@Component({
  selector: 'vendix-payroll-run-create',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Nueva Nomina"
      size="md"
    >
      <div class="p-4">
        <form [formGroup]="payrollRunForm" (ngSubmit)="onSubmit()" class="space-y-4">

          <app-selector
            label="Frecuencia"
            formControlName="frequency"
            [options]="frequencyOptions"
            [required]="true"
          ></app-selector>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              label="Inicio del Periodo"
              type="date"
              formControlName="period_start"
              [control]="payrollRunForm.get('period_start')"
              [required]="true"
            ></app-input>

            <app-input
              label="Fin del Periodo"
              type="date"
              formControlName="period_end"
              [control]="payrollRunForm.get('period_end')"
              [required]="true"
            ></app-input>
          </div>

          <app-input
            label="Fecha de Pago"
            type="date"
            formControlName="payment_date"
            [control]="payrollRunForm.get('payment_date')"
          ></app-input>

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
            [disabled]="payrollRunForm.invalid || submitting"
            [loading]="submitting">
            Crear Nomina
          </app-button>
        </div>
      </div>
    </app-modal>
  `
})
export class PayrollRunCreateComponent {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();

  payrollRunForm: FormGroup;
  loading$: Observable<boolean>;
  submitting = false;

  frequencyOptions: SelectorOption[] = [
    { label: 'Mensual', value: 'monthly' },
    { label: 'Quincenal', value: 'biweekly' },
    { label: 'Semanal', value: 'weekly' },
  ];

  constructor(
    private fb: FormBuilder,
    private store: Store
  ) {
    this.loading$ = this.store.select(selectPayrollRunsLoading);

    const today = new Date();
    const firstDay = toLocalDateString(new Date(today.getFullYear(), today.getMonth(), 1));
    const lastDay = toLocalDateString(new Date(today.getFullYear(), today.getMonth() + 1, 0));

    this.payrollRunForm = this.fb.group({
      frequency: ['monthly', [Validators.required]],
      period_start: [firstDay, [Validators.required]],
      period_end: [lastDay, [Validators.required]],
      payment_date: [''],
    });
  }

  onSubmit() {
    if (this.payrollRunForm.invalid) {
      this.payrollRunForm.markAllAsTouched();
      return;
    }

    this.submitting = true;
    const formValue = this.payrollRunForm.value;

    this.store.dispatch(createPayrollRun({
      payrollRun: {
        frequency: formValue.frequency,
        period_start: formValue.period_start,
        period_end: formValue.period_end,
        payment_date: formValue.payment_date || undefined,
      }
    }));

    this.submitting = false;
    this.resetForm();
    this.onClose();
  }

  private resetForm(): void {
    const today = new Date();
    const firstDay = toLocalDateString(new Date(today.getFullYear(), today.getMonth(), 1));
    const lastDay = toLocalDateString(new Date(today.getFullYear(), today.getMonth() + 1, 0));

    this.payrollRunForm.reset({
      frequency: 'monthly',
      period_start: firstDay,
      period_end: lastDay,
      payment_date: '',
    });
  }

  onClose() {
    this.isOpenChange.emit(false);
  }
}
