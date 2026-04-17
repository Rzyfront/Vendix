import {Component, inject, signal, output, input,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';


import { AccountingService } from '../../../services/accounting.service';
import {
  ConsolidationSession,
  FiscalPeriod} from '../../../interfaces/accounting.interface';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  TextareaComponent,
  ToastService,
  SelectorOption} from '../../../../../../../shared/components/index';

@Component({
  selector: 'vendix-session-create-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Nueva Sesion de Consolidacion"
      size="md"
    >
      <div class="p-4 space-y-4">
        <form [formGroup]="form">
          <app-input
            label="Nombre"
            formControlName="name"
            [control]="form.get('name')"
            [required]="true"
            placeholder="Ej: Consolidacion Q1 2026"
          ></app-input>

          <app-selector
            label="Periodo Fiscal"
            formControlName="fiscal_period_id"
            [options]="period_options()"
            [required]="true"
            placeholder="Seleccionar periodo"
          ></app-selector>

          <app-textarea
            label="Notas"
            formControlName="notes"
            [rows]="3"
            placeholder="Notas adicionales (opcional)"
          ></app-textarea>
        </form>
      </div>

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
            [disabled]="form.invalid || is_submitting()"
            [loading]="is_submitting()">
            Crear Sesion
          </app-button>
        </div>
      </div>
    </app-modal>
  `})
export class SessionCreateModalComponent {
  private destroyRef = inject(DestroyRef);
private fb = inject(FormBuilder);
  private accounting_service = inject(AccountingService);
  private toast_service = inject(ToastService);

  readonly isOpen = input(false);
  readonly isOpenChange = output<boolean>();
  readonly created = output<ConsolidationSession>();

  is_submitting = signal(false);
  fiscal_periods = signal<FiscalPeriod[]>([]);
  period_options = signal<SelectorOption[]>([]);

  form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(3)]],
    fiscal_period_id: [null as number | null, [Validators.required]],
    notes: ['']});

  constructor() {
    this.loadPeriods();
  }
private loadPeriods(): void {
    this.accounting_service
      .getFiscalPeriods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const periods = res.data || [];
          this.fiscal_periods.set(periods);
          this.period_options.set(
            periods.map((p) => ({
              value: p.id,
              label: p.name})),
          );
        }});
  }

  onSubmit(): void {
    if (this.form.invalid) return;

    this.is_submitting.set(true);
    const { name, fiscal_period_id, notes } = this.form.getRawValue();

    this.accounting_service
      .createConsolidationSession({
        name: name!,
        fiscal_period_id: fiscal_period_id!,
        notes: notes || undefined})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.toast_service.show({ variant: 'success', description: 'Sesion creada exitosamente' });
          this.is_submitting.set(false);
          this.form.reset();
          this.created.emit(res.data);
        },
        error: () => {
          this.toast_service.show({ variant: 'error', description: 'Error creando sesion' });
          this.is_submitting.set(false);
        }});
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }
}
