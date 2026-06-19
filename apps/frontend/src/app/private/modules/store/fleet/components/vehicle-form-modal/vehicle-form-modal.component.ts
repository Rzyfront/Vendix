import { Component, effect, inject, input, output, signal } from '@angular/core';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import {
  ButtonComponent,
  ModalComponent,
  StoreUserSelectComponent,
  ToggleComponent,
} from '../../../../../../shared/components/index';
import {
  Vehicle,
  CreateVehicleDto,
  VehicleType,
  VEHICLE_TYPE_OPTIONS,
} from '../../interfaces/vehicle.interface';

@Component({
  selector: 'app-vehicle-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    ModalComponent,
    StoreUserSelectComponent,
    ToggleComponent,
  ],
  templateUrl: './vehicle-form-modal.component.html',
})
export class VehicleFormModalComponent {
  private fb = inject(FormBuilder);

  readonly vehicle = input<Vehicle | null>(null);
  readonly is_open = input<boolean>(false);
  readonly saving = input<boolean>(false);

  readonly save = output<CreateVehicleDto>();
  readonly closed = output<void>();

  readonly type_options = VEHICLE_TYPE_OPTIONS;
  readonly is_edit_mode = signal(false);

  form: FormGroup = this.buildForm();

  constructor() {
    effect(() => {
      if (this.is_open()) {
        this.form = this.buildForm();
        const v = this.vehicle();
        if (v) {
          this.is_edit_mode.set(true);
          this.patchForm(v);
        } else {
          this.is_edit_mode.set(false);
        }
      }
    });
  }

  private buildForm(): FormGroup {
    return this.fb.group({
      plate: ['', [Validators.required, Validators.maxLength(20)]],
      type: ['truck' as VehicleType],
      brand: ['', Validators.maxLength(80)],
      model_name: ['', Validators.maxLength(80)],
      capacity_kg: [null as number | null],
      capacity_units: [null as number | null],
      primary_driver_id: [null as number | null],
      is_active: [true],
      notes: [''],
    });
  }

  private patchForm(v: Vehicle): void {
    this.form.patchValue({
      plate: v.plate || '',
      type: v.type || 'truck',
      brand: v.brand || '',
      model_name: v.model_name || '',
      capacity_kg:
        v.capacity_kg !== null && v.capacity_kg !== undefined
          ? Number(v.capacity_kg)
          : null,
      capacity_units: v.capacity_units ?? null,
      primary_driver_id: v.primary_driver_id ?? null,
      is_active: v.is_active ?? true,
      notes: v.notes || '',
    });
  }

  handleSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.value;
    const dto: CreateVehicleDto = {
      plate: (raw.plate || '').trim(),
      type: raw.type || undefined,
      brand: raw.brand?.trim() || undefined,
      model_name: raw.model_name?.trim() || undefined,
      capacity_kg:
        raw.capacity_kg !== null && raw.capacity_kg !== undefined && `${raw.capacity_kg}` !== ''
          ? Number(raw.capacity_kg)
          : undefined,
      capacity_units:
        raw.capacity_units !== null && raw.capacity_units !== undefined && `${raw.capacity_units}` !== ''
          ? Number(raw.capacity_units)
          : undefined,
      primary_driver_id:
        raw.primary_driver_id !== null && raw.primary_driver_id !== undefined && `${raw.primary_driver_id}` !== ''
          ? Number(raw.primary_driver_id)
          : undefined,
      is_active: !!raw.is_active,
      notes: raw.notes?.trim() || undefined,
    };
    this.save.emit(dto);
  }

  handleClose(): void {
    this.closed.emit();
  }
}
