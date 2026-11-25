import {
  Component,
  inject,
  signal,
  computed,
  effect,
  input,
  output,
  DestroyRef,
} from '@angular/core';
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
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { BankReconciliationService } from '../../services/bank-reconciliation.service';
import { AccountingService } from '../../services/accounting.service';
import {
  BankAccount,
  BankAccountPayload,
  BankAccountScopeStore,
  ChartAccount,
} from '../../interfaces/accounting.interface';

@Component({
  selector: 'vendix-bank-account-form-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
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
            label="Número de Cuenta o Llave"
            placeholder="Ej: 12345678901, correo, celular o llave"
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

        <!-- Store Availability (only in ORGANIZATION fiscal scope for org-level accounts) -->
        @if (showStoreAssignment()) {
          <div class="space-y-2.5 pt-2 border-t border-border">
            <label class="block text-sm font-medium text-text-primary">
              Disponible en
            </label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                (click)="setAvailabilityMode(true)"
                class="flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left text-sm transition-colors"
                [class]="
                  availableInAllStores()
                    ? 'border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] text-text-primary font-medium'
                    : 'border-border bg-[var(--color-surface)] text-text-secondary hover:bg-[var(--color-surface-secondary)]'
                "
              >
                <app-icon name="globe" [size]="16"></app-icon>
                <span>Todas las tiendas</span>
              </button>
              <button
                type="button"
                (click)="setAvailabilityMode(false)"
                class="flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left text-sm transition-colors"
                [class]="
                  !availableInAllStores()
                    ? 'border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] text-text-primary font-medium'
                    : 'border-border bg-[var(--color-surface)] text-text-secondary hover:bg-[var(--color-surface-secondary)]'
                "
              >
                <app-icon name="store" [size]="16"></app-icon>
                <span>Estas tiendas</span>
              </button>
            </div>

            @if (!availableInAllStores()) {
              <div
                class="rounded-lg border border-border bg-[var(--color-surface-secondary)] p-3 space-y-2"
              >
                <p class="text-xs text-text-secondary">
                  Selecciona las tiendas donde esta cuenta estará disponible en métodos de pago, POS y tienda en línea:
                </p>
                @if (orgStores().length === 0) {
                  <p class="text-xs text-warning">
                    No hay tiendas activas disponibles en la organización.
                  </p>
                } @else {
                  <div class="max-h-40 overflow-y-auto space-y-1.5">
                    @for (store of orgStores(); track store.id) {
                      <label
                        class="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-[var(--color-surface)] cursor-pointer text-sm text-text-primary"
                      >
                        <input
                          type="checkbox"
                          class="rounded border-border text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                          [checked]="isStoreSelected(store.id)"
                          (change)="toggleStoreSelection(store.id)"
                        />
                        <span class="truncate">{{ store.name }}</span>
                        @if (store.store_code) {
                          <span class="text-xs text-text-secondary font-mono">
                            ({{ store.store_code }})
                          </span>
                        }
                      </label>
                    }
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>

      <div slot="footer" class="flex justify-end gap-3 pt-4 border-t border-border mt-4">
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
  readonly fiscalScope = input<'STORE' | 'ORGANIZATION'>('STORE');
  readonly orgStores = input<BankAccountScopeStore[]>([]);
  readonly isOpenChange = output<boolean>();
  readonly saved = output<void>();

  private reconciliationService = inject(BankReconciliationService);
  private accountingService = inject(AccountingService);
  private toastService = inject(ToastService);

  saving = signal(false);
  chartAccounts = signal<ChartAccount[]>([]);
  chartAccountOptions = signal<SelectorOption[]>([]);
  availableInAllStores = signal(true);
  selectedStoreIds = signal<number[]>([]);

  showStoreAssignment = computed(() => {
    if (this.fiscalScope() !== 'ORGANIZATION') return false;
    const acct = this.editAccount();
    return !acct || acct.store_id === null || acct.store_id === undefined;
  });

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
          const inAll = acct.available_in_all_stores !== false;
          this.availableInAllStores.set(inAll);
          const assigned =
            acct.assigned_store_ids ??
            (acct.store_assignments ?? []).map((s) => s.store_id);
          this.selectedStoreIds.set([...assigned]);
        } else {
          this.resetForm();
        }
      }
    });
    this.loadChartAccounts();
  }

  setAvailabilityMode(allStores: boolean): void {
    this.availableInAllStores.set(allStores);
  }

  isStoreSelected(storeId: number): boolean {
    return this.selectedStoreIds().includes(storeId);
  }

  toggleStoreSelection(storeId: number): void {
    this.selectedStoreIds.update((current) =>
      current.includes(storeId)
        ? current.filter((id) => id !== storeId)
        : [...current, storeId],
    );
  }

  private loadChartAccounts(): void {
    this.accountingService
      .getChartOfAccounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
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
    if (
      !this.form['name'] ||
      !this.form['bank_name'] ||
      !this.form['account_number']
    ) {
      this.toastService.error('Por favor completa los campos obligatorios');
      return;
    }

    if (
      this.showStoreAssignment() &&
      !this.availableInAllStores() &&
      this.selectedStoreIds().length === 0
    ) {
      this.toastService.error(
        'Selecciona al menos una tienda para asignar esta cuenta',
      );
      return;
    }

    this.saving.set(true);
    const dto: BankAccountPayload = { ...this.form };
    if (!dto.chart_account_id) delete dto.chart_account_id;
    if (!dto.bank_code) delete dto.bank_code;

    if (this.showStoreAssignment()) {
      dto.available_in_all_stores = this.availableInAllStores();
      dto.store_ids = this.availableInAllStores()
        ? []
        : [...this.selectedStoreIds()];
    }

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
      error: (err) => {
        const parsed = parseApiError(err);
        this.toastService.error(
          parsed.userMessage || 'Error al guardar la cuenta bancaria',
        );
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
    this.availableInAllStores.set(true);
    this.selectedStoreIds.set([]);
  }
}
