import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { PayrollService } from '../../../services/payroll.service';
import { Employee, CreateAdvanceDto } from '../../../interfaces/payroll.interface';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { SelectorComponent, SelectorOption } from '../../../../../../../shared/components/selector/selector.component';

@Component({
  selector: 'app-advance-create',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Nuevo Adelanto"
      size="md"
    >
      <div class="p-4">
        <form [formGroup]="form" (ngSubmit)="onSubmit()" class="space-y-4">

          <app-selector
            label="Empleado"
            formControlName="employee_id"
            [options]="employeeOptions"
            [required]="true"
            placeholder="Seleccionar empleado..."
          ></app-selector>

          <app-input
            label="Monto Solicitado"
            [currency]="true"
            formControlName="amount_requested"
            [control]="form.get('amount_requested')"
            [required]="true"
            placeholder="0"
          ></app-input>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              label="Numero de Cuotas"
              type="number"
              formControlName="installments"
              [control]="form.get('installments')"
              [required]="true"
              placeholder="1"
            ></app-input>

            <app-selector
              label="Frecuencia"
              formControlName="frequency"
              [options]="frequencyOptions"
            ></app-selector>
          </div>

          <app-input
            label="Fecha del Adelanto"
            type="date"
            formControlName="advance_date"
            [control]="form.get('advance_date')"
            [required]="true"
          ></app-input>

          <div>
            <label class="block text-sm font-medium text-text-primary mb-1">Motivo</label>
            <textarea
              formControlName="reason"
              rows="3"
              class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm
                     text-text-primary placeholder-text-secondary focus:border-primary
                     focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              placeholder="Motivo del adelanto (opcional)..."
            ></textarea>
          </div>

        </form>
      </div>

      <!-- Footer -->
      <div slot="footer">
        <div class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <app-button variant="outline" (clicked)="onClose()">
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="form.invalid || submitting"
            [loading]="submitting"
          >
            Solicitar Adelanto
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class AdvanceCreateComponent implements OnInit, OnDestroy {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() created = new EventEmitter<void>();

  private fb = inject(FormBuilder);
  private payrollService = inject(PayrollService);
  private toastService = inject(ToastService);
  private destroy$ = new Subject<void>();

  submitting = false;
  employeeOptions: SelectorOption[] = [];

  frequencyOptions: SelectorOption[] = [
    { label: 'Mensual', value: 'monthly' },
    { label: 'Quincenal', value: 'biweekly' },
    { label: 'Semanal', value: 'weekly' },
  ];

  form: FormGroup = this.fb.group({
    employee_id: [null, [Validators.required]],
    amount_requested: [null, [Validators.required, Validators.min(1)]],
    installments: [1, [Validators.required, Validators.min(1)]],
    frequency: ['monthly'],
    advance_date: ['', [Validators.required]],
    reason: [''],
  });

  ngOnInit(): void {
    this.loadEmployees();

    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    this.form.patchValue({ advance_date: today });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadEmployees(): void {
    this.payrollService.getEmployees({ status: 'active', limit: 500 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.employeeOptions = (res.data || []).map((emp: Employee) => ({
            label: `${emp.first_name} ${emp.last_name} (${emp.document_number})`,
            value: emp.id,
          }));
        },
      });
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting = true;
    const val = this.form.value;

    const dto: CreateAdvanceDto = {
      employee_id: val.employee_id,
      amount_requested: val.amount_requested,
      installments: val.installments,
      frequency: val.frequency || undefined,
      advance_date: val.advance_date,
      reason: val.reason || undefined,
    };

    this.payrollService.createAdvance(dto)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.show({ variant: 'success', description: 'Adelanto creado exitosamente' });
          this.submitting = false;
          this.form.reset({ installments: 1, frequency: 'monthly' });
          this.created.emit();
          this.onClose();
        },
        error: () => {
          this.toastService.show({ variant: 'error', description: 'Error al crear el adelanto' });
          this.submitting = false;
        },
      });
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }
}
