import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { Router } from '@angular/router';
import {
  ButtonComponent,
  IconComponent,
  StatsComponent,
  InputsearchComponent,
  DialogService,
  ToastService,
  CardComponent,
} from '../../../../../../shared/components';
import { BankReconciliationService } from '../../services/bank-reconciliation.service';
import { BankAccount } from '../../interfaces/accounting.interface';
import { BankAccountFormModalComponent } from './bank-account-form-modal.component';
import { StatementImportModalComponent } from './statement-import-modal.component';

@Component({
  selector: 'vendix-bank-accounts',
  standalone: true,
  imports: [
    CommonModule,
    ButtonComponent,
    IconComponent,
    StatsComponent,
    InputsearchComponent,
    CardComponent,
    BankAccountFormModalComponent,
    StatementImportModalComponent,
    CurrencyPipe,
  ],
  template: `
    <div class="w-full">
      <!-- Stats -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total Cuentas"
          [value]="stats().total"
          iconName="landmark"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
          [clickable]="false"
        ></app-stats>
        <app-stats
          title="Activas"
          [value]="stats().active"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-600"
          [clickable]="false"
        ></app-stats>
        <app-stats
          title="Balance Total"
          [value]="stats().total_balance"
          iconName="dollar-sign"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
          [clickable]="false"
          prefix="$"
        ></app-stats>
        <app-stats
          title="Tx. Pendientes"
          [value]="stats().pending_transactions"
          iconName="clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
          [clickable]="false"
        ></app-stats>
      </div>

      <!-- Container -->
      <app-card
        [responsive]="true"
        [padding]="false"
        customClasses="md:min-h-[400px]"
      >
        <!-- Search Header -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                    md:mt-0 md:static md:bg-transparent md:px-4 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide
                       md:text-lg md:font-semibold md:text-text-primary"
            >
              Cuentas Bancarias ({{ filteredAccounts().length }})
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                placeholder="Buscar cuenta..."
                [debounceTime]="300"
                (searchChange)="onSearch($event)"
              ></app-inputsearch>
              <app-button
                variant="outline"
                size="sm"
                (clicked)="openImportModal()"
              >
                <app-icon name="upload" [size]="16" slot="icon"></app-icon>
                <span class="hidden sm:inline">Importar</span>
              </app-button>
              <app-button
                variant="outline"
                size="sm"
                (clicked)="navigateToReconciliations()"
              >
                <app-icon name="git-merge" [size]="16" slot="icon"></app-icon>
                <span class="hidden sm:inline">Conciliaciones</span>
              </app-button>
              <app-button
                variant="primary"
                size="sm"
                (clicked)="openCreateModal()"
              >
                <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                <span class="hidden sm:inline">Nueva Cuenta</span>
                <span class="sm:hidden">Nueva</span>
              </app-button>
            </div>
          </div>
        </div>

        <!-- Data Content -->
        <div class="relative p-2 md:p-4">
          @if (loading()) {
            <div
              class="absolute inset-0 bg-surface/50 z-10 flex items-center justify-center"
            >
              <div
                class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
              ></div>
            </div>
          }

          <!-- Table Header (desktop) -->
          <div
            class="hidden md:grid md:grid-cols-12 gap-2 px-4 py-3 bg-gray-50 rounded-lg
                      text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1"
          >
            <div class="col-span-3">Nombre</div>
            <div class="col-span-2">Banco</div>
            <div class="col-span-2">No. Cuenta</div>
            <div class="col-span-2 text-right">Balance Actual</div>
            <div class="col-span-1 text-center">Estado</div>
            <div class="col-span-2 text-right">Acciones</div>
          </div>

          @if (filteredAccounts().length === 0) {
            <div
              class="flex flex-col items-center justify-center py-16 text-gray-400"
            >
              <app-icon name="landmark" [size]="48"></app-icon>
              <p class="mt-4 text-base">No se encontraron cuentas bancarias</p>
              <p class="text-sm">
                {{
                  searchTerm()
                    ? 'Intenta con otro termino de busqueda.'
                    : 'Crea tu primera cuenta bancaria para comenzar.'
                }}
              </p>
            </div>
          } @else {
            <div class="divide-y divide-border">
              @for (account of filteredAccounts(); track account.id) {
                <!-- Mobile Card -->
                <div
                  class="md:hidden p-3 mx-2 my-1 bg-surface rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.07)]"
                >
                  <div class="flex items-center justify-between">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span
                          class="text-[15px] font-bold text-text-primary truncate"
                          >{{ account.name }}</span
                        >
                        <span
                          class="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                          [class]="
                            account.status === 'active'
                              ? 'bg-emerald-50 text-emerald-600'
                              : 'bg-gray-100 text-gray-400'
                          "
                        >
                          {{ getStatusLabel(account.status) }}
                        </span>
                      </div>
                      <div class="flex items-center gap-2 mt-1">
                        <span class="text-xs text-gray-500">{{
                          account.bank_name
                        }}</span>
                        <span class="text-xs font-mono text-gray-400">{{
                          account.account_number
                        }}</span>
                      </div>
                      <div class="mt-1">
                        <span
                          class="text-sm font-semibold"
                          [class]="
                            account.current_balance >= 0
                              ? 'text-emerald-600'
                              : 'text-red-500'
                          "
                        >
                          {{
                            account.current_balance
                              | currency: 'COP' : 'symbol-narrow' : '1.0-0'
                          }}
                        </span>
                        @if (account.unreconciled_count) {
                          <span
                            class="ml-2 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-bold"
                          >
                            {{ account.unreconciled_count }} pendientes
                          </span>
                        }
                      </div>
                    </div>
                    <div class="flex items-center gap-1 ml-2">
                      <button
                        (click)="editAccount(account)"
                        class="p-1.5 rounded border border-blue-200 bg-blue-50 text-blue-500 hover:bg-blue-100"
                      >
                        <app-icon name="edit" [size]="14"></app-icon>
                      </button>
                      <button
                        (click)="onDeleteAccount(account)"
                        class="p-1.5 rounded border border-red-200 bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-500"
                      >
                        <app-icon name="trash-2" [size]="14"></app-icon>
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Desktop Row -->
                <div
                  class="hidden md:grid md:grid-cols-12 gap-2 px-4 py-2.5 items-center hover:bg-gray-50 transition-colors"
                >
                  <div
                    class="col-span-3 text-sm text-text-primary font-medium truncate"
                  >
                    {{ account.name }}
                  </div>
                  <div class="col-span-2 text-sm text-gray-600 truncate">
                    {{ account.bank_name }}
                  </div>
                  <div class="col-span-2 text-sm font-mono text-gray-500">
                    {{ account.account_number }}
                  </div>
                  <div
                    class="col-span-2 text-sm text-right font-semibold"
                    [class]="
                      account.current_balance >= 0
                        ? 'text-emerald-600'
                        : 'text-red-500'
                    "
                  >
                    {{
                      account.current_balance
                        | currency: 'COP' : 'symbol-narrow' : '1.0-0'
                    }}
                    @if (account.unreconciled_count) {
                      <span
                        class="ml-1 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-bold"
                      >
                        {{ account.unreconciled_count }}
                      </span>
                    }
                  </div>
                  <div class="col-span-1 text-center">
                    <span
                      class="text-xs px-2 py-0.5 rounded-full"
                      [class]="
                        account.status === 'active'
                          ? 'bg-emerald-50 text-emerald-600'
                          : account.status === 'closed'
                            ? 'bg-red-50 text-red-500'
                            : 'bg-gray-100 text-gray-400'
                      "
                    >
                      {{ getStatusLabel(account.status) }}
                    </span>
                  </div>
                  <div class="col-span-2 flex items-center justify-end gap-1">
                    <button
                      (click)="editAccount(account)"
                      class="p-1.5 hover:bg-gray-100 rounded text-gray-500 hover:text-primary"
                    >
                      <app-icon name="edit" [size]="14"></app-icon>
                    </button>
                    <button
                      (click)="onDeleteAccount(account)"
                      class="p-1.5 hover:bg-red-50 rounded text-gray-400 hover:text-red-500"
                    >
                      <app-icon name="trash-2" [size]="14"></app-icon>
                    </button>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      </app-card>

      <!-- Modals -->
      <vendix-bank-account-form-modal
        [isOpen]="isFormModalOpen()"
        (isOpenChange)="isFormModalOpen.set($event)"
        [editAccount]="selectedAccount()"
        (saved)="onAccountSaved()"
      ></vendix-bank-account-form-modal>

      <vendix-statement-import-modal
        [isOpen]="isImportModalOpen()"
        (isOpenChange)="isImportModalOpen.set($event)"
        [bankAccounts]="accounts()"
        (importComplete)="loadAccounts()"
      ></vendix-statement-import-modal>
    </div>
  `,
})
export class BankAccountsComponent implements OnInit {
  private reconciliationService = inject(BankReconciliationService);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);
  private router = inject(Router);

  accounts = signal<BankAccount[]>([]);
  loading = signal(false);
  searchTerm = signal('');
  isFormModalOpen = signal(false);
  isImportModalOpen = signal(false);
  selectedAccount = signal<BankAccount | null>(null);

  filteredAccounts = computed(() => {
    const term = this.searchTerm().toLowerCase();
    if (!term) return this.accounts();
    return this.accounts().filter(
      (a) =>
        a.name.toLowerCase().includes(term) ||
        a.bank_name.toLowerCase().includes(term) ||
        a.account_number.toLowerCase().includes(term),
    );
  });

  stats = computed(() => {
    const all = this.accounts();
    return {
      total: all.length,
      active: all.filter((a) => a.status === 'active').length,
      total_balance: all.reduce((sum, a) => sum + (a.current_balance || 0), 0),
      pending_transactions: all.reduce(
        (sum, a) => sum + (a.unreconciled_count || 0),
        0,
      ),
    };
  });

  ngOnInit(): void {
    this.loadAccounts();
  }

  loadAccounts(): void {
    this.loading.set(true);
    this.reconciliationService.getBankAccounts().subscribe({
      next: (res) => {
        this.accounts.set(res.data || []);
        this.loading.set(false);
      },
      error: () => {
        this.toastService.error('Error al cargar las cuentas bancarias');
        this.loading.set(false);
      },
    });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
  }

  openCreateModal(): void {
    this.selectedAccount.set(null);
    this.isFormModalOpen.set(true);
  }

  editAccount(account: BankAccount): void {
    this.selectedAccount.set(account);
    this.isFormModalOpen.set(true);
  }

  onDeleteAccount(account: BankAccount): void {
    this.dialogService
      .confirm({
        title: 'Eliminar Cuenta Bancaria',
        message: `¿Estas seguro de que deseas eliminar la cuenta "${account.name}"?`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
      })
      .then((confirmed) => {
        if (!confirmed) return;
        this.reconciliationService.deleteBankAccount(account.id).subscribe({
          next: () => {
            this.toastService.success('Cuenta bancaria eliminada');
            this.loadAccounts();
          },
          error: () => {
            this.toastService.error('Error al eliminar la cuenta bancaria');
          },
        });
      });
  }

  onAccountSaved(): void {
    this.loadAccounts();
    this.isFormModalOpen.set(false);
  }

  openImportModal(): void {
    this.isImportModalOpen.set(true);
  }

  navigateToReconciliations(): void {
    this.router.navigate([
      '/store/accounting/bank-reconciliation/reconciliations',
    ]);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      active: 'Activa',
      inactive: 'Inactiva',
      closed: 'Cerrada',
    };
    return labels[status] || status;
  }
}
