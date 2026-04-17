import { Component, inject, input, output, signal, effect } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { InvoiceResolution } from '../../../interfaces/invoice.interface';
import { createResolution, updateResolution } from '../../../state/actions/invoicing.actions';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';

@Component({
  selector: 'vendix-resolution-create',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [title]="isEditing() ? 'Editar Resolución' : 'Nueva Resolución'"
      size="md"
    >
      <div class="p-4">
        <form [formGroup]="resolutionForm" (ngSubmit)="onSubmit()" class="space-y-4">

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              label="Número de Resolución"
              formControlName="resolution_number"
              [control]="resolutionForm.get('resolution_number')"
              placeholder="Ej: 18764000001"
              [required]="true"
            ></app-input>

            <app-input
              label="Prefijo"
              formControlName="prefix"
              [control]="resolutionForm.get('prefix')"
              placeholder="Ej: FE"
              [required]="true"
            ></app-input>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              label="Rango Desde"
              type="number"
              formControlName="range_from"
              [control]="resolutionForm.get('range_from')"
              [required]="true"
              min="1"
            ></app-input>

            <app-input
              label="Rango Hasta"
              type="number"
              formControlName="range_to"
              [control]="resolutionForm.get('range_to')"
              [required]="true"
              min="1"
            ></app-input>
          </div>

          <app-input
            label="Fecha de Resolución"
            type="date"
            formControlName="resolution_date"
            [control]="resolutionForm.get('resolution_date')"
            [required]="true"
          ></app-input>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              label="Válida Desde"
              type="date"
              formControlName="valid_from"
              [control]="resolutionForm.get('valid_from')"
              [required]="true"
            ></app-input>

            <app-input
              label="Válida Hasta"
              type="date"
              formControlName="valid_to"
              [control]="resolutionForm.get('valid_to')"
              [required]="true"
            ></app-input>
          </div>

          <app-input
            label="Clave Técnica"
            formControlName="technical_key"
            [control]="resolutionForm.get('technical_key')"
            placeholder="Clave técnica DIAN (opcional)"
          ></app-input>

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
            [disabled]="resolutionForm.invalid || submitting()"
            [loading]="submitting()">
            {{ isEditing() ? 'Actualizar' : 'Crear' }} Resolución
          </app-button>
        </div>
      </div>
    </app-modal>
  `
})
export class ResolutionCreateComponent {
  readonly isOpen = input<boolean>(false);
  readonly resolution = input<InvoiceResolution | null>(null);
  readonly isOpenChange = output<boolean>();

  readonly submitting = signal(false);
  resolutionForm: FormGroup;

  private fb = inject(FormBuilder);
  private store = inject(Store);

  readonly isEditing = () => !!this.resolution();

  constructor() {
    this.resolutionForm = this.fb.group({
      resolution_number: ['', [Validators.required]],
      prefix: ['', [Validators.required]],
      range_from: [null, [Validators.required, Validators.min(1)]],
      range_to: [null, [Validators.required, Validators.min(1)]],
      resolution_date: ['', [Validators.required]],
      valid_from: ['', [Validators.required]],
      valid_to: ['', [Validators.required]],
      technical_key: [''],
    });

    effect(() => {
      const res = this.resolution();
      if (res) {
        this.resolutionForm.patchValue({
          resolution_number: res.resolution_number,
          prefix: res.prefix,
          range_from: res.range_from,
          range_to: res.range_to,
          resolution_date: res.resolution_date?.split('T')[0] || '',
          valid_from: res.valid_from?.split('T')[0] || '',
          valid_to: res.valid_to?.split('T')[0] || '',
          technical_key: res.technical_key || '',
        });
      } else {
        this.resolutionForm.reset();
      }
    });
  }

  onSubmit(): void {
    if (this.resolutionForm.invalid) {
      this.resolutionForm.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    const formValue = this.resolutionForm.value;

    const payload = {
      resolution_number: formValue.resolution_number,
      prefix: formValue.prefix,
      range_from: Number(formValue.range_from),
      range_to: Number(formValue.range_to),
      resolution_date: formValue.resolution_date,
      valid_from: formValue.valid_from,
      valid_to: formValue.valid_to,
      technical_key: formValue.technical_key || undefined,
    };

    const res = this.resolution();
    if (this.isEditing() && res) {
      this.store.dispatch(updateResolution({
        id: res.id,
        resolution: payload,
      }));
    } else {
      this.store.dispatch(createResolution({
        resolution: payload,
      }));
    }

    this.submitting.set(false);
    this.resolutionForm.reset();
    this.onClose();
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }
}
