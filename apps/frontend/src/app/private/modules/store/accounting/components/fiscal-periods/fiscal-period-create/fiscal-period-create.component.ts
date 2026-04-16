import { Component, Input, Output, EventEmitter, inject } from '@angular/core';

import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Store } from '@ngrx/store';

import { CreateFiscalPeriodDto } from '../../../interfaces/accounting.interface';
import { createFiscalPeriod } from '../../../state/actions/accounting.actions';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
} from '../../../../../../../shared/components/index';

@Component({
  selector: 'vendix-fiscal-period-create',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Nuevo Periodo Fiscal"
      size="md"
    >
      <div class="p-4 space-y-4">
        <form [formGroup]="form">
          <app-input
            label="Nombre del Periodo"
            formControlName="name"
            [control]="form.get('name')"
            [required]="true"
            placeholder="Ej: Enero 2026"
          ></app-input>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <app-input
              label="Fecha de Inicio"
              type="date"
              formControlName="start_date"
              [control]="form.get('start_date')"
              [required]="true"
            ></app-input>

            <app-input
              label="Fecha de Fin"
              type="date"
              formControlName="end_date"
              [control]="form.get('end_date')"
              [required]="true"
            ></app-input>
          </div>
        </form>
      </div>

      <div slot="footer">
        <div class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <app-button variant="outline" (clicked)="onClose()">Cancelar</app-button>
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="form.invalid || is_submitting"
            [loading]="is_submitting"
          >
            Crear Periodo
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class FiscalPeriodCreateComponent {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();

  private fb = inject(FormBuilder);
  private store = inject(Store);

  is_submitting = false;

  form = this.fb.group({
    name: ['', [Validators.required]],
    start_date: ['', [Validators.required]],
    end_date: ['', [Validators.required]],
  });

  onSubmit(): void {
    if (this.form.invalid) return;

    this.is_submitting = true;
    const values = this.form.getRawValue();

    const dto: CreateFiscalPeriodDto = {
      name: values.name!,
      start_date: values.start_date!,
      end_date: values.end_date!,
    };

    this.store.dispatch(createFiscalPeriod({ fiscal_period: dto }));
    this.is_submitting = false;
    this.onClose();
  }

  onClose(): void {
    this.isOpenChange.emit(false);
    this.form.reset();
  }
}
