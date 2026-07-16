import { Component, effect, inject, input, output, signal } from '@angular/core';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { StoreUserSelectComponent } from '../../../../../../shared/components/store-user-select/store-user-select.component';
import { ToggleComponent } from '../../../../../../shared/components/toggle/toggle.component';
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
    IconComponent,
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

  /**
   * Backend validation errors surfaced from the API (e.g. 400 responses with
   * `details.validationErrors: string[]`). The parent (FleetComponent) calls
   * `setBackendErrors()` when the create/update request fails. We display them
   * in a single banner at the top of the modal so the user sees exactly which
   * fields are wrong without having to inspect the network panel.
   *
   * Each error string from class-validator looks like:
   *   "brand should not be empty"
   *   "capacity_kg must not be less than 0.01"
   *   "primary_driver_id must not be less than 1"
   * The first token (split by space) is the field name; the rest is the
   * human-readable message. We keep the full string for display because it's
   * already pretty readable.
   */
  readonly backendErrors = signal<string[]>([]);

  /**
   * Becomes true the first time the user clicks 'Crear Vehículo' on an
   * invalid form. Used by the template to surface per-field error messages
   * even when Angular's FormControl.touched has not yet propagated (e.g. for
   * custom-wrapped controls like <app-store-user-select> which is a
   * third-party component owning its own internal control). After this flag
   * flips, the per-field error condition uses `submitAttempted() || touched`
   * so every invalid required field is highlighted regardless of focus.
   *
   * Reset every time the modal opens (in the effect).
   */
  readonly submitAttempted = signal(false);

  form: FormGroup = this.buildForm();

  constructor() {
    effect(() => {
      if (this.is_open()) {
        this.backendErrors.set([]); // clear stale errors from previous open
        this.submitAttempted.set(false); // reset submit-attempt flag
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

  /**
   * Set the list of validation errors returned by the backend so the user
   * sees exactly which fields are wrong. Called by FleetComponent when the
   * save request returns 400 with `details.validationErrors`.
   */
  setBackendErrors(errors: string[]): void {
    this.backendErrors.set(Array.isArray(errors) ? errors : []);
  }

  clearBackendErrors(): void {
    this.backendErrors.set([]);
  }

  /**
   * Returns true when the form control for `fieldName` has been touched by
   * the user AND is currently invalid. Used by the template to color the
   * required-asterisk red only when the field is in an error state, leaving
   * it black for fields that are merely required but not yet edited.
   *
   * Example visual states for a field with `Validators.required`:
   *   - untouched + empty     → asterisk BLACK, no error message
   *   - untouched + filled    → asterisk BLACK, no error message
   *   - touched   + empty     → asterisk RED, error message visible
   *   - touched   + filled    → asterisk BLACK (valid), no error message
   */
  isFieldInError(fieldName: string): boolean {
    const control = this.form.get(fieldName);
    if (!control) return false;
    // Show error when EITHER:
    //   - the field has been touched by the user (normal Angular Forms rule)
    //   - the user has attempted to submit at least once (forces all errors
    //     visible after the first click on 'Crear', regardless of focus)
    return (control.touched || this.submitAttempted()) && control.invalid;
  }

  private buildForm(): FormGroup {
    return this.fb.group({
      plate: ['', [Validators.required, Validators.maxLength(20)]],
      type: ['truck' as VehicleType, Validators.required],
      brand: ['', [Validators.required, Validators.maxLength(80)]],
      model_name: ['', [Validators.required, Validators.maxLength(80)]],
      capacity_kg: [
        null as number | null,
        [Validators.required, Validators.min(0)],
      ],
      capacity_units: [null as number | null],
      primary_driver_id: [
        null as number | null,
        [Validators.required],
      ],
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
      // markAllAsTouched only fires on FormGroup/FormControl children. The
      // ng-select for primary_driver_id (StoreUserSelectComponent) wraps
      // its own internal control; touching the FormControl from outside is
      // not always enough to surface its error message. Force the touched
      // event on each control via markAsTouched() to be explicit.
      Object.keys(this.form.controls).forEach((key) => {
        this.form.get(key)?.markAsTouched();
      });
      // Belt-and-suspenders: also flip the submitAttempted signal so the
      // template's per-field error condition can rely on it independently of
      // FormControl.touched propagation. Custom components like
      // app-store-user-select wrap their own internal control; even with
      // markAsTouched() on the outer FormControl, the inner CVA might not
      // re-evaluate in time. This signal ensures the error UI always shows.
      this.submitAttempted.set(true);
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
