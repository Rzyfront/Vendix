import {
  Component,
  input,
  output,
  inject,
  OnInit,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import {
  PayrollSystemDefault,
  CreatePayrollDefaultDto,
  UpdatePayrollDefaultDto,
} from '../../interfaces';
import {
  ModalComponent,
  InputComponent,
  ButtonComponent,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'app-payroll-defaults-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ButtonComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      size="xl"
      [title]="isCreate() ? 'Nuevo Año Fiscal' : (isReadonly() ? 'Ver Parámetros ' + record()?.year : 'Editar Parámetros ' + record()?.year)"
      subtitle="Parámetros de nómina según decreto colombiano"
    >
      <form [formGroup]="form" class="space-y-6">

        <!-- Meta -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          @if (isCreate()) {
            <app-input
              formControlName="year"
              label="Año fiscal"
              type="number"
              [required]="true"
              [control]="form.get('year')"
              [disabled]="isSubmitting()"
              helperText="Ej: 2027"
            ></app-input>
          }
          <app-input
            formControlName="decree_ref"
            label="Referencia de decreto"
            [disabled]="isSubmitting() || isReadonly()"
            helperText="Ej: Decreto 2641 de 2023"
          ></app-input>
        </div>

        <div>
          <label class="block text-sm font-medium text-text-primary mb-1">Notas</label>
          <textarea
            formControlName="notes"
            rows="2"
            [disabled]="isReadonly()"
            class="w-full rounded-md border border-[var(--color-border)] bg-surface px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="Observaciones adicionales..."
          ></textarea>
        </div>

        <!-- Sección 1: Valores Base -->
        <div class="rounded-lg border border-[var(--color-border)] overflow-hidden">
          <div class="px-4 py-3 bg-blue-50 border-b border-[var(--color-border)]">
            <h4 class="text-sm font-semibold text-blue-800">Valores Base</h4>
            <p class="text-xs text-blue-600 mt-0.5">Salarios y subsidios en pesos colombianos (COP)</p>
          </div>
          <div class="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4" formGroupName="rules">
            <app-input
              formControlName="minimum_wage"
              label="Salario mínimo"
              type="number"
              [required]="true"
              [control]="form.get('rules.minimum_wage')"
              [disabled]="isSubmitting() || isReadonly()"
              helperText="Valor en COP"
            ></app-input>
            <app-input
              formControlName="transport_subsidy"
              label="Auxilio de transporte"
              type="number"
              [required]="true"
              [control]="form.get('rules.transport_subsidy')"
              [disabled]="isSubmitting() || isReadonly()"
              helperText="Valor en COP"
            ></app-input>
            <app-input
              formControlName="transport_subsidy_threshold"
              label="Umbral auxilio de transporte"
              type="number"
              [required]="true"
              [control]="form.get('rules.transport_subsidy_threshold')"
              [disabled]="isSubmitting() || isReadonly()"
              helperText="Múltiplo del SMMLV (ej: 2)"
            ></app-input>
            <app-input
              formControlName="retention_exempt_threshold"
              label="Umbral retención exento"
              type="number"
              [required]="true"
              [control]="form.get('rules.retention_exempt_threshold')"
              [disabled]="isSubmitting() || isReadonly()"
              helperText="UVT o valor en COP"
            ></app-input>
          </div>
        </div>

        <!-- Sección 2: Seguridad Social -->
        <div class="rounded-lg border border-[var(--color-border)] overflow-hidden">
          <div class="px-4 py-3 bg-green-50 border-b border-[var(--color-border)]">
            <h4 class="text-sm font-semibold text-green-800">Seguridad Social</h4>
            <p class="text-xs text-green-600 mt-0.5">Porcentajes sobre el salario base de cotización (ingrese como decimal: 0.04 = 4%)</p>
          </div>
          <div class="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4" formGroupName="rules">
            <app-input
              formControlName="health_employee_rate"
              label="Salud — empleado"
              type="number"
              [required]="true"
              [control]="form.get('rules.health_employee_rate')"
              [disabled]="isSubmitting() || isReadonly()"
              helperText="Ej: 0.04 (4%)"
            ></app-input>
            <app-input
              formControlName="health_employer_rate"
              label="Salud — empleador"
              type="number"
              [required]="true"
              [control]="form.get('rules.health_employer_rate')"
              [disabled]="isSubmitting() || isReadonly()"
              helperText="Ej: 0.085 (8.5%)"
            ></app-input>
            <app-input
              formControlName="pension_employee_rate"
              label="Pensión — empleado"
              type="number"
              [required]="true"
              [control]="form.get('rules.pension_employee_rate')"
              [disabled]="isSubmitting() || isReadonly()"
              helperText="Ej: 0.04 (4%)"
            ></app-input>
            <app-input
              formControlName="pension_employer_rate"
              label="Pensión — empleador"
              type="number"
              [required]="true"
              [control]="form.get('rules.pension_employer_rate')"
              [disabled]="isSubmitting() || isReadonly()"
              helperText="Ej: 0.12 (12%)"
            ></app-input>
          </div>
        </div>

        <!-- Sección 3: Parafiscales y Provisiones -->
        <div class="rounded-lg border border-[var(--color-border)] overflow-hidden">
          <div class="px-4 py-3 bg-yellow-50 border-b border-[var(--color-border)]">
            <h4 class="text-sm font-semibold text-yellow-800">Parafiscales y Provisiones</h4>
            <p class="text-xs text-yellow-600 mt-0.5">Porcentajes sobre el salario (ingrese como decimal)</p>
          </div>
          <div class="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" formGroupName="rules">
            <app-input
              formControlName="sena_rate"
              label="SENA"
              type="number"
              [required]="true"
              [control]="form.get('rules.sena_rate')"
              [disabled]="isSubmitting() || isReadonly()"
              helperText="Ej: 0.02 (2%)"
            ></app-input>
            <app-input
              formControlName="icbf_rate"
              label="ICBF"
              type="number"
              [required]="true"
              [control]="form.get('rules.icbf_rate')"
              [disabled]="isSubmitting() || isReadonly()"
              helperText="Ej: 0.03 (3%)"
            ></app-input>
            <app-input
              formControlName="compensation_fund_rate"
              label="Caja de compensación"
              type="number"
              [required]="true"
              [control]="form.get('rules.compensation_fund_rate')"
              [disabled]="isSubmitting() || isReadonly()"
              helperText="Ej: 0.04 (4%)"
            ></app-input>
            <app-input
              formControlName="severance_rate"
              label="Cesantías"
              type="number"
              [required]="true"
              [control]="form.get('rules.severance_rate')"
              [disabled]="isSubmitting() || isReadonly()"
              helperText="Ej: 0.0833"
            ></app-input>
            <app-input
              formControlName="severance_interest_rate"
              label="Interés cesantías"
              type="number"
              [required]="true"
              [control]="form.get('rules.severance_interest_rate')"
              [disabled]="isSubmitting() || isReadonly()"
              helperText="Ej: 0.12 (12%)"
            ></app-input>
            <app-input
              formControlName="vacation_rate"
              label="Vacaciones"
              type="number"
              [required]="true"
              [control]="form.get('rules.vacation_rate')"
              [disabled]="isSubmitting() || isReadonly()"
              helperText="Ej: 0.0417"
            ></app-input>
            <app-input
              formControlName="bonus_rate"
              label="Prima de servicios"
              type="number"
              [required]="true"
              [control]="form.get('rules.bonus_rate')"
              [disabled]="isSubmitting() || isReadonly()"
              helperText="Ej: 0.0833"
            ></app-input>
          </div>
        </div>

        <!-- Sección 4: ARL por nivel de riesgo -->
        <div class="rounded-lg border border-[var(--color-border)] overflow-hidden">
          <div class="px-4 py-3 bg-red-50 border-b border-[var(--color-border)]">
            <h4 class="text-sm font-semibold text-red-800">ARL — Niveles de riesgo</h4>
            <p class="text-xs text-red-600 mt-0.5">Porcentajes por nivel de riesgo laboral (ingrese como decimal)</p>
          </div>
          <div class="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4" formGroupName="arl_rates">
            @for (level of arlLevels; track level) {
              <app-input
                [formControlName]="level"
                [label]="'Riesgo ' + level"
                type="number"
                [disabled]="isSubmitting() || isReadonly()"
                [helperText]="'Nivel ' + level"
              ></app-input>
            }
          </div>
        </div>

      </form>

      <ng-container slot="footer">
        <div class="flex justify-end gap-3">
          <app-button
            variant="outline"
            (clicked)="onCancel()"
            [disabled]="isSubmitting()"
          >
            {{ isReadonly() ? 'Cerrar' : 'Cancelar' }}
          </app-button>
          @if (!isReadonly()) {
            <app-button
              variant="primary"
              (clicked)="onSubmit()"
              [disabled]="form.invalid || isSubmitting()"
              [loading]="isSubmitting()"
            >
              {{ isCreate() ? 'Crear año fiscal' : 'Guardar cambios' }}
            </app-button>
          }
        </div>
      </ng-container>
    </app-modal>
  `,
  styles: [`:host { display: block; }`],
})
export class PayrollDefaultsFormComponent implements OnInit {
  isOpen = input<boolean>(false);
  isSubmitting = input<boolean>(false);
  /** null = crear, record con is_published=false = editar, record con is_published=true = ver */
  record = input<PayrollSystemDefault | null>(null);

  isOpenChange = output<boolean>();
  submitCreate = output<CreatePayrollDefaultDto>();
  submitUpdate = output<UpdatePayrollDefaultDto>();

  private fb = inject(FormBuilder);

  readonly arlLevels = ['I', 'II', 'III', 'IV', 'V'];

  readonly isCreate = computed(() => this.record() === null);
  readonly isReadonly = computed(() => !this.isCreate() && (this.record()?.is_published ?? false));

  form: FormGroup = this.fb.group({
    year: [null, [Validators.required, Validators.min(2020), Validators.max(2050)]],
    decree_ref: [null],
    notes: [null],
    rules: this.fb.group({
      minimum_wage: [null, [Validators.required, Validators.min(0)]],
      transport_subsidy: [null, [Validators.required, Validators.min(0)]],
      transport_subsidy_threshold: [null, [Validators.required, Validators.min(0)]],
      retention_exempt_threshold: [null, [Validators.required, Validators.min(0)]],
      health_employee_rate: [null, [Validators.required, Validators.min(0)]],
      pension_employee_rate: [null, [Validators.required, Validators.min(0)]],
      health_employer_rate: [null, [Validators.required, Validators.min(0)]],
      pension_employer_rate: [null, [Validators.required, Validators.min(0)]],
      sena_rate: [null, [Validators.required, Validators.min(0)]],
      icbf_rate: [null, [Validators.required, Validators.min(0)]],
      compensation_fund_rate: [null, [Validators.required, Validators.min(0)]],
      severance_rate: [null, [Validators.required, Validators.min(0)]],
      severance_interest_rate: [null, [Validators.required, Validators.min(0)]],
      vacation_rate: [null, [Validators.required, Validators.min(0)]],
      bonus_rate: [null, [Validators.required, Validators.min(0)]],
    }),
    arl_rates: this.fb.group({
      I: [null, [Validators.required, Validators.min(0)]],
      II: [null, [Validators.required, Validators.min(0)]],
      III: [null, [Validators.required, Validators.min(0)]],
      IV: [null, [Validators.required, Validators.min(0)]],
      V: [null, [Validators.required, Validators.min(0)]],
    }),
  });

  ngOnInit(): void {
    const rec = this.record();
    if (rec) {
      this.patchForm(rec);
    }
    if (!this.isCreate()) {
      this.form.get('year')?.disable();
    }
    if (this.isReadonly()) {
      this.form.disable();
    }
  }

  private patchForm(rec: PayrollSystemDefault): void {
    this.form.patchValue({
      year: rec.year,
      decree_ref: rec.decree_ref,
      notes: rec.notes,
      rules: {
        minimum_wage: rec.rules.minimum_wage,
        transport_subsidy: rec.rules.transport_subsidy,
        transport_subsidy_threshold: rec.rules.transport_subsidy_threshold,
        retention_exempt_threshold: rec.rules.retention_exempt_threshold,
        health_employee_rate: rec.rules.health_employee_rate,
        pension_employee_rate: rec.rules.pension_employee_rate,
        health_employer_rate: rec.rules.health_employer_rate,
        pension_employer_rate: rec.rules.pension_employer_rate,
        sena_rate: rec.rules.sena_rate,
        icbf_rate: rec.rules.icbf_rate,
        compensation_fund_rate: rec.rules.compensation_fund_rate,
        severance_rate: rec.rules.severance_rate,
        severance_interest_rate: rec.rules.severance_interest_rate,
        vacation_rate: rec.rules.vacation_rate,
        bonus_rate: rec.rules.bonus_rate,
      },
      arl_rates: {
        I: rec.rules.arl_rates?.['I'] ?? null,
        II: rec.rules.arl_rates?.['II'] ?? null,
        III: rec.rules.arl_rates?.['III'] ?? null,
        IV: rec.rules.arl_rates?.['IV'] ?? null,
        V: rec.rules.arl_rates?.['V'] ?? null,
      },
    });
  }

  onSubmit(): void {
    if (this.form.invalid) return;

    const raw = this.form.getRawValue();
    const rules = {
      ...raw.rules,
      arl_rates: raw.arl_rates,
    };

    if (this.isCreate()) {
      const dto: CreatePayrollDefaultDto = {
        year: raw.year,
        decree_ref: raw.decree_ref || null,
        notes: raw.notes || null,
        rules,
      };
      this.submitCreate.emit(dto);
    } else {
      const dto: UpdatePayrollDefaultDto = {
        decree_ref: raw.decree_ref || null,
        notes: raw.notes || null,
        rules,
      };
      this.submitUpdate.emit(dto);
    }
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }
}
