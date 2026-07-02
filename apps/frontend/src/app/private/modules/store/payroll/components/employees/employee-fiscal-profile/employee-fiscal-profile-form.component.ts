import {
  Component,
  input,
  output,
  inject,
  effect,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import { PayrollService } from '../../../services/payroll.service';
import {
  EmployeeFiscalProfile,
  EmployeeFiscalProfileUpdateDto,
  RetentionProcedure,
} from '../../../interfaces/payroll.interface';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../../shared/components/selector/selector.component';

/**
 * Sección "Perfil fiscal" del formulario de empleado (art. 387 ET).
 *
 * Componente standalone con su propio FormGroup aislado del formulario de
 * datos personales/laborales. Carga el perfil al detectar el `employeeId`,
 * expone estado de loading/error, y emite los cambios al padre para que
 * decida si los persiste junto al resto del formulario o como llamada
 * independiente.
 *
 * Reglas aplicadas en UI (los topes reales se aplican en backend):
 * - dependents_count: 0..10 (la lógica interna trunca a 4 que es el
 *   máximo legal según art. 387 ET; permitimos más para registrar
 *   padrastro histórico sin romper validaciones).
 * - housing_interest_monthly, voluntary_pension_monthly, afc_monthly:
 *   tope 100 UVT/mes (visible como COP tras resolver la UVT del año).
 * - prepaid_medicine_monthly: tope 16 UVT/mes.
 * - retention_procedure='proc2' requiere fixed_retention_rate.
 */
@Component({
  selector: 'vendix-employee-fiscal-profile-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
  ],
  template: `
    <div class="space-y-4">
      <div class="text-xs text-text-secondary">
        Perfil fiscal anual (art. 387 ET). Las deducciones se aplican en
        cada cálculo de nómina sobre la depuración del art. 383 ET y
        respetando el tope global 40% / 1.340 UVT del art. 336 ET.
      </div>

      <form
        [formGroup]="fiscalForm"
        (ngSubmit)="onSave()"
        class="space-y-4"
      >
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-input
            label="Dependientes económicos"
            type="number"
            formControlName="dependents_count"
            [control]="fiscalForm.get('dependents_count')"
            [min]="0"
            [max]="10"
          ></app-input>
          <div class="text-xs text-text-secondary self-end pb-2">
            Tope legal: 4 dependientes. El cálculo toma el menor entre
            72 UVT/año prorrateado y 10% del INCRNGO.
          </div>

          <app-input
            label="Intereses vivienda (mensual)"
            [currency]="true"
            formControlName="housing_interest_monthly"
            [control]="fiscalForm.get('housing_interest_monthly')"
            [prefixIcon]="true"
          >
            <span slot="prefix-icon" class="text-text-secondary">$</span>
          </app-input>
          <div class="text-xs text-text-secondary self-end pb-2">
            Tope 100 UVT/mes (art. 387 ET num. 1).
          </div>

          <app-input
            label="Medicina prepagada (mensual)"
            [currency]="true"
            formControlName="prepaid_medicine_monthly"
            [control]="fiscalForm.get('prepaid_medicine_monthly')"
            [prefixIcon]="true"
          >
            <span slot="prefix-icon" class="text-text-secondary">$</span>
          </app-input>
          <div class="text-xs text-text-secondary self-end pb-2">
            Tope 16 UVT/mes (art. 387 ET num. 3).
          </div>

          <app-input
            label="Pensión voluntaria (mensual)"
            [currency]="true"
            formControlName="voluntary_pension_monthly"
            [control]="fiscalForm.get('voluntary_pension_monthly')"
            [prefixIcon]="true"
          >
            <span slot="prefix-icon" class="text-text-secondary">$</span>
          </app-input>
          <div class="text-xs text-text-secondary self-end pb-2">
            Tope 100 UVT/mes.
          </div>

          <app-input
            label="Ahorro AFC (mensual)"
            [currency]="true"
            formControlName="afc_monthly"
            [control]="fiscalForm.get('afc_monthly')"
            [prefixIcon]="true"
          >
            <span slot="prefix-icon" class="text-text-secondary">$</span>
          </app-input>
          <div class="text-xs text-text-secondary self-end pb-2">
            Tope 100 UVT/mes.
          </div>
        </div>

        <!-- Procedimiento de retención (art. 386 ET) -->
        <div class="pt-2 border-t border-border">
          <h4
            class="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wide"
          >
            Procedimiento de retención
          </h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-selector
              label="Procedimiento"
              formControlName="retention_procedure"
              [options]="procedureOptions"
            ></app-selector>

            @if (procedure() === 'proc2') {
              <app-input
                label="% retención fija (semestral)"
                type="number"
                formControlName="fixed_retention_rate"
                [control]="fiscalForm.get('fixed_retention_rate')"
                [min]="0"
                [max]="100"
                step="0.01"
              ></app-input>
              <app-input
                label="Semestre"
                formControlName="rate_semester"
                [control]="fiscalForm.get('rate_semester')"
                placeholder="2026-1 o 2026-2"
              ></app-input>
              <div class="md:col-span-2 text-xs text-text-secondary">
                El porcentaje fijo se calcula semestralmente (jun/dic) sobre
                los ingresos de los 12 meses anteriores. Si no hay
                porcentaje para el semestre vigente, se aplica proc1
                automáticamente (no se retiene 0 silenciosamente).
              </div>
            }
          </div>
        </div>

        @if (errorMessage()) {
          <div
            class="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800"
          >
            {{ errorMessage() }}
          </div>
        }
        @if (successMessage()) {
          <div
            class="p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800"
          >
            {{ successMessage() }}
          </div>
        }

        <div class="flex justify-end">
          <app-button
            variant="primary"
            size="sm"
            (clicked)="onSave()"
            [disabled]="fiscalForm.invalid || saving()"
            [loading]="saving() || false"
          >
            Guardar perfil fiscal
          </app-button>
        </div>
      </form>
    </div>
  `,
})
export class EmployeeFiscalProfileFormComponent {
  private destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);
  private payrollService = inject(PayrollService);

  readonly employeeId = input<number | null>(null);
  readonly saved = output<EmployeeFiscalProfile>();

  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly loaded = signal<EmployeeFiscalProfile | null>(null);

  readonly procedureOptions: SelectorOption[] = [
    { label: 'Procedimiento 1 (art. 383 ET — tabla progresiva)', value: 'proc1' },
    { label: 'Procedimiento 2 (art. 386 ET — % fijo semestral)', value: 'proc2' },
  ];

  readonly procedure: ReturnType<typeof toSignal<RetentionProcedure>>;

  fiscalForm: FormGroup;

  constructor() {
    this.fiscalForm = this.fb.group(
      {
        dependents_count: [0, [Validators.min(0), Validators.max(10)]],
        housing_interest_monthly: [0, [Validators.min(0)]],
        prepaid_medicine_monthly: [0, [Validators.min(0)]],
        voluntary_pension_monthly: [0, [Validators.min(0)]],
        afc_monthly: [0, [Validators.min(0)]],
        retention_procedure: ['proc1', [Validators.required]],
        fixed_retention_rate: [null],
        rate_semester: [null],
      },
      { validators: [proc2RequiresFixedRate] },
    );

    this.procedure = toSignal(
      this.fiscalForm.get('retention_procedure')!.valueChanges,
      { initialValue: 'proc1' as RetentionProcedure },
    );

    // Cargar perfil al detectar employeeId
    effect(() => {
      const id = this.employeeId();
      if (id != null) {
        this.loadProfile(id);
      }
    });
  }

  private loadProfile(id: number) {
    this.saving.set(false);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.payrollService
      .getEmployeeFiscalProfile(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const profile = response.data;
          this.loaded.set(profile);
          this.fiscalForm.patchValue({
            dependents_count: profile.dependents_count ?? 0,
            housing_interest_monthly: profile.housing_interest_monthly ?? 0,
            prepaid_medicine_monthly: profile.prepaid_medicine_monthly ?? 0,
            voluntary_pension_monthly: profile.voluntary_pension_monthly ?? 0,
            afc_monthly: profile.afc_monthly ?? 0,
            retention_procedure: profile.retention_procedure ?? 'proc1',
            fixed_retention_rate: profile.fixed_retention_rate ?? null,
            rate_semester: profile.rate_semester ?? null,
          });
        },
        error: (err) => {
          this.errorMessage.set(
            err?.error?.message ??
              'No se pudo cargar el perfil fiscal del empleado.',
          );
        },
      });
  }

  onSave() {
    if (this.fiscalForm.invalid) {
      this.fiscalForm.markAllAsTouched();
      return;
    }
    const id = this.employeeId();
    if (id == null) {
      this.errorMessage.set('No hay empleado seleccionado.');
      return;
    }
    this.saving.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    const formValue = this.fiscalForm.value;
    const dto: EmployeeFiscalProfileUpdateDto = {
      dependents_count: Number(formValue.dependents_count ?? 0),
      housing_interest_monthly: Number(formValue.housing_interest_monthly ?? 0),
      prepaid_medicine_monthly: Number(formValue.prepaid_medicine_monthly ?? 0),
      voluntary_pension_monthly: Number(
        formValue.voluntary_pension_monthly ?? 0,
      ),
      afc_monthly: Number(formValue.afc_monthly ?? 0),
      retention_procedure: (formValue.retention_procedure ?? 'proc1') as RetentionProcedure,
    };
    if (formValue.retention_procedure === 'proc2') {
      dto.fixed_retention_rate =
        formValue.fixed_retention_rate != null
          ? Number(formValue.fixed_retention_rate)
          : undefined;
      dto.rate_semester =
        typeof formValue.rate_semester === 'string' &&
        formValue.rate_semester.trim() !== ''
          ? formValue.rate_semester.trim()
          : undefined;
    }

    this.payrollService
      .upsertEmployeeFiscalProfile(id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.saving.set(false);
          this.loaded.set(response.data);
          this.successMessage.set('Perfil fiscal guardado correctamente.');
          this.saved.emit(response.data);
        },
        error: (err) => {
          this.saving.set(false);
          this.errorMessage.set(
            err?.error?.message ??
              'No se pudo guardar el perfil fiscal del empleado.',
          );
        },
      });
  }
}

/**
 * Validador cross-field: si retention_procedure='proc2' entonces
 * fixed_retention_rate es obligatorio (> 0).
 */
function proc2RequiresFixedRate(control: AbstractControl): ValidationErrors | null {
  const procedure = control.get('retention_procedure')?.value;
  const rate = control.get('fixed_retention_rate')?.value;
  if (procedure === 'proc2') {
    if (rate == null || Number(rate) <= 0) {
      return { proc2RequiresFixedRate: true };
    }
  }
  return null;
}
