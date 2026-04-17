import {
  Component,
  input,
  output,
  inject,
  effect,
  DestroyRef,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import {
  updateEmployee,
  terminateEmployee,
} from '../../../state/actions/payroll.actions';
import { selectEmployeesLoading } from '../../../state/selectors/payroll.selectors';
import { Employee, AvailableUser } from '../../../interfaces/payroll.interface';
import { PayrollService } from '../../../services/payroll.service';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../../shared/components/selector/selector.component';
import { toUTCDateString } from '../../../../../../../shared/utils/date.util';

@Component({
  selector: 'vendix-employee-detail',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Detalle de Empleado"
      size="lg"
    >
      <div class="p-4">
        <!-- Status Badge -->
        @if (employee()) {
          <div class="mb-4 flex items-center gap-2">
            <span class="text-sm text-text-secondary">Estado:</span>
            <span
              [class]="getStatusBadgeClass(employee()!.status)"
              class="px-2 py-0.5 rounded-full text-xs font-medium"
            >
              {{ getStatusLabel(employee()!.status) }}
            </span>
            @if (employee()!.employee_code) {
              <span class="ml-auto text-sm text-text-secondary">
                Codigo: {{ employee()!.employee_code }}
              </span>
            }
          </div>
        }

        <!-- Linked user info -->
        @if (employee()?.user) {
          <div class="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-blue-800"
                >Usuario vinculado:</span
              >
              <span class="text-sm text-blue-700"
                >{{ employee()?.user?.first_name }}
                {{ employee()?.user?.last_name }} ({{
                  employee()?.user?.email
                }})</span
              >
            </div>
          </div>
        }

        <form
          [formGroup]="employeeForm"
          (ngSubmit)="onSubmit()"
          class="space-y-6"
        >
          <!-- Link User (optional) -->
          <div class="mb-2">
            <h3
              class="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wide"
            >
              Vincular con Usuario
            </h3>
            <app-selector
              label="Usuario del sistema (opcional)"
              formControlName="user_id"
              [options]="availableUsers"
              placeholder="Seleccionar usuario..."
            ></app-selector>
            <p class="text-xs text-text-secondary mt-1">
              Al seleccionar un usuario, se autocompletaran los datos
              personales.
            </p>
          </div>

          <!-- Personal Data -->
          <div>
            <h3
              class="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wide"
            >
              Datos Personales
            </h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <app-input
                label="Nombre"
                formControlName="first_name"
                [control]="employeeForm.get('first_name')"
                [required]="true"
              ></app-input>

              <app-input
                label="Apellido"
                formControlName="last_name"
                [control]="employeeForm.get('last_name')"
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
                [required]="true"
              ></app-input>
            </div>
          </div>

          <!-- Employment Data -->
          <div>
            <h3
              class="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wide"
            >
              Datos Laborales
            </h3>
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
              ></app-input>

              <app-input
                label="Departamento"
                formControlName="department"
                [control]="employeeForm.get('department')"
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
            <h3
              class="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wide"
            >
              Compensación
            </h3>
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
              ></app-input>

              <app-input
                label="Número de Cuenta"
                formControlName="bank_account_number"
                [control]="employeeForm.get('bank_account_number')"
              ></app-input>
            </div>
          </div>

          <!-- Social Security -->
          <div>
            <h3
              class="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wide"
            >
              Seguridad Social
            </h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <app-input
                label="EPS (Salud)"
                formControlName="health_provider"
                [control]="employeeForm.get('health_provider')"
              ></app-input>

              <app-input
                label="Fondo de Pensión"
                formControlName="pension_fund"
                [control]="employeeForm.get('pension_fund')"
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
              ></app-input>

              <app-input
                label="Caja de Compensación"
                formControlName="compensation_fund"
                [control]="employeeForm.get('compensation_fund')"
              ></app-input>
            </div>
          </div>
        </form>

        <!-- Terminate Action -->
        @if (employee() && employee()!.status === 'active') {
          <div class="mt-5 pt-4 border-t border-border space-y-2">
            <span
              class="text-xs font-medium text-text-secondary uppercase tracking-wide"
              >Acciones</span
            >
            <div class="flex justify-end">
              <app-button
                variant="outline-danger"
                size="sm"
                (clicked)="onTerminate()"
                [loading]="loading() || false"
              >
                Terminar Contrato
              </app-button>
            </div>
          </div>
        }

        <!-- Termination info -->
        @if (employee()?.termination_date) {
          <div class="mt-4 p-3 bg-red-50 rounded-lg border border-red-200">
            <p class="text-sm text-red-800">
              <strong>Fecha de terminacion:</strong>
              {{ employee()?.termination_date | date: 'dd/MM/yyyy' }}
            </p>
          </div>
        }
      </div>

      <!-- Footer -->
      <div slot="footer">
        <div
          class="flex items-center justify-end gap-2 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100"
        >
          <app-button variant="outline" size="sm" (clicked)="onClose()">
            Cerrar
          </app-button>

          @if (employee()?.status !== 'terminated') {
            <app-button
              variant="primary"
              size="sm"
              (clicked)="onSubmit()"
              [disabled]="employeeForm.invalid || loading() || false"
              [loading]="loading() || false"
            >
              Actualizar
            </app-button>
          }
        </div>
      </div>
    </app-modal>
  `,
})
export class EmployeeDetailComponent {
  readonly isOpen = input<boolean>(false);
  readonly employee = input<Employee | null>(null);
  readonly isOpenChange = output<boolean>();

  private payrollService = inject(PayrollService);
  private fb = inject(FormBuilder);
  private store = inject(Store);

  employeeForm: FormGroup = this.fb.group({});
  readonly loading = toSignal(this.store.select(selectEmployeesLoading), {
    initialValue: false,
  });
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

  constructor() {
    this.employeeForm = this.fb.group({
      user_id: [''],
      first_name: ['', [Validators.required, Validators.minLength(2)]],
      last_name: ['', [Validators.required, Validators.minLength(2)]],
      document_type: ['CC', [Validators.required]],
      document_number: ['', [Validators.required]],
      hire_date: ['', [Validators.required]],
      contract_type: ['indefinite', [Validators.required]],
      position: [''],
      department: [''],
      cost_center: ['administrative'],
      base_salary: [null, [Validators.required, Validators.min(1)]],
      payment_frequency: ['monthly', [Validators.required]],
      bank_name: [''],
      bank_account_number: [''],
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

    effect(() => {
      const emp = this.employee();
      if (emp) {
        this.patchForm(emp);
        if (emp.status === 'terminated') {
          this.employeeForm.disable();
        } else {
          this.employeeForm.enable();
        }
      }
    });
  }

  private patchForm(employee: Employee) {
    let hireDateStr = '';
    if (employee.hire_date) {
      const d = new Date(employee.hire_date);
      hireDateStr = toUTCDateString(d);
    }

    this.employeeForm.patchValue({
      user_id: employee.user_id || '',
      first_name: employee.first_name,
      last_name: employee.last_name,
      document_type: employee.document_type,
      document_number: employee.document_number,
      hire_date: hireDateStr,
      contract_type: employee.contract_type,
      position: employee.position || '',
      department: employee.department || '',
      cost_center: employee.cost_center || 'administrative',
      base_salary: employee.base_salary,
      payment_frequency: employee.payment_frequency,
      bank_name: employee.bank_name || '',
      bank_account_number: employee.bank_account_number || '',
      health_provider: employee.health_provider || '',
      pension_fund: employee.pension_fund || '',
      arl_risk_level: employee.arl_risk_level || 1,
      severance_fund: employee.severance_fund || '',
      compensation_fund: employee.compensation_fund || '',
    });
  }

  onSubmit() {
    const emp = this.employee();
    if (this.employeeForm.invalid || !emp || emp.status === 'terminated') {
      this.employeeForm.markAllAsTouched();
      return;
    }

    const formValue = this.employeeForm.value;

    this.store.dispatch(
      updateEmployee({
        id: emp.id,
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
          arl_risk_level: formValue.arl_risk_level
            ? Number(formValue.arl_risk_level)
            : undefined,
          severance_fund: formValue.severance_fund || undefined,
          compensation_fund: formValue.compensation_fund || undefined,
          user_id: formValue.user_id || undefined,
        },
      }),
    );
    this.onClose();
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

  onTerminate(): void {
    const emp = this.employee();
    if (emp) {
      this.store.dispatch(terminateEmployee({ id: emp.id }));
      this.onClose();
    }
  }

  onClose() {
    this.isOpenChange.emit(false);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      active: 'Activo',
      inactive: 'Inactivo',
      terminated: 'Terminado',
    };
    return labels[status] || status;
  }

  getStatusBadgeClass(status: string): string {
    const classes: Record<string, string> = {
      active: 'bg-green-100 text-green-800',
      inactive: 'bg-yellow-100 text-yellow-800',
      terminated: 'bg-red-100 text-red-800',
    };
    return classes[status] || 'bg-gray-100 text-gray-800';
  }
}
