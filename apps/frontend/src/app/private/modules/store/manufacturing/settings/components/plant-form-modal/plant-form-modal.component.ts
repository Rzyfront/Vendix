import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';

import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
} from '../../../../../../../shared/components/index';

import { ManufacturingPlant, ManufacturingPlantManager } from '../../../interfaces';
import { ManufacturingPlantsService } from '../../../services';
import {
  createPlantPayload,
  managerName,
  plantFormError,
  plantFormValue,
  PlantFormValue,
  updatePlantPayload,
} from './plant-form.util';

/**
 * QUI-1013 — create or edit a production plant: name, input location,
 * finished-goods location and an optional manager.
 */
@Component({
  selector: 'app-plant-form-modal',
  standalone: true,
  imports: [ReactiveFormsModule, ModalComponent, InputComponent, SelectorComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      size="md"
      [title]="plant() ? 'Editar planta' : 'Nueva planta'"
      subtitle="Cada planta consume de su bodega de insumos y entrega en su bodega de terminado"
    >
      <form [formGroup]="form" (ngSubmit)="submit()" class="space-y-4">
        <app-input
          formControlName="name"
          label="Nombre"
          placeholder="Ej. Planta camisas"
          [required]="true"
        />
        <app-selector
          formControlName="input_location_id"
          label="Bodega de insumos"
          placeholder="Elige una bodega"
          helpText="De aquí salen los insumos y aquí se revisan los faltantes."
          [options]="locationOptions()"
          [searchable]="true"
          [required]="true"
        />
        <app-selector
          formControlName="output_location_id"
          label="Bodega de producto terminado"
          placeholder="Elige una bodega"
          helpText="Aquí entra el producto terminado al completar una orden."
          [options]="locationOptions()"
          [searchable]="true"
          [required]="true"
        />
        <app-selector
          formControlName="manager_user_id"
          label="Responsable (opcional)"
          placeholder="Sin responsable"
          [options]="managerOptions()"
          [searchable]="true"
        />
      </form>

      <div slot="footer" class="flex flex-col-reverse md:flex-row md:justify-end gap-2">
        <app-button variant="outline" [disabled]="isSubmitting()" (clicked)="close()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          [loading]="isSubmitting()"
          [disabled]="isSubmitting()"
          (clicked)="submit()"
        >
          <app-icon name="save" [size]="16" slot="icon" />
          {{ plant() ? 'Guardar cambios' : 'Crear planta' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class PlantFormModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly plantsService = inject(ManufacturingPlantsService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  /** Plant to edit; `null` creates a new one. */
  readonly plant = input<ManufacturingPlant | null>(null);
  readonly locationOptions = input<SelectorOption[]>([]);

  /** The plant as saved by the server. */
  readonly saved = output<ManufacturingPlant>();

  readonly isSubmitting = signal(false);
  private readonly managers = signal<ManufacturingPlantManager[] | null>(null);

  /** "Sin responsable" first; the current manager stays listed even beyond the first 50. */
  readonly managerOptions = computed<SelectorOption[]>(() => {
    const options: SelectorOption[] = [{ value: '', label: 'Sin responsable' }];
    const seen = new Set<number>();
    const current = this.plant()?.manager;
    for (const m of [...(current ? [current] : []), ...(this.managers() ?? [])]) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      options.push({ value: m.id, label: managerName(m) ?? `Usuario #${m.id}` });
    }
    return options;
  });

  readonly form = this.fb.nonNullable.group({
    name: this.fb.nonNullable.control(''),
    input_location_id: this.fb.nonNullable.control<number | string | null>(null),
    output_location_id: this.fb.nonNullable.control<number | string | null>(null),
    manager_user_id: this.fb.nonNullable.control<number | string | null>(null),
  });

  constructor() {
    effect(() => {
      if (!this.isOpen()) return;
      const plant = this.plant();
      untracked(() => {
        this.form.reset(plantFormValue(plant));
        if (this.managers() === null) this.loadManagers();
      });
    });
  }

  private loadManagers(): void {
    this.managers.set([]);
    this.plantsService
      .managers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.managers.set(rows),
        // Without the list the plant is still saved without changing its manager.
        error: () => this.managers.set(null),
      });
  }

  close(): void {
    this.isOpen.set(false);
  }

  submit(): void {
    if (this.isSubmitting()) return;
    const value: PlantFormValue = this.form.getRawValue();
    const error = plantFormError(value);
    if (error) {
      this.form.markAllAsTouched();
      this.toastService.error(error);
      return;
    }
    const plant = this.plant();
    if (plant) {
      const dto = updatePlantPayload(plant, value);
      if (Object.keys(dto).length === 0) {
        this.close();
        return;
      }
      this.send(this.plantsService.update(plant.id, dto), 'Planta actualizada');
    } else {
      this.send(this.plantsService.create(createPlantPayload(value)), 'Planta creada');
    }
  }

  private send(request: ReturnType<ManufacturingPlantsService['create']>, success: string): void {
    this.isSubmitting.set(true);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        this.isSubmitting.set(false);
        this.toastService.success(success);
        this.isOpen.set(false);
        this.saved.emit(saved);
      },
      error: (error: unknown) => {
        this.isSubmitting.set(false);
        this.toastService.error(typeof error === 'string' ? error : 'No se pudo guardar la planta');
      },
    });
  }
}
