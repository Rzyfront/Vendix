import {
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  InputComponent,
  TextareaComponent,
  SelectorComponent,
} from '../../../../../../shared/components';
import type { SelectorOption } from '../../../../../../shared/components';
import { LocationsService } from '../../../inventory/services/locations.service';
import { DispatchNoteWizardService } from '../../services/dispatch-note-wizard.service';

@Component({
  selector: 'app-dispatch-wizard-details-step',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    TextareaComponent,
    SelectorComponent,
  ],
  template: `
    <form [formGroup]="form" class="space-y-3">
      <!-- Section: Fechas -->
      <div>
        <p class="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
          Fechas
        </p>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <app-input
            type="date"
            label="Fecha de emision"
            formControlName="emission_date"
            [required]="true"
          ></app-input>

          <app-input
            type="date"
            label="Fecha acordada de entrega"
            formControlName="agreed_delivery_date"
          ></app-input>

          <!-- Location selector inline on desktop -->
          <app-selector
            label="Ubicacion de despacho"
            formControlName="dispatch_location_id"
            placeholder="Selecciona ubicacion..."
            [options]="locationOptions()"
          ></app-selector>
        </div>
      </div>

      <!-- Section: Notas -->
      <div>
        <p class="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
          Notas
        </p>
        <div class="space-y-2">
          <app-textarea
            label="Notas"
            formControlName="notes"
            placeholder="Notas visibles en la remision..."
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

  private readonly fb = inject(FormBuilder);
  private readonly locationsService = inject(LocationsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly locationOptions = signal<SelectorOption[]>([]);

  readonly form: FormGroup = this.fb.group({
    emission_date: [this.wizardService.details().emission_date],
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
        next: (response) => {
          const locations = response.data || [];
          this.locationOptions.set(
            locations.map((loc: any) => ({
              value: loc.id,
              label: loc.name,
              description: loc.code || undefined,
            })),
          );
        },
        error: () => {
          this.locationOptions.set([]);
        },
      });
  }

  private syncFormToService(): void {
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((values) => {
        const selectedLocation = this.locationOptions().find(
          (o) => o.value === values.dispatch_location_id,
        );

        this.wizardService.setDetails({
          emission_date: values.emission_date || '',
          agreed_delivery_date: values.agreed_delivery_date || undefined,
          dispatch_location_id: values.dispatch_location_id || undefined,
          dispatch_location_name: selectedLocation?.label || undefined,
          notes: values.notes || undefined,
          internal_notes: values.internal_notes || undefined,
        });
      });
  }
}
