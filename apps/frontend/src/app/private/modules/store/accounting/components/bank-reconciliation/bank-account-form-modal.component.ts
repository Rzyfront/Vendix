import {Component, inject, signal, effect, input, output, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  ToastService,
} from '../../../../../../shared/components';
import type { SelectorOption } from '../../../../../../shared/components';
import { BankReconciliationService } from '../../services/bank-reconciliation.service';
import { AccountingService } from '../../services/accounting.service';
import { BankAccount, ChartAccount } from '../../interfaces/accounting.interface';

@Component({
  selector: 'vendix-bank-account-form-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      [title]="editAccount() ? 'Editar Cuenta Bancaria' : 'Nueva Cuenta Bancaria'"
    >
      <div class="space-y-4">
        <!-- Name -->
        <app-input
          label="Nombre de la Cuenta"
          placeholder="Ej: Cuenta Corriente Bancolombia"
          [(ngModel)]="form['name']"
          [required]="true"
        ></app-input>

        <!-- Bank Name + Bank Code -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-input
            label="Nombre del Banco"
            placeholder="Ej: Bancolombia"
            [(ngModel)]="form['bank_name']"
            [required]="true"
          ></app-input>
          <app-input
            label="Codigo del Banco"
            placeholder="Ej: 007"
            [(ngModel)]="form['bank_code']"
          ></app-input>
        </div>

        <!-- Account Number + Currency -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-input
            label="Numero de Cuenta"
            placeholder="Ej: 12345678901"
            [(ngModel)]="form['account_number']"
            [required]="true"
          ></app-input>
          <app-selector
            label="Moneda"
            [options]="currencyOptions"
            [(ngModel)]="form['currency']"
          ></app-selector>
        </div>

        <!-- Opening Balance -->
        <app-input
          label="Saldo Inicial"
          type="number"
          placeholder="0"
          [(ngModel)]="form['opening_balance']"
        ></app-input>

        <!-- Chart Account -->
        <app-selector
          label="Cuenta Contable Asociada"
          placeholder="Seleccionar cuenta contable..."
          [options]="chartAccountOptions()"
          [(ngModel)]="form['chart_account_id']"
        ></app-selector>
      </div>

      <div slot="footer" class="flex justify-end gap-3 pt-4 border-t border-gray-200 mt-4">
        <app-button variant="outline" (clicked)="onCancel()">Cancelar</app-button>
        <app-button variant="primary" (clicked)="onSave()" [disabled]="saving()">
          <app-icon name="save" [size]="16" slot="icon"></app-icon>
          {{ editAccount() ? 'Guardar Cambios' : 'Crear Cuenta' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class BankAccountFormModalComponent {
  private destroyRef = inject(DestroyRef);
  readonly isOpen = input(false);
  readonly editAccount = input<BankAccount | null>(null);
  readonly isOpenChange = output<boolean>();
  readonly saved = output<void>();

  private reconciliationService = inject(BankReconciliationService);
  private accountingService = inject(AccountingService);
  private toastService = inject(ToastService);

  saving = signal(false);
  chartAccounts = signal<ChartAccount[]>([]);
  chartAccountOptions = signal<SelectorOption[]>([]);

  form: Record<string, any> = {
    name: '',
    bank_name: '',
    bank_code: '',
    account_number: '',
    currency: 'COP',
    opening_balance: 0,
    chart_account_id: null,
  };

  currencyOptions: SelectorOption[] = [
    { value: 'COP', label: 'COP - Peso Colombiano' },
    { value: 'USD', label: 'USD - Dolar Estadounidense' },
    { value: 'EUR', label: 'EUR - Euro' },
  ];

  constructor() {
    effect(() => {
      // This runs when isOpen changes through Angular's change detection
    });
    this.loadChartAccounts();
  }

  ngOnChanges(): void {
    if (this.isOpen()) {
      const acct = this.editAccount();
      if (acct) {
        this.form = {
          name: acct.name || '',
          bank_name: acct.bank_name || '',
          bank_code: acct.bank_code || '',
          account_number: acct.account_number || '',
          currency: acct.currency || 'COP',
          opening_balance: acct.opening_balance || 0,
          chart_account_id: acct.chart_account_id || null,
        };
      } else {
        this.resetForm();
      }
    }
  }

  private loadChartAccounts(): void {
    this.accountingService.getChartOfAccounts().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        const flat = this.flattenAccounts(res.data || []);
        this.chartAccounts.set(flat);
        this.chartAccountOptions.set(
          flat
            .filter((a) => a.accepts_entries)
            .map((a) => ({
              value: a.id,
              label: `${a.code} - ${a.name}`,
            })),
        );
      },
    });
  }

  private flattenAccounts(accounts: ChartAccount[]): ChartAccount[] {
    const result: ChartAccount[] = [];
    for (const account of accounts) {
      result.push(account);
      if (account.children?.length) {
        result.push(...this.flattenAccounts(account.children));
      }
    }
    return result;
  }

  onSave(): void {
    if (!this.form['name'] || !this.form['bank_name'] || !this.form['account_number']) {
      this.toastService.error('Por favor completa los campos obligatorios');
      return;
    }

    this.saving.set(true);
    const dto = { ...this.form };
    if (!dto['chart_account_id']) delete dto['chart_account_id'];
    if (!dto['bank_code']) delete dto['bank_code'];

    const request$ = this.editAccount()
      ? this.reconciliationService.updateBankAccount(this.editAccount()!.id, dto)
      : this.reconciliationService.createBankAccount(dto);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toastService.success(
          this.editAccount() ? 'Cuenta actualizada' : 'Cuenta creada exitosamente',
        );
        this.saving.set(false);
        this.saved.emit();
      },
      error: () => {
        this.toastService.error('Error al guardar la cuenta bancaria');
        this.saving.set(false);
      },
    });
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  private resetForm(): void {
    this.form = {
      name: '',
      bank_name: '',
      bank_code: '',
      account_number: '',
      currency: 'COP',
      opening_balance: 0,
      chart_account_id: null,
    };
  }
}
