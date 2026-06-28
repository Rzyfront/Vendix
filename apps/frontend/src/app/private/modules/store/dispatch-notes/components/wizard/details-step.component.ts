import {
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  InputComponent,
  TextareaComponent,
  SelectorComponent,
} from '../../../../../../shared/components';
import type { SelectorOption } from '../../../../../../shared/components';
import { LocationsService } from '../../../inventory/services/locations.service';
import { DispatchNoteWizardService } from '../../services/dispatch-note-wizard.service';

/**
 * Details step (ref 2026-06-25, plan wizard remisión order-first).
 *
 * The wizard always creates a `draft` remisión. The backend uses the
 * current time as the emission date, so this step is reduced to:
 *   - agreed_delivery_date (optional, defaults to the order's)
 *   - dispatch_location_id  (required — backend default-resolves per item)
 *   - notes / internal_notes (optional)
 */
@Component({
  selector: 'app-dispatch-wizard-details-step',
  standalone: true,
  imports: [
    InputComponent,
    ReactiveFormsModule,
    SelectorComponent,
    TextareaComponent,
  ],
  template: `
    <form [formGroup]="form" class="space-y-3">
      <div>
        <p class="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
          Despacho
        </p>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <app-selector
            label="Bodega de despacho"
            formControlName="dispatch_location_id"
            placeholder="Selecciona bodega..."
            [options]="locationOptions()"
            [required]="true"
          ></app-selector>

          <app-input
            type="date"
            label="Fecha acordada de entrega"
            formControlName="agreed_delivery_date"
          ></app-input>
        </div>
      </div>

      <div>
        <p class="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
          Notas
        </p>
        <div class="space-y-2">
          <app-textarea
            label="Notas"
            formControlName="notes"
            placeholder="Notas visibles en la remisión..."
            [rows]="2"
          ></app-textarea>

          <app-textarea
            label="Notas internas"
            formControlName="internal_notes"
            placeholder="Notas internas, solo visibles para el equipo..."
            [rows]="2"
          ></app-textarea>
        </div>
      </div>
    </form>
  `,
})
export class DetailsStepComponent {
  readonly wizardService = inject(DispatchNoteWizardService);

  private readonly locationsService = inject(LocationsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);

  readonly locationOptions = signal<SelectorOption[]>([]);

  readonly form: FormGroup = this.fb.group({
    agreed_delivery_date: [this.wizardService.details().agreed_delivery_date || ''],
    dispatch_location_id: [this.wizardService.details().dispatch_location_id || null],
    notes: [this.wizardService.details().notes || ''],
    internal_notes: [this.wizardService.details().internal_notes || ''],
  });

  constructor() {
    this.loadLocations();
    this.syncFormToService();
  }

  private loadLocations(): void {
    this.locationsService
      .getLocations({ is_active: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const locations = response.data || [];
          this.locationOptions.set(
            locations.map((loc: any) => ({
              value: loc.id,
              label: loc.name,
              description: loc.code || undefined,
            })),
          );
        },
        error: () => this.locationOptions.set([]),
      });
  }

  private syncFormToService(): void {
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((values: any) => {
        const selectedLocation = this.locationOptions().find(
          (o) => o.value === values.dispatch_location_id,
        );
        this.wizardService.setDetails({
          agreed_delivery_date: values.agreed_delivery_date || undefined,
          dispatch_location_id: values.dispatch_location_id || undefined,
          dispatch_location_name: selectedLocation?.label || undefined,
          notes: values.notes || undefined,
          internal_notes: values.internal_notes || undefined,
        });
      });
  }
}
