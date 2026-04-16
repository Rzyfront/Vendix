import { Component, Output, EventEmitter, Input, inject } from '@angular/core';

import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { createEmployee } from '../../../state/actions/payroll.actions';
import { selectEmployeesLoading } from '../../../state/selectors/payroll.selectors';
import { AvailableUser } from '../../../interfaces/payroll.interface';
import { PayrollService } from '../../../services/payroll.service';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { SelectorComponent, SelectorOption } from '../../../../../../../shared/components/selector/selector.component';
import { toLocalDateString } from '../../../../../../../shared/utils/date.util';

@Component({
  selector: 'vendix-employee-create',
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
      title="Nuevo Empleado"
      size="lg"
    >
      <div class="p-4">
        <form [formGroup]="employeeForm" (ngSubmit)="onSubmit()" class="space-y-6">

          <!-- Link User (optional) -->
          <div class="mb-2">
            <h3 class="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wide">Vincular con Usuario</h3>
            <app-selector
              label="Usuario del sistema (opcional)"
              formControlName="user_id"
              [options]="availableUsers"
              placeholder="Seleccionar usuario..."
            ></app-selector>
            <p class="text-xs text-text-secondary mt-1">Al seleccionar un usuario, se autocompletaran los datos personales.</p>
          </div>

          <!-- Personal Data -->
          <div>
            <h3 class="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wide">Datos Personales</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <app-input
                label="Nombre"
                formControlName="first_name"
                [control]="employeeForm.get('first_name')"
                placeholder="Nombre del empleado"
                [required]="true"
              ></app-input>

              <app-input
                label="Apellido"
                formControlName="last_name"
                [control]="employeeForm.get('last_name')"
                placeholder="Apellido del empleado"
                [required]="true"
              ></app-input>

              <app-selector
                label="Tipo de Documento"
                formControlName="document_type"
                [options]="documentTypeOptions"
                [required]="true"
              ></app-selector>

              <app-input
                label="Número de Documento"
                formControlName="document_number"
                [control]="employeeForm.get('document_number')"
                placeholder="Ej: 1234567890"
                [required]="true"
              ></app-input>
            </div>
          </div>

          <!-- Employment Data -->
          <div>
            <h3 class="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wide">Datos Laborales</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <app-input
                label="Fecha de Ingreso"
                type="date"
                formControlName="hire_date"
                [control]="employeeForm.get('hire_date')"
                [required]="true"
              ></app-input>

              <app-selector
                label="Tipo de Contrato"
                formControlName="contract_type"
                [options]="contractTypeOptions"
                [required]="true"
              ></app-selector>

              <app-input
                label="Cargo"
                formControlName="position"
                [control]="employeeForm.get('position')"
                placeholder="Ej: Vendedor"
              ></app-input>

              <app-input
                label="Departamento"
                formControlName="department"
                [control]="employeeForm.get('department')"
                placeholder="Ej: Ventas"
              ></app-input>

              <app-selector
                label="Centro de Costo"
                formControlName="cost_center"
                [options]="costCenterOptions"
              ></app-selector>
            </div>
          </div>

          <!-- Compensation -->
          <div>
            <h3 class="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wide">Compensación</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <app-input
                label="Salario Base"
                [currency]="true"
                formControlName="base_salary"
                [control]="employeeForm.get('base_salary')"
                [required]="true"
                [prefixIcon]="true"
              >
                <span slot="prefix-icon" class="text-text-secondary">$</span>
              </app-input>

              <app-selector
                label="Frecuencia de Pago"
                formControlName="payment_frequency"
                [options]="paymentFrequencyOptions"
                [required]="true"
              ></app-selector>

              <app-input
                label="Banco"
                formControlName="bank_name"
                [control]="employeeForm.get('bank_name')"
                placeholder="Ej: Bancolombia"
              ></app-input>

              <app-input
                label="Número de Cuenta"
                formControlName="bank_account_number"
                [control]="employeeForm.get('bank_account_number')"
                placeholder="Ej: 123-456-789"
              ></app-input>
            </div>
          </div>

          <!-- Social Security -->
          <div>
            <h3 class="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wide">Seguridad Social</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <app-input
                label="EPS (Salud)"
                formControlName="health_provider"
                [control]="employeeForm.get('health_provider')"
                placeholder="Ej: Sura EPS"
              ></app-input>

              <app-input
                label="Fondo de Pensión"
                formControlName="pension_fund"
                [control]="employeeForm.get('pension_fund')"
                placeholder="Ej: Proteccion"
              ></app-input>

              <app-selector
                label="Nivel de Riesgo ARL"
                formControlName="arl_risk_level"
                [options]="arlRiskLevelOptions"
              ></app-selector>

              <app-input
                label="Fondo de Cesantías"
                formControlName="severance_fund"
                [control]="employeeForm.get('severance_fund')"
                placeholder="Ej: Porvenir"
              ></app-input>

              <app-input
                label="Caja de Compensación"
                formControlName="compensation_fund"
                [control]="employeeForm.get('compensation_fund')"
                placeholder="Ej: Compensar"
              ></app-input>
            </div>
          </div>

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
            [disabled]="employeeForm.invalid || submitting"
            [loading]="submitting">
            Guardar Empleado
          </app-button>
        </div>
      </div>
    </app-modal>
  `
})
export class EmployeeCreateComponent {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();

  private payrollService = inject(PayrollService);

  employeeForm: FormGroup;
  loading$: Observable<boolean>;
  submitting = false;
  availableUsers: SelectorOption[] = [];
  private availableUsersData: AvailableUser[] = [];

  documentTypeOptions: SelectorOption[] = [
    { label: 'Cedula de Ciudadania', value: 'CC' },
    { label: 'Cedula de Extranjeria', value: 'CE' },
    { label: 'Pasaporte', value: 'PA' },
    { label: 'NIT', value: 'NIT' },
  ];

  contractTypeOptions: SelectorOption[] = [
    { label: 'Indefinido', value: 'indefinite' },
    { label: 'Termino Fijo', value: 'fixed_term' },
    { label: 'Prestacion de Servicios', value: 'service' },
    { label: 'Aprendizaje', value: 'apprentice' },
  ];

  paymentFrequencyOptions: SelectorOption[] = [
    { label: 'Mensual', value: 'monthly' },
    { label: 'Quincenal', value: 'biweekly' },
    { label: 'Semanal', value: 'weekly' },
  ];

  arlRiskLevelOptions: SelectorOption[] = [
    { label: 'Nivel I (0.522%)', value: 1 },
    { label: 'Nivel II (1.044%)', value: 2 },
    { label: 'Nivel III (2.436%)', value: 3 },
    { label: 'Nivel IV (4.350%)', value: 4 },
    { label: 'Nivel V (6.960%)', value: 5 },
  ];

  costCenterOptions: SelectorOption[] = [
    { label: 'Administrativo', value: 'administrative' },
    { label: 'Operativo / Producción', value: 'operational' },
    { label: 'Ventas', value: 'sales' },
  ];

  constructor(
    private fb: FormBuilder,
    private store: Store
  ) {
    this.loading$ = this.store.select(selectEmployeesLoading);

    const today = toLocalDateString();

    this.employeeForm = this.fb.group({
      // User link
      user_id: [''],
      // Personal
      first_name: ['', [Validators.required, Validators.minLength(2)]],
      last_name: ['', [Validators.required, Validators.minLength(2)]],
      document_type: ['CC', [Validators.required]],
      document_number: ['', [Validators.required]],
      // Employment
      hire_date: [today, [Validators.required]],
      contract_type: ['indefinite', [Validators.required]],
      position: [''],
      department: [''],
      cost_center: ['administrative'],
      // Compensation
      base_salary: [null, [Validators.required, Validators.min(1)]],
      payment_frequency: ['monthly', [Validators.required]],
      bank_name: [''],
      bank_account_number: [''],
      // Social Security
      health_provider: [''],
      pension_fund: [''],
      arl_risk_level: [1],
      severance_fund: [''],
      compensation_fund: [''],
    });

    this.loadAvailableUsers();

    this.employeeForm.get('user_id')!.valueChanges.subscribe((value) => {
      this.onUserSelected(value);
    });
  }

  loadAvailableUsers(): void {
    this.payrollService.getAvailableUsers().subscribe((res) => {
      this.availableUsersData = res.data;
      this.availableUsers = [
        { value: '', label: 'Sin vincular (datos manuales)' },
        ...res.data.map((user) => ({
          value: user.id,
          label: `${user.first_name} ${user.last_name} (${user.email})`,
        })),
      ];
    });
  }

  onUserSelected(value: any): void {
    if (!value) return;
    const user = this.availableUsersData.find((u) => u.id === value);
    if (user) {
      this.employeeForm.patchValue({
        first_name: user.first_name,
        last_name: user.last_name,
        document_type: user.document_type || 'CC',
        document_number: user.document_number || '',
      });
    }
  }

  onSubmit() {
    if (this.employeeForm.invalid) {
      this.employeeForm.markAllAsTouched();
      return;
    }

    this.submitting = true;
    const formValue = this.employeeForm.value;

    this.store.dispatch(createEmployee({
      employee: {
        first_name: formValue.first_name,
        last_name: formValue.last_name,
        document_type: formValue.document_type,
        document_number: formValue.document_number,
        hire_date: formValue.hire_date,
        contract_type: formValue.contract_type,
        position: formValue.position || undefined,
        department: formValue.department || undefined,
        cost_center: formValue.cost_center || undefined,
        base_salary: Number(formValue.base_salary),
        payment_frequency: formValue.payment_frequency,
        bank_name: formValue.bank_name || undefined,
        bank_account_number: formValue.bank_account_number || undefined,
        health_provider: formValue.health_provider || undefined,
        pension_fund: formValue.pension_fund || undefined,
        arl_risk_level: formValue.arl_risk_level ? Number(formValue.arl_risk_level) : undefined,
        severance_fund: formValue.severance_fund || undefined,
        compensation_fund: formValue.compensation_fund || undefined,
        user_id: formValue.user_id || undefined,
      }
    }));

    this.submitting = false;
    this.resetForm();
    this.onClose();
  }

  private resetForm(): void {
    this.employeeForm.reset({
      document_type: 'CC',
      contract_type: 'indefinite',
      payment_frequency: 'monthly',
      cost_center: 'administrative',
      hire_date: toLocalDateString(),
      arl_risk_level: 1,
    });
  }

  onClose() {
    this.isOpenChange.emit(false);
  }
}
