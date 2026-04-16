import { Component, inject, signal, computed } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ButtonComponent,
  IconComponent,
  ScrollableTabsComponent,
  DialogService,
  ToastService,
} from '../../../../../../shared/components';
import type { ScrollableTab } from '../../../../../../shared/components';
import { BankReconciliationService } from '../../services/bank-reconciliation.service';
import { AccountingService } from '../../services/accounting.service';
import {
  BankReconciliation,
  BankTransaction,
  JournalEntry,
  ReconciliationMatch,
} from '../../interfaces/accounting.interface';

type BankFilter = 'all' | 'unmatched' | 'matched';
type AccountingFilter = 'all' | 'unmatched' | 'matched';

@Component({
  selector: 'vendix-reconciliation-workspace',
  standalone: true,
  imports: [
    ButtonComponent,
    IconComponent,
    ScrollableTabsComponent,
    CurrencyPipe,
    DatePipe,
  ],
  template: `
    <div class="w-full">
      @if (loading()) {
        <div class="flex items-center justify-center py-24">
          <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
        </div>
      } @else if (reconciliation()) {
        <!-- Header -->
        <div class="bg-surface border-b border-border px-3 py-3 md:px-6 md:py-4 sticky top-0 z-20">
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div class="flex items-center gap-2">
              <button (click)="goBack()" class="p-1.5 hover:bg-gray-100 rounded text-gray-500">
                <app-icon name="arrow-left" [size]="18"></app-icon>
              </button>
              <div>
                <h1 class="text-base md:text-lg font-bold text-text-primary">
                  {{ reconciliation()!.bank_account?.name || 'Conciliacion' }}
                </h1>
                <p class="text-xs text-gray-500">
                  {{ reconciliation()!.period_start | date:'dd/MM/yyyy' }} -
                  {{ reconciliation()!.period_end | date:'dd/MM/yyyy' }}
                  <span class="ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                        [class]="getStatusClasses(reconciliation()!.status)">
                    {{ getStatusLabel(reconciliation()!.status) }}
                  </span>
                </p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <app-button variant="outline" size="sm" (clicked)="runAutoMatch()" [disabled]="autoMatching() || reconciliation()!.status === 'completed'">
                <app-icon name="zap" [size]="16" slot="icon"></app-icon>
                {{ autoMatching() ? 'Procesando...' : 'Auto-Match' }}
              </app-button>
              @if (selectedBankTx() && selectedEntry()) {
                <app-button variant="primary" size="sm" (clicked)="createManualMatch()" [disabled]="reconciliation()!.status === 'completed'">
                  <app-icon name="link" [size]="16" slot="icon"></app-icon>
                  Conciliar Manual
                </app-button>
              }
              @if (reconciliation()!.status !== 'completed') {
                <app-button variant="primary" size="sm" (clicked)="completeReconciliation()" [disabled]="reconciliation()!.difference !== 0">
                  <app-icon name="check-circle" [size]="16" slot="icon"></app-icon>
                  <span class="hidden sm:inline">Completar</span>
                </app-button>
              }
            </div>
          </div>

          <!-- Summary Bar -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
            <div class="bg-blue-50 rounded-lg px-3 py-2">
              <div class="text-[10px] text-blue-600 font-semibold uppercase">Saldo Extracto</div>
              <div class="text-sm font-bold text-blue-800">{{ reconciliation()!.statement_balance | currency:'COP':'symbol-narrow':'1.0-0' }}</div>
            </div>
            <div class="bg-emerald-50 rounded-lg px-3 py-2">
              <div class="text-[10px] text-emerald-600 font-semibold uppercase">Conciliado</div>
              <div class="text-sm font-bold text-emerald-800">{{ reconciliation()!.reconciled_balance | currency:'COP':'symbol-narrow':'1.0-0' }}</div>
            </div>
            <div class="rounded-lg px-3 py-2" [class]="reconciliation()!.difference === 0 ? 'bg-emerald-50' : 'bg-red-50'">
              <div class="text-[10px] font-semibold uppercase" [class]="reconciliation()!.difference === 0 ? 'text-emerald-600' : 'text-red-600'">Diferencia</div>
              <div class="text-sm font-bold" [class]="reconciliation()!.difference === 0 ? 'text-emerald-800' : 'text-red-800'">
                {{ reconciliation()!.difference | currency:'COP':'symbol-narrow':'1.0-0' }}
              </div>
            </div>
            <div class="bg-amber-50 rounded-lg px-3 py-2">
              <div class="text-[10px] text-amber-600 font-semibold uppercase">Pendientes</div>
              <div class="text-sm font-bold text-amber-800">
                {{ (reconciliation()!.unmatched_bank || 0) + (reconciliation()!.unmatched_accounting || 0) }}
              </div>
            </div>
          </div>
        </div>

        <!-- Mobile: Tabs -->
        <div class="md:hidden px-2 mt-2">
          <app-scrollable-tabs
            [tabs]="mobileTabs"
            [activeTab]="activeTab()"
            (tabChange)="activeTab.set($event)"
            size="sm"
          ></app-scrollable-tabs>
        </div>

        <!-- Split View (desktop) / Tabbed View (mobile) -->
        <div class="flex flex-col md:flex-row md:gap-4 p-2 md:p-4 min-h-[400px]">

          <!-- Left Panel: Bank Transactions -->
          <div class="w-full md:w-1/2" [class.hidden]="activeTab() !== 'bank'" [class.md:block]="true">
            <div class="bg-surface rounded-xl border border-border overflow-hidden">
              <div class="px-3 py-2 border-b border-border bg-gray-50 flex items-center justify-between">
                <h3 class="text-sm font-bold text-gray-700">
                  <app-icon name="building" [size]="14" class="mr-1 inline"></app-icon>
                  Transacciones Bancarias
                </h3>
                <div class="flex items-center gap-1">
                  @for (f of bankFilters; track f.id) {
                    <button
                      class="text-[10px] font-bold uppercase px-2 py-1 rounded transition-colors"
                      [class]="bankFilter() === f.id ? 'bg-primary text-white' : 'bg-white text-gray-500 hover:bg-gray-100'"
                      (click)="bankFilter.set(f.id)">
                      {{ f.label }}
                    </button>
                  }
                </div>
              </div>
              <div class="max-h-[50vh] md:max-h-[60vh] overflow-y-auto divide-y divide-border">
                @for (tx of filteredBankTxs(); track tx.id) {
                  <div
                    class="px-3 py-2 cursor-pointer transition-colors"
                    [class.bg-blue-50]="selectedBankTx()?.id === tx.id"
                    [class.border-l-4]="selectedBankTx()?.id === tx.id"
                    [class.border-l-blue-500]="selectedBankTx()?.id === tx.id"
                    [class.opacity-50]="tx.is_reconciled"
                    (click)="selectBankTx(tx)">
                    <div class="flex items-center justify-between">
                      <div class="min-w-0 flex-1">
                        <div class="text-sm text-text-primary truncate">{{ tx.description }}</div>
                        <div class="flex items-center gap-2 mt-0.5">
                          <span class="text-[10px] text-gray-400">{{ tx.transaction_date | date:'dd/MM/yyyy' }}</span>
                          @if (tx.reference) {
                            <span class="text-[10px] font-mono text-gray-400">Ref: {{ tx.reference }}</span>
                          }
                          @if (tx.is_reconciled) {
                            <span class="text-[10px] bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded font-bold">Conciliada</span>
                          }
                        </div>
                      </div>
                      <span class="text-sm font-semibold whitespace-nowrap ml-2"
                            [class]="tx.type === 'credit' ? 'text-emerald-600' : 'text-red-500'">
                        {{ tx.type === 'credit' ? '+' : '-' }}{{ tx.amount | currency:'COP':'symbol-narrow':'1.0-0' }}
                      </span>
                    </div>
                  </div>
                } @empty {
                  <div class="flex flex-col items-center justify-center py-12 text-gray-400">
                    <app-icon name="inbox" [size]="36"></app-icon>
                    <p class="mt-2 text-sm">Sin transacciones</p>
                  </div>
                }
              </div>
            </div>
          </div>

          <!-- Right Panel: Accounting Entries -->
          <div class="w-full md:w-1/2 mt-3 md:mt-0" [class.hidden]="activeTab() !== 'accounting'" [class.md:block]="true">
            <div class="bg-surface rounded-xl border border-border overflow-hidden">
              <div class="px-3 py-2 border-b border-border bg-gray-50 flex items-center justify-between">
                <h3 class="text-sm font-bold text-gray-700">
                  <app-icon name="book-open" [size]="14" class="mr-1 inline"></app-icon>
                  Asientos Contables
                </h3>
                <div class="flex items-center gap-1">
                  @for (f of accountingFilters; track f.id) {
                    <button
                      class="text-[10px] font-bold uppercase px-2 py-1 rounded transition-colors"
                      [class]="accountingFilter() === f.id ? 'bg-primary text-white' : 'bg-white text-gray-500 hover:bg-gray-100'"
                      (click)="accountingFilter.set(f.id)">
                      {{ f.label }}
                    </button>
                  }
                </div>
              </div>
              <div class="max-h-[50vh] md:max-h-[60vh] overflow-y-auto divide-y divide-border">
                @for (entry of filteredEntries(); track entry.id) {
                  <div
                    class="px-3 py-2 cursor-pointer transition-colors"
                    [class.bg-purple-50]="selectedEntry()?.id === entry.id"
                    [class.border-l-4]="selectedEntry()?.id === entry.id"
                    [class.border-l-purple-500]="selectedEntry()?.id === entry.id"
                    [class.opacity-50]="isEntryMatched(entry.id)"
                    (click)="selectEntry(entry)">
                    <div class="flex items-center justify-between">
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                          <span class="text-[10px] font-mono text-gray-400">{{ entry.entry_number }}</span>
                          <span class="text-sm text-text-primary truncate">{{ entry.description || 'Sin descripcion' }}</span>
                        </div>
                        <div class="flex items-center gap-2 mt-0.5">
                          <span class="text-[10px] text-gray-400">{{ entry.entry_date | date:'dd/MM/yyyy' }}</span>
                          <span class="text-[10px] text-gray-400">{{ entry.entry_type }}</span>
                          @if (isEntryMatched(entry.id)) {
                            <span class="text-[10px] bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded font-bold">Conciliado</span>
                          }
                        </div>
                      </div>
                      <div class="text-right ml-2 whitespace-nowrap">
                        <div class="text-sm font-semibold text-text-primary">
                          {{ entry.total_debit | currency:'COP':'symbol-narrow':'1.0-0' }}
                        </div>
                      </div>
                    </div>
                  </div>
                } @empty {
                  <div class="flex flex-col items-center justify-center py-12 text-gray-400">
                    <app-icon name="inbox" [size]="36"></app-icon>
                    <p class="mt-2 text-sm">Sin asientos contables</p>
                  </div>
                }
              </div>
            </div>
          </div>
        </div>

        <!-- Matches Section -->
        @if (matches().length > 0) {
          <div class="px-2 md:px-4 pb-4">
            <div class="bg-surface rounded-xl border border-border overflow-hidden">
              <div class="px-3 py-2 border-b border-border bg-gray-50">
                <h3 class="text-sm font-bold text-gray-700">
                  <app-icon name="link" [size]="14" class="mr-1 inline"></app-icon>
                  Partidas Conciliadas ({{ matches().length }})
                </h3>
              </div>
              <div class="max-h-[200px] overflow-y-auto divide-y divide-border">
                @for (match of matches(); track match.id) {
                  <div class="px-3 py-2 flex items-center justify-between">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 text-sm">
                        <span class="text-gray-700 truncate">{{ match.bank_transaction?.description || 'Tx #' + match.bank_transaction_id }}</span>
                        <app-icon name="arrow-right" [size]="12" class="text-gray-400 shrink-0"></app-icon>
                        <span class="text-gray-700 truncate">{{ match.accounting_entry?.entry_number || 'Asiento #' + match.accounting_entry_id }}</span>
                      </div>
                      <div class="flex items-center gap-2 mt-0.5">
                        <span class="text-[10px] px-1.5 py-0.5 rounded font-bold"
                              [class]="match.match_type === 'auto' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'">
                          {{ match.match_type === 'auto' ? 'Auto' : 'Manual' }}
                        </span>
                        @if (match.confidence_score) {
                          <span class="text-[10px] text-gray-400">{{ match.confidence_score }}% confianza</span>
                        }
                      </div>
                    </div>
                    @if (reconciliation()!.status !== 'completed') {
                      <button (click)="unmatchItem(match)" class="p-1.5 hover:bg-red-50 rounded text-gray-400 hover:text-red-500 ml-2">
                        <app-icon name="x" [size]="14"></app-icon>
                      </button>
                    }
                  </div>
                }
              </div>
            </div>
          </div>
        }
      }
    </div>
  `,
})
export class ReconciliationWorkspaceComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private reconciliationService = inject(BankReconciliationService);
  private accountingService = inject(AccountingService);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);

  loading = signal(true);
  autoMatching = signal(false);
  reconciliation = signal<BankReconciliation | null>(null);
  bankTransactions = signal<BankTransaction[]>([]);
  entries = signal<JournalEntry[]>([]);
  matches = signal<ReconciliationMatch[]>([]);

  selectedBankTx = signal<BankTransaction | null>(null);
  selectedEntry = signal<JournalEntry | null>(null);

  bankFilter = signal<BankFilter>('all');
  accountingFilter = signal<AccountingFilter>('all');
  activeTab = signal<string>('bank');

  mobileTabs: ScrollableTab[] = [
    { id: 'bank', label: 'Banco', icon: 'building' },
    { id: 'accounting', label: 'Contabilidad', icon: 'book-open' },
  ];

  bankFilters = [
    { id: 'all' as BankFilter, label: 'Todas' },
    { id: 'unmatched' as BankFilter, label: 'Pendientes' },
    { id: 'matched' as BankFilter, label: 'Conciliadas' },
  ];

  accountingFilters = [
    { id: 'all' as AccountingFilter, label: 'Todos' },
    { id: 'unmatched' as AccountingFilter, label: 'Pendientes' },
    { id: 'matched' as AccountingFilter, label: 'Conciliados' },
  ];

  private matchedEntryIds = computed(() => {
    return new Set(this.matches().map((m) => m.accounting_entry_id).filter(Boolean));
  });

  filteredBankTxs = computed(() => {
    const filter = this.bankFilter();
    const txs = this.bankTransactions();
    if (filter === 'unmatched') return txs.filter((t) => !t.is_reconciled);
    if (filter === 'matched') return txs.filter((t) => t.is_reconciled);
    return txs;
  });

  filteredEntries = computed(() => {
    const filter = this.accountingFilter();
    const all = this.entries();
    const matchedIds = this.matchedEntryIds();
    if (filter === 'unmatched') return all.filter((e) => !matchedIds.has(e.id));
    if (filter === 'matched') return all.filter((e) => matchedIds.has(e.id));
    return all;
  });

  constructor() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (id) {
      this.loadReconciliation(id);
    }
  }

  private loadReconciliation(id: number): void {
    this.loading.set(true);
    this.reconciliationService.getReconciliation(id).subscribe({
      next: (res) => {
        const data = res.data;
        this.reconciliation.set(data);
        this.bankTransactions.set(data.bank_transactions || []);
        this.matches.set(data.matches || []);
        this.loading.set(false);
        this.loadAccountingEntries(data);
      },
      error: () => {
        this.toastService.error('Error al cargar la conciliacion');
        this.loading.set(false);
      },
    });
  }

  private loadAccountingEntries(rec: BankReconciliation): void {
    this.accountingService
      .getJournalEntries({
        date_from: rec.period_start,
        date_to: rec.period_end,
        status: 'posted',
        limit: 500,
      })
      .subscribe({
        next: (res) => {
          this.entries.set(res.data || []);
        },
      });
  }

  selectBankTx(tx: BankTransaction): void {
    if (tx.is_reconciled) return;
    this.selectedBankTx.set(this.selectedBankTx()?.id === tx.id ? null : tx);
  }

  selectEntry(entry: JournalEntry): void {
    if (this.isEntryMatched(entry.id)) return;
    this.selectedEntry.set(this.selectedEntry()?.id === entry.id ? null : entry);
  }

  isEntryMatched(entryId: number): boolean {
    return this.matchedEntryIds().has(entryId);
  }

  runAutoMatch(): void {
    const rec = this.reconciliation();
    if (!rec) return;
    this.autoMatching.set(true);
    this.reconciliationService.runAutoMatch(rec.id).subscribe({
      next: (res) => {
        this.autoMatching.set(false);
        this.toastService.success(`${res.data.total_matched} partidas conciliadas automaticamente`);
        this.loadReconciliation(rec.id);
      },
      error: () => {
        this.autoMatching.set(false);
        this.toastService.error('Error al ejecutar auto-match');
      },
    });
  }

  createManualMatch(): void {
    const rec = this.reconciliation();
    const bankTx = this.selectedBankTx();
    const entry = this.selectedEntry();
    if (!rec || !bankTx || !entry) return;

    this.reconciliationService
      .createManualMatch(rec.id, {
        bank_transaction_id: bankTx.id,
        accounting_entry_id: entry.id,
      })
      .subscribe({
        next: () => {
          this.toastService.success('Partida conciliada manualmente');
          this.selectedBankTx.set(null);
          this.selectedEntry.set(null);
          this.loadReconciliation(rec.id);
        },
        error: () => this.toastService.error('Error al conciliar'),
      });
  }

  unmatchItem(match: ReconciliationMatch): void {
    const rec = this.reconciliation();
    if (!rec) return;
    this.dialogService.confirm({
      title: 'Deshacer Conciliacion',
      message: '¿Deseas deshacer esta conciliacion?',
      confirmText: 'Deshacer',
      cancelText: 'Cancelar',
    }).then((confirmed) => {
      if (!confirmed) return;
      this.reconciliationService.unmatch(rec.id, match.id).subscribe({
        next: () => {
          this.toastService.success('Conciliacion deshecha');
          this.loadReconciliation(rec.id);
        },
        error: () => this.toastService.error('Error al deshacer'),
      });
    });
  }

  completeReconciliation(): void {
    const rec = this.reconciliation();
    if (!rec) return;
    this.dialogService.confirm({
      title: 'Completar Conciliacion',
      message: '¿Deseas marcar esta conciliacion como completada? Esta accion no se puede deshacer.',
      confirmText: 'Completar',
      cancelText: 'Cancelar',
    }).then((confirmed) => {
      if (!confirmed) return;
      this.reconciliationService.completeReconciliation(rec.id).subscribe({
        next: () => {
          this.toastService.success('Conciliacion completada');
          this.loadReconciliation(rec.id);
        },
        error: () => this.toastService.error('Error al completar'),
      });
    });
  }

  goBack(): void {
    this.router.navigate(['/store/accounting/bank-reconciliation/reconciliations']);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      in_progress: 'En Progreso',
      completed: 'Completada',
    };
    return labels[status] || status;
  }

  getStatusClasses(status: string): string {
    const classes: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-500',
      in_progress: 'bg-amber-50 text-amber-600',
      completed: 'bg-emerald-50 text-emerald-600',
    };
    return classes[status] || 'bg-gray-100 text-gray-500';
  }
}
