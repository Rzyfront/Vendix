import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { PayrollService } from '../../../services/payroll.service';
import { Employee, CreateSettlementDto } from '../../../interfaces/payroll.interface';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { SelectorComponent, SelectorOption } from '../../../../../../../shared/components/selector/selector.component';

@Component({
  selector: 'app-settlement-create',
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
      title="Nueva Liquidacion"
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
            label="Fecha de Terminacion"
            type="date"
            formControlName="termination_date"
            [control]="form.get('termination_date')"
            [required]="true"
          ></app-input>

          <app-selector
            label="Motivo de Terminacion"
            formControlName="termination_reason"
            [options]="reasonOptions"
            [required]="true"
          ></app-selector>

          <app-input
            label="Dias de Salario Pendiente"
            type="number"
            formControlName="pending_salary_days"
            [control]="form.get('pending_salary_days')"
            placeholder="Opcional"
          ></app-input>

          <div>
            <label class="block text-sm font-medium text-text-primary mb-1">Notas</label>
            <textarea
              formControlName="notes"
              rows="3"
              class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm
                     text-text-primary placeholder-text-secondary focus:border-primary
                     focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              placeholder="Observaciones opcionales..."
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
            Crear Liquidacion
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class SettlementCreateComponent implements OnInit, OnDestroy {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() created = new EventEmitter<void>();

  private fb = inject(FormBuilder);
  private payrollService = inject(PayrollService);
  private toastService = inject(ToastService);
  private destroy$ = new Subject<void>();

  submitting = false;
  employeeOptions: SelectorOption[] = [];

  reasonOptions: SelectorOption[] = [
    { label: 'Renuncia Voluntaria', value: 'voluntary_resignation' },
    { label: 'Despido con Justa Causa', value: 'just_cause_dismissal' },
    { label: 'Despido sin Justa Causa', value: 'unjust_cause_dismissal' },
    { label: 'Mutuo Acuerdo', value: 'mutual_agreement' },
    { label: 'Vencimiento Contrato', value: 'contract_expiration' },
    { label: 'Jubilacion', value: 'retirement' },
  ];

  form: FormGroup = this.fb.group({
    employee_id: [null, [Validators.required]],
    termination_date: ['', [Validators.required]],
    termination_reason: ['', [Validators.required]],
    pending_salary_days: [null],
    notes: [''],
  });

  ngOnInit(): void {
    this.loadEmployees();
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

    const dto: CreateSettlementDto = {
      employee_id: val.employee_id,
      termination_date: val.termination_date,
      termination_reason: val.termination_reason,
      notes: val.notes || undefined,
      pending_salary_days: val.pending_salary_days || undefined,
    };

    this.payrollService.createSettlement(dto)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.show({ variant: 'success', description: 'Liquidacion creada y calculada' });
          this.submitting = false;
          this.form.reset();
          this.created.emit();
          this.onClose();
        },
        error: () => {
          this.toastService.show({ variant: 'error', description: 'Error al crear la liquidacion' });
          this.submitting = false;
        },
      });
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }
}
