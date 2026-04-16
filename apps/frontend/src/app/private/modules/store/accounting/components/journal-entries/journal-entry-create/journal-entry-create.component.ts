import { Component, Input, Output, EventEmitter, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, Validators } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  ChartAccount,
  FiscalPeriod,
  CreateJournalEntryDto,
} from '../../../interfaces/accounting.interface';
import { createEntry } from '../../../state/actions/accounting.actions';
import {
  selectLeafAccounts,
  selectOpenFiscalPeriods,
} from '../../../state/selectors/accounting.selectors';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  TextareaComponent,
  IconComponent,
} from '../../../../../../../shared/components/index';
import { toLocalDateString } from '../../../../../../../shared/utils/date.util';

@Component({
  selector: 'vendix-journal-entry-create',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Nuevo Asiento Contable"
      size="xl"
    >
      <div class="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
        <form [formGroup]="form">
          <!-- Header Fields -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <app-selector
              label="Tipo de Asiento"
              formControlName="entry_type"
              [options]="entry_type_options"
              [required]="true"
            ></app-selector>

            <app-selector
              label="Periodo Fiscal"
              formControlName="fiscal_period_id"
              [options]="fiscal_period_options"
              [required]="true"
            ></app-selector>

            <app-input
              label="Fecha del Asiento"
              type="date"
              formControlName="entry_date"
              [control]="form.get('entry_date')"
              [required]="true"
            ></app-input>
          </div>

          <div class="mt-4">
            <app-textarea
              label="Descripción"
              formControlName="description"
              [rows]="2"
              placeholder="Descripción del asiento..."
            ></app-textarea>
          </div>

          <!-- Entry Lines -->
          <div class="mt-6">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-sm font-semibold text-text-primary">Líneas del Asiento</h3>
              <app-button variant="outline" size="sm" (clicked)="addLine()">
                <app-icon name="plus" [size]="14"></app-icon>
                Añadir Línea
              </app-button>
            </div>

            <!-- Lines Table Header -->
            <div class="hidden md:grid md:grid-cols-12 gap-2 px-3 py-2 bg-gray-50 rounded-t-lg
                        text-xs font-semibold text-gray-500 uppercase border border-border">
              <div class="col-span-4">Cuenta</div>
              <div class="col-span-3">Descripción</div>
              <div class="col-span-2 text-right">Débito</div>
              <div class="col-span-2 text-right">Crédito</div>
              <div class="col-span-1"></div>
            </div>

            <!-- Lines -->
            <div formArrayName="lines" class="border-x border-b border-border rounded-b-lg divide-y divide-border">
              @for (line of lines.controls; track $index; let i = $index) {
                <div [formGroupName]="i" class="grid grid-cols-1 md:grid-cols-12 gap-2 p-3 items-start">
                  <!-- Mobile labels -->
                  <div class="md:hidden text-xs font-medium text-gray-500 mb-1">Cuenta *</div>
                  <div class="col-span-1 md:col-span-4">
                    <app-selector
                      formControlName="account_id"
                      [options]="account_options"
                      placeholder="Seleccionar cuenta..."
                      [required]="true"
                    ></app-selector>
                  </div>

                  <div class="md:hidden text-xs font-medium text-gray-500 mb-1 mt-2">Descripción</div>
                  <div class="col-span-1 md:col-span-3">
                    <app-input
                      formControlName="description"
                      [control]="line.get('description')"
                      placeholder="Descripción de la línea"
                    ></app-input>
                  </div>

                  <div class="grid grid-cols-2 gap-2 md:contents">
                    <div class="md:col-span-2">
                      <div class="md:hidden text-xs font-medium text-gray-500 mb-1">Débito</div>
                      <app-input
                        [currency]="true"
                        formControlName="debit_amount"
                        [control]="line.get('debit_amount')"
                        placeholder="0.00"
                        (input)="onDebitChange(i)"
                      ></app-input>
                    </div>
                    <div class="md:col-span-2">
                      <div class="md:hidden text-xs font-medium text-gray-500 mb-1">Crédito</div>
                      <app-input
                        [currency]="true"
                        formControlName="credit_amount"
                        [control]="line.get('credit_amount')"
                        placeholder="0.00"
                        (input)="onCreditChange(i)"
                      ></app-input>
                    </div>
                  </div>

                  <div class="col-span-1 flex items-center justify-end md:justify-center pt-1">
                    @if (lines.length > 2) {
                      <button type="button" (click)="removeLine(i)"
                              class="p-1.5 hover:bg-red-50 rounded text-gray-400 hover:text-red-500">
                        <app-icon name="trash-2" [size]="14"></app-icon>
                      </button>
                    }
                  </div>
                </div>
              }
            </div>

            <!-- Totals Row -->
            <div class="grid grid-cols-1 md:grid-cols-12 gap-2 px-3 py-3 bg-gray-50 rounded-lg mt-2
                        border border-border">
              <div class="col-span-7 text-sm font-semibold text-text-primary">
                Totales
              </div>
              <div class="col-span-2 text-right font-mono text-sm font-bold"
                   [class.text-emerald-600]="is_balanced"
                   [class.text-red-600]="!is_balanced">
                {{ total_debit | number:'1.2-2' }}
              </div>
              <div class="col-span-2 text-right font-mono text-sm font-bold"
                   [class.text-emerald-600]="is_balanced"
                   [class.text-red-600]="!is_balanced">
                {{ total_credit | number:'1.2-2' }}
              </div>
              <div class="col-span-1"></div>
            </div>

            <!-- Balance Warning -->
            @if (!is_balanced && lines.length >= 2) {
              <div class="mt-2 flex items-center gap-2 px-3 py-2 bg-red-50 text-red-700 rounded-lg text-sm">
                <app-icon name="alert-circle" [size]="16"></app-icon>
                <span>El asiento no está balanceado. El débito total debe ser igual al crédito total (diferencia: {{ difference | number:'1.2-2' }}).</span>
              </div>
            }

            @if (is_balanced && lines.length >= 2) {
              <div class="mt-2 flex items-center gap-2 px-3 py-2 bg-emerald-50 text-emerald-700 rounded-lg text-sm">
                <app-icon name="check-circle" [size]="16"></app-icon>
                <span>El asiento está balanceado.</span>
              </div>
            }
          </div>
        </form>
      </div>

      <div slot="footer">
        <div class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <app-button variant="outline" (clicked)="onClose()">Cancelar</app-button>
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="form.invalid || !is_balanced || is_submitting"
            [loading]="is_submitting"
          >
            Crear Asiento
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class JournalEntryCreateComponent implements OnInit {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();

  private fb = inject(FormBuilder);
  private store = inject(Store);

  leaf_accounts$: Observable<ChartAccount[]> = this.store.select(selectLeafAccounts);
  open_periods$: Observable<FiscalPeriod[]> = this.store.select(selectOpenFiscalPeriods);

  is_submitting = false;
  account_options: { value: any; label: string }[] = [];
  fiscal_period_options: { value: any; label: string }[] = [];

  entry_type_options = [
    { value: 'manual', label: 'Manual' },
    { value: 'adjustment', label: 'Ajuste' },
    { value: 'closing', label: 'Cierre' },
    { value: 'opening', label: 'Apertura' },
  ];

  form = this.fb.group({
    entry_type: ['manual', [Validators.required]],
    fiscal_period_id: [null as number | null, [Validators.required]],
    entry_date: ['', [Validators.required]],
    description: [''],
    lines: this.fb.array([
      this.createLineGroup(),
      this.createLineGroup(),
    ]),
  });

  get lines(): FormArray {
    return this.form.get('lines') as FormArray;
  }

  get total_debit(): number {
    return this.lines.controls.reduce((sum, line) => {
      return sum + (Number(line.get('debit_amount')?.value) || 0);
    }, 0);
  }

  get total_credit(): number {
    return this.lines.controls.reduce((sum, line) => {
      return sum + (Number(line.get('credit_amount')?.value) || 0);
    }, 0);
  }

  get difference(): number {
    return Math.abs(this.total_debit - this.total_credit);
  }

  get is_balanced(): boolean {
    return Math.abs(this.total_debit - this.total_credit) < 0.01 && this.total_debit > 0;
  }

  ngOnInit(): void {
    this.leaf_accounts$.subscribe((accounts) => {
      this.account_options = accounts.map((a) => ({
        value: a.id,
        label: `${a.code} - ${a.name}`,
      }));
    });

    this.open_periods$.subscribe((periods) => {
      this.fiscal_period_options = periods.map((p) => ({
        value: p.id,
        label: p.name,
      }));
    });

    // Set default date to today
    const today = toLocalDateString();
    this.form.patchValue({ entry_date: today });
  }

  createLineGroup() {
    return this.fb.group({
      account_id: [null as number | null, [Validators.required]],
      description: [''],
      debit_amount: [0],
      credit_amount: [0],
    });
  }

  addLine(): void {
    this.lines.push(this.createLineGroup());
  }

  removeLine(index: number): void {
    if (this.lines.length > 2) {
      this.lines.removeAt(index);
    }
  }

  onDebitChange(index: number): void {
    const line = this.lines.at(index);
    const debit = Number(line.get('debit_amount')?.value) || 0;
    if (debit > 0) {
      line.get('credit_amount')?.setValue(0, { emitEvent: false });
    }
  }

  onCreditChange(index: number): void {
    const line = this.lines.at(index);
    const credit = Number(line.get('credit_amount')?.value) || 0;
    if (credit > 0) {
      line.get('debit_amount')?.setValue(0, { emitEvent: false });
    }
  }

  onSubmit(): void {
    if (this.form.invalid || !this.is_balanced) return;

    this.is_submitting = true;
    const values = this.form.getRawValue();

    const dto: CreateJournalEntryDto = {
      entry_type: values.entry_type!,
      fiscal_period_id: values.fiscal_period_id!,
      entry_date: values.entry_date!,
      description: values.description || undefined,
      lines: values.lines.map((line: any) => ({
        account_id: line.account_id,
        description: line.description || undefined,
        debit_amount: Number(line.debit_amount) || 0,
        credit_amount: Number(line.credit_amount) || 0,
      })),
    };

    this.store.dispatch(createEntry({ entry: dto }));
    this.is_submitting = false;
    this.onClose();
  }

  onClose(): void {
    this.isOpenChange.emit(false);
    // Reset form with 2 empty lines
    this.form.reset({
      entry_type: 'manual',
      fiscal_period_id: null,
      entry_date: toLocalDateString(),
      description: '',
    });
    while (this.lines.length > 0) {
      this.lines.removeAt(0);
    }
    this.lines.push(this.createLineGroup());
    this.lines.push(this.createLineGroup());
  }
}
