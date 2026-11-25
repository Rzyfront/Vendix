import {
  Component,
  inject,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
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
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { BankReconciliationService } from '../../services/bank-reconciliation.service';
import {
  BankAccount,
  BankAccountScopeContext,
} from '../../interfaces/accounting.interface';
import { BankAccountFormModalComponent } from './bank-account-form-modal.component';
import { StatementImportModalComponent } from './statement-import-modal.component';

@Component({
  selector: 'vendix-bank-accounts',
  standalone: true,
  imports: [
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

      <!-- Scope ORGANIZATION read-only notice for store admins -->
      @if (isOrgScope() && !canCreateAccount()) {
        <div
          class="mb-3 flex items-start gap-2.5 rounded-xl border border-info/30 bg-info-light px-4 py-3 text-xs text-text-primary"
        >
          <app-icon
            name="info"
            [size]="16"
            class="mt-0.5 shrink-0 text-info"
          ></app-icon>
          <div>
            <span class="font-semibold">Cuentas administradas por la organización:</span>
            solo ves las cuentas asignadas a esta tienda. Para crear, editar o asignar cuentas, solicita a un administrador de la organización.
          </div>
        </div>
      }

      <!-- Non-blocking warning for duplicate numbers after scope change -->
      @if (duplicateWarnings().length > 0) {
        <div
          class="mb-3 rounded-xl border border-warning/40 bg-warning-light px-4 py-3 text-xs text-text-primary space-y-2"
        >
          <div class="flex items-start gap-2.5">
            <app-icon
              name="alert-triangle"
              [size]="16"
              class="mt-0.5 shrink-0 text-warning"
            ></app-icon>
            <div class="space-y-1">
              <p class="font-semibold">
                Números de cuenta repetidos entre tiendas ({{ duplicateWarnings().length }})
              </p>
              <p class="text-text-secondary">
                Esta organización opera con contabilidad consolidada y conserva cuentas previas de distintas tiendas con el mismo número. Siguen funcionando sin bloquear cobros; revísalas para consolidar o cerrar las que no necesites.
              </p>
            </div>
          </div>
          <ul class="pl-6 list-disc space-y-1">
            @for (warning of duplicateWarnings(); track warning.account_number) {
              <li>
                <span class="font-mono font-semibold">{{ warning.account_number }}</span>:
                @for (acc of warning.accounts; track acc.id; let last = $last) {
                  <span>
                    {{ acc.name }} ({{ acc.store_name || 'Organización' }})@if (!last) {, }
                  </span>
                }
              </li>
            }
          </ul>
        </div>
      }

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
              @if (canImportStatements()) {
                <app-button
                  variant="outline"
                  size="sm"
                  (clicked)="openImportModal()"
                >
                  <app-icon name="upload" [size]="16" slot="icon"></app-icon>
                  <span class="hidden sm:inline">Importar</span>
                </app-button>
              }
              <app-button
                variant="outline"
                size="sm"
                (clicked)="navigateToReconciliations()"
              >
                <app-icon name="git-merge" [size]="16" slot="icon"></app-icon>
                <span class="hidden sm:inline">Conciliaciones</span>
              </app-button>
              <app-button
                variant="outline"
                size="sm"
                (clicked)="navigateToUnassignedPayments()"
              >
                <app-icon name="circle-alert" [size]="16" slot="icon"></app-icon>
                <span class="hidden sm:inline">Pagos sin asignar</span>
              </app-button>
              @if (canCreateAccount()) {
                <app-button
                  variant="primary"
                  size="sm"
                  (clicked)="openCreateModal()"
                >
                  <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                  <span class="hidden sm:inline">Nueva Cuenta</span>
                  <span class="sm:hidden">Nueva</span>
                </app-button>
              }
            </div>
          </div>
        </div>

        <!-- Data Content -->
        <div class="relative p-2 md:p-4">
          @if (loading()) {
            <div
              class="absolute inset-0 bg-[color-mix(in_srgb,var(--color-surface)_50%,transparent)] z-10 flex items-center justify-center"
            >
              <div
                class="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary)]"
              ></div>
            </div>
          }

          <!-- Table Header (desktop) -->
          <div
            class="hidden md:grid md:grid-cols-12 gap-2 px-4 py-3 bg-[var(--color-surface-secondary)] rounded-lg
                      text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1"
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
              class="flex flex-col items-center justify-center py-16 text-text-secondary"
            >
              <app-icon name="landmark" [size]="48"></app-icon>
              <p class="mt-4 text-base">No se encontraron cuentas bancarias</p>
              <p class="text-sm">
                {{
                  searchTerm()
                    ? 'Intenta con otro termino de busqueda.'
                    : canCreateAccount()
                      ? 'Crea tu primera cuenta bancaria para comenzar.'
                      : 'No hay cuentas asignadas a esta tienda.'
                }}
              </p>
            </div>
          } @else {
            <div class="divide-y divide-border">
              @for (account of filteredAccounts(); track account.id) {
                <!-- Mobile Card -->
                <div
                  class="md:hidden p-3 mx-2 my-1 bg-[var(--color-surface)] rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.07)]"
                >
                  <div class="flex items-center justify-between">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span
                          class="text-[15px] font-bold text-text-primary truncate"
                          >{{ account.name }}</span
                        >
                        <span
                          class="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                          [class]="
                            account.status === 'active'
                              ? 'bg-success-light text-success'
                              : 'bg-[var(--color-surface-secondary)] text-text-secondary'
                          "
                        >
                          {{ getStatusLabel(account.status) }}
                        </span>
                      </div>
                      <div class="flex items-center gap-2 mt-1 flex-wrap">
                        <span class="text-xs text-text-secondary">{{
                          account.bank_name
                        }}</span>
                        <span class="text-xs font-mono text-text-secondary">{{
                          account.account_number
                        }}</span>
                      </div>
                      @if (isOrgScope()) {
                        <div class="mt-1">
                          <span
                            class="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-surface-secondary)] text-text-secondary"
                          >
                            {{ getAvailabilityLabel(account) }}
                          </span>
                        </div>
                      }
                      <div class="mt-1">
                        <span
                          class="text-sm font-semibold"
                          [class]="
                            account.current_balance >= 0
                              ? 'text-success'
                              : 'text-error'
                          "
                        >
                          {{ account.current_balance | currency: 0 }}
                        </span>
                        @if (account.unreconciled_count) {
                          <span
                            class="ml-2 text-[10px] bg-warning-light text-warning px-1.5 py-0.5 rounded-full font-bold"
                          >
                            {{ account.unreconciled_count }} pendientes
                          </span>
                        }
                      </div>
                    </div>
                    @if (account.can_edit !== false) {
                      <div class="flex items-center gap-1 ml-2">
                        <button
                          (click)="editAccount(account)"
                          class="p-1.5 rounded border border-[var(--color-info)] bg-[var(--color-info-light)] text-[var(--color-info)] hover:opacity-90"
                        >
                          <app-icon name="edit" [size]="14"></app-icon>
                        </button>
                        <button
                          (click)="onDeleteAccount(account)"
                          class="p-1.5 rounded border border-error bg-error-light text-error hover:opacity-90"
                        >
                          <app-icon name="trash-2" [size]="14"></app-icon>
                        </button>
                      </div>
                    }
                  </div>
                </div>

                <!-- Desktop Row -->
                <div
                  class="hidden md:grid md:grid-cols-12 gap-2 px-4 py-2.5 items-center hover:bg-[var(--color-surface-secondary)] transition-colors"
                >
                  <div class="col-span-3 min-w-0">
                    <div class="text-sm text-text-primary font-medium truncate">
                      {{ account.name }}
                    </div>
                    @if (isOrgScope()) {
                      <div class="text-[11px] text-text-secondary truncate mt-0.5">
                        {{ getAvailabilityLabel(account) }}
                      </div>
                    }
                  </div>
                  <div class="col-span-2 text-sm text-gray-600 truncate">
                    {{ account.bank_name }}
                  </div>
                  <div class="col-span-2 text-sm font-mono text-text-secondary">
                    {{ account.account_number }}
                  </div>
                  <div
                    class="col-span-2 text-sm text-right font-semibold"
                    [class]="
                      account.current_balance >= 0
                        ? 'text-success'
                        : 'text-error'
                    "
                  >
                    {{ account.current_balance | currency: 0 }}
                    @if (account.unreconciled_count) {
                      <span
                        class="ml-1 text-[10px] bg-warning-light text-warning px-1.5 py-0.5 rounded-full font-bold"
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
                          ? 'bg-success-light text-success'
                          : account.status === 'closed'
                            ? 'bg-error-light text-error'
                            : 'bg-[var(--color-surface-secondary)] text-text-secondary'
                      "
                    >
                      {{ getStatusLabel(account.status) }}
                    </span>
                  </div>
                  <div class="col-span-2 flex items-center justify-end gap-1">
                    @if (account.can_edit !== false) {
                      <button
                        (click)="editAccount(account)"
                        class="p-1.5 hover:bg-[var(--color-surface-secondary)] rounded text-text-secondary hover:text-[var(--color-primary)]"
                      >
                        <app-icon name="edit" [size]="14"></app-icon>
                      </button>
                      <button
                        (click)="onDeleteAccount(account)"
                        class="p-1.5 hover:bg-error-light rounded text-text-secondary hover:text-error"
                      >
                        <app-icon name="trash-2" [size]="14"></app-icon>
                      </button>
                    } @else {
                      <span class="text-xs text-text-secondary">Solo lectura</span>
                    }
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
        [fiscalScope]="scopeContext()?.fiscal_scope ?? 'STORE'"
        [orgStores]="scopeContext()?.stores ?? []"
        (saved)="onAccountSaved()"
      ></vendix-bank-account-form-modal>

      <vendix-statement-import-modal
        [isOpen]="isImportModalOpen()"
        (isOpenChange)="isImportModalOpen.set($event)"
        [bankAccounts]="editableAccounts()"
        (importComplete)="loadAccounts()"
      ></vendix-statement-import-modal>
    </div>
  `,
})
export class BankAccountsComponent {
  private destroyRef = inject(DestroyRef);
  private reconciliationService = inject(BankReconciliationService);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);
  private router = inject(Router);

  accounts = signal<BankAccount[]>([]);
  scopeContext = signal<BankAccountScopeContext | null>(null);
  scopeContextFailed = signal(false);
  loading = signal(false);
  searchTerm = signal('');
  isFormModalOpen = signal(false);
  isImportModalOpen = signal(false);
  selectedAccount = signal<BankAccount | null>(null);

  isOrgScope = computed(
    () => this.scopeContext()?.fiscal_scope === 'ORGANIZATION',
  );

  canCreateAccount = computed(
    () => this.scopeContext()?.can_manage_accounts ?? this.scopeContextFailed(),
  );

  editableAccounts = computed(() =>
    this.accounts().filter((a) => a.can_edit !== false),
  );

  canImportStatements = computed(
    () => this.canCreateAccount() || this.editableAccounts().length > 0,
  );

  duplicateWarnings = computed(
    () => this.scopeContext()?.duplicate_number_warnings ?? [],
  );

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

  constructor() {
    this.loadAccounts();
  }

  loadAccounts(): void {
    this.loading.set(true);
    this.reconciliationService
      .getBankAccountScopeContext()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.scopeContextFailed.set(false);
          this.scopeContext.set(res.data || null);
        },
        error: () => {
          // Conservador: si el endpoint falla, no bloquea el listado ni la creación.
          this.scopeContextFailed.set(true);
        },
      });

    this.reconciliationService
      .getBankAccounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
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
    if (!this.canCreateAccount()) return;
    this.selectedAccount.set(null);
    this.isFormModalOpen.set(true);
  }

  editAccount(account: BankAccount): void {
    if (account.can_edit === false) return;
    this.selectedAccount.set(account);
    this.isFormModalOpen.set(true);
  }

  onDeleteAccount(account: BankAccount): void {
    if (account.can_edit === false) return;
    this.dialogService
      .confirm({
        title: 'Eliminar Cuenta Bancaria',
        message: `¿Estas seguro de que deseas eliminar la cuenta "${account.name}"?`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
      })
      .then((confirmed) => {
        if (!confirmed) return;
        this.reconciliationService
          .deleteBankAccount(account.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.toastService.success('Cuenta bancaria eliminada');
              this.loadAccounts();
            },
            error: (err) => {
              const parsed = parseApiError(err);
              this.toastService.error(
                parsed.userMessage || 'Error al eliminar la cuenta bancaria',
              );
            },
          });
      });
  }

  onAccountSaved(): void {
    this.loadAccounts();
    this.isFormModalOpen.set(false);
  }

  openImportModal(): void {
    if (!this.canImportStatements()) return;
    this.isImportModalOpen.set(true);
  }

  navigateToReconciliations(): void {
    this.router.navigate([
      '/store/accounting/bank-reconciliation/reconciliations',
    ]);
  }

  navigateToUnassignedPayments(): void {
    this.router.navigate([
      '/store/accounting/bank-reconciliation/unassigned-payments',
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

  getAvailabilityLabel(account: BankAccount): string {
    if (account.store_id !== null && account.store_id !== undefined) {
      return account.store?.name
        ? `Solo tienda: ${account.store.name}`
        : 'Solo tienda';
    }
    if (account.available_in_all_stores !== false) {
      return 'Todas las tiendas';
    }
    const assigned = account.store_assignments ?? [];
    if (assigned.length === 0) {
      const ids = account.assigned_store_ids ?? [];
      return ids.length === 1 ? '1 tienda' : `${ids.length} tiendas`;
    }
    if (assigned.length <= 2) {
      return assigned
        .map((a) => a.store?.name || `Tienda #${a.store_id}`)
        .join(', ');
    }
    return `${assigned.length} tiendas`;
  }
}
