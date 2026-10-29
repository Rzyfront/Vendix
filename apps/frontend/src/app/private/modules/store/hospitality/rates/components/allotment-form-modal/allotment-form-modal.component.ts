import { Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { injectFocusFirstField } from '../../../shared/focus-first-field';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
  ToggleComponent,
} from '../../../../../../../shared/components/index';
import { PosCustomerSelectorComponent } from '../../../../pos/components/pos-customer-selector/pos-customer-selector.component';
import { PosCustomer } from '../../../../pos/models/customer.model';
import { UnitType } from '../../../rooms/interfaces/unit-type.interface';
import { Allotment, seasonDate } from '../../interfaces/rate-plan.interface';
import { AllotmentsService } from '../../services/allotments.service';

interface AllotmentForm {
  unit_type_id: FormControl<number | null>;
  from_date: FormControl<string>;
  to_date: FormControl<string>;
  rooms: FormControl<number>;
  release_days: FormControl<number>;
  notes: FormControl<string>;
  is_active: FormControl<boolean>;
}

/** Customer shown in the modal: picked now or the one of the allotment. */
interface AllotmentCustomer {
  id: number;
  name: string;
}

/**
 * Hospitality Suite (H2.5) — create or edit an allotment ("Viajes X: 3 Dobles
 * en diciembre, liberar 7 días antes"). Agency and room type are fixed once
 * created; to change them, switch it off and create another.
 */
@Component({
  selector: 'app-allotment-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    IconComponent,
    SelectorComponent,
    ToggleComponent,
    PosCustomerSelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      (opened)="reset(); focusFirstField()"
      [size]="'md'"
      [dialog]="true"
      [title]="allotment() ? 'Editar cupo para agencia' : 'Nuevo cupo para agencia'"
      subtitle="Habitaciones reservadas para una agencia o empresa"
    >
      <!-- The customer search uses Enter to search, so it stays outside the form. -->
      <div class="space-y-4">
        <div class="space-y-2">
          <p class="text-sm font-medium text-text-primary">Agencia o empresa</p>
          @if (customer(); as c) {
            <div class="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <span class="flex items-center gap-2 text-sm" data-testid="allotment-customer">
                <app-icon name="building-2" [size]="16" />
                {{ c.name }}
              </span>
              @if (!allotment()) {
                <app-button variant="ghost" size="sm" (clicked)="customer.set(null)">
                  Cambiar
                </app-button>
              }
            </div>
          } @else {
            <app-pos-customer-selector data-autofocus (customerSelected)="pickCustomer($event)" />
            @if (customerError()) {
              <p class="text-xs text-error" role="alert">Elige la agencia o empresa</p>
            }
          }
        </div>

        <form
          [formGroup]="form"
          id="allotment-form"
          class="space-y-4"
          novalidate
          (ngSubmit)="onSubmit()"
        >
          <app-selector
            data-autofocus
            formControlName="unit_type_id"
            label="Tipo de habitación"
            placeholder="Elige el tipo"
            [required]="true"
            [options]="typeOptions()"
            [errorText]="typeError() ? 'Elige el tipo de habitación' : ''"
          />

          <div class="grid grid-cols-2 gap-3">
            <app-input
              formControlName="from_date"
              label="Primera noche"
              type="date"
              [required]="true"
              [control]="form.controls.from_date"
              customWrapperClass="mt-0"
            />
            <app-input
              formControlName="to_date"
              label="Última noche"
              type="date"
              [required]="true"
              [control]="form.controls.to_date"
              [error]="datesError() ? 'Debe ser igual o posterior a la primera noche' : ''"
              customWrapperClass="mt-0"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <app-input
              formControlName="rooms"
              label="Habitaciones por noche"
              type="number"
              [min]="1"
              [max]="500"
              [required]="true"
              [control]="form.controls.rooms"
              customWrapperClass="mt-0"
            />
            <app-input
              formControlName="release_days"
              label="Liberar días antes de la llegada"
              type="number"
              [min]="0"
              [max]="365"
              [required]="true"
              [control]="form.controls.release_days"
              customWrapperClass="mt-0"
            />
          </div>
          <p class="text-sm text-text-secondary">
            Estas habitaciones salen de la venta al público. Las reservas de la agencia las consumen y
            lo que no haya reservado vuelve al público {{ releaseDays() }}
            {{ releaseDays() === 1 ? 'día' : 'días' }} antes de cada noche.
          </p>

          <app-input
            formControlName="notes"
            label="Notas"
            type="text"
            placeholder="Ej. Contrato temporada 2026"
            [control]="form.controls.notes"
            customWrapperClass="mt-0"
          />
          @if (allotment()) {
            <app-toggle formControlName="is_active" label="Activo (desactivar libera el cupo)" />
          }
        </form>
      </div>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="onCancel()">Cancelar</app-button>
        <app-button type="submit" form="allotment-form" variant="primary" [loading]="saving()">
          <app-icon slot="icon" name="save" [size]="16" />
          Guardar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class AllotmentFormModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly allotmentsService = inject(AllotmentsService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly focusFirstField = injectFocusFirstField();

  readonly isOpen = input(false);
  /** Allotment to edit; null creates a new one. */
  readonly allotment = input<Allotment | null>(null);
  readonly unitTypes = input<UnitType[]>([]);

  readonly isOpenChange = output<boolean>();
  readonly saved = output<Allotment>();

  readonly saving = signal(false);
  readonly datesError = signal(false);
  readonly customerError = signal(false);
  readonly typeError = signal(false);
  readonly customer = signal<AllotmentCustomer | null>(null);
  readonly releaseDays = signal(7);

  readonly typeOptions = computed<SelectorOption[]>(() => {
    const current = this.allotment()?.unit_type;
    const active = this.unitTypes()
      .filter((t) => t.is_active)
      .map((t) => ({ value: t.id, label: t.name }));
    return current && !active.some((o) => o.value === current.id)
      ? [{ value: current.id, label: current.name }, ...active]
      : active;
  });

  readonly form: FormGroup<AllotmentForm> = this.fb.group<AllotmentForm>({
    unit_type_id: this.fb.control<number | null>(null, { validators: [Validators.required] }),
    from_date: this.fb.nonNullable.control('', { validators: [Validators.required] }),
    to_date: this.fb.nonNullable.control('', { validators: [Validators.required] }),
    rooms: this.fb.nonNullable.control(1, {
      validators: [Validators.required, Validators.min(1), Validators.max(500)],
    }),
    release_days: this.fb.nonNullable.control(7, {
      validators: [Validators.required, Validators.min(0), Validators.max(365)],
    }),
    notes: this.fb.nonNullable.control('', { validators: [Validators.maxLength(500)] }),
    is_active: this.fb.nonNullable.control(true),
  });

  constructor() {
    this.form.controls.release_days.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.releaseDays.set(Number(value) || 0));
    // The type error clears as soon as a type is picked.
    this.form.controls.unit_type_id.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        if (value !== null) this.typeError.set(false);
      });
  }

  reset(): void {
    const allotment = this.allotment();
    this.form.reset({
      unit_type_id: allotment?.unit_type_id ?? null,
      from_date: allotment ? seasonDate(allotment.from_date) : '',
      to_date: allotment ? seasonDate(allotment.to_date) : '',
      rooms: allotment?.rooms ?? 1,
      release_days: allotment?.release_days ?? 7,
      notes: allotment?.notes ?? '',
      is_active: allotment?.is_active ?? true,
    });
    // The room type of a saved allotment is fixed.
    if (allotment) this.form.controls.unit_type_id.disable();
    else this.form.controls.unit_type_id.enable();
    this.customer.set(
      allotment ? { id: allotment.customer.id, name: customerName(allotment.customer) } : null,
    );
    this.datesError.set(false);
    this.customerError.set(false);
    this.typeError.set(false);
  }

  pickCustomer(customer: PosCustomer): void {
    this.customer.set({
      id: customer.id,
      name:
        customer.legal_name ||
        customerName({ ...customer, last_name: customer.last_name ?? null }),
    });
    this.customerError.set(false);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  onSubmit(): void {
    this.form.markAllAsTouched();
    const raw = this.form.getRawValue();
    const customer = this.customer();
    this.datesError.set(!!raw.from_date && !!raw.to_date && raw.to_date < raw.from_date);
    this.customerError.set(!customer);
    this.typeError.set(raw.unit_type_id === null);
    if (this.form.invalid || this.datesError() || !customer || raw.unit_type_id === null) return;

    const terms = {
      from_date: raw.from_date,
      to_date: raw.to_date,
      rooms: Number(raw.rooms),
      release_days: Number(raw.release_days),
      notes: raw.notes.trim(),
    };
    const allotment = this.allotment();
    const request = allotment
      ? this.allotmentsService.update(allotment.id, { ...terms, is_active: raw.is_active })
      : this.allotmentsService.create({
          ...terms,
          customer_id: customer.id,
          unit_type_id: raw.unit_type_id,
        });

    this.saving.set(true);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.saving.set(false);
        this.toastService.success(allotment ? 'Cupo actualizado' : 'Cupo creado');
        this.saved.emit(result);
        this.isOpenChange.emit(false);
      },
      error: (message: unknown) => {
        this.saving.set(false);
        this.toastService.error(
          typeof message === 'string' ? message : 'No se pudo guardar el cupo',
        );
      },
    });
  }
}

/** "Viajes X" (first + last name), or the email when the name is empty. */
export function customerName(customer: {
  first_name: string | null;
  last_name: string | null;
  email: string;
}): string {
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.email;
}
