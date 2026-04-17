import {Component, inject, input, output,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';


import { AccountingService } from '../../../services/accounting.service';
import { FiscalPeriod } from '../../../interfaces/accounting.interface';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  TextareaComponent,
  ToastService} from '../../../../../../../shared/components/index';

@Component({
  selector: 'vendix-budget-create-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent
],
  templateUrl: './budget-create-modal.component.html',
  styleUrls: ['./budget-create-modal.component.scss']})
export class BudgetCreateModalComponent implements {
  private destroyRef = inject(DestroyRef);
private fb = inject(FormBuilder);
  private accounting_service = inject(AccountingService);
  private toast_service = inject(ToastService);
  private router = inject(Router);

  readonly isOpen = input(false);
  readonly isOpenChange = output<boolean>();
  readonly created = output<void>();

  fiscal_periods: SelectorOption[] = [];
  is_submitting = false;

  form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(3)]],
    description: [''],
    fiscal_period_id: [null as number | null, [Validators.required]],
    variance_threshold: [10, [Validators.min(0), Validators.max(100)]]});

  constructor() {
    this.loadFiscalPeriods();
  }
private loadFiscalPeriods(): void {
    this.accounting_service
      .getFiscalPeriods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const periods: FiscalPeriod[] = res.data || [];
          this.fiscal_periods = periods.map((p) => ({
            value: p.id,
            label: p.name}));
        }});
  }

  onSubmit(): void {
    if (this.form.invalid) return;

    this.is_submitting = true;
    const dto = this.form.value;

    this.accounting_service
      .createBudget(dto as any)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.toast_service.show({ variant: 'success', description: 'Presupuesto creado' });
          this.is_submitting = false;
          this.form.reset({ variance_threshold: 10 });
          this.isOpenChange.emit(false);
          this.created.emit();
          // Navigate to editor
          if (res.data?.id) {
            this.router.navigate(['/store/accounting/budgets', res.data.id, 'editor']);
          }
        },
        error: () => {
          this.toast_service.show({ variant: 'error', description: 'Error al crear presupuesto' });
          this.is_submitting = false;
        }});
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }
}
