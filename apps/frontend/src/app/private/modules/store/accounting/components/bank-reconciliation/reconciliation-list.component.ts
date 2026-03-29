import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  CardComponent,
  DialogService,
  IconComponent,
  InputComponent,
  InputsearchComponent,
  ModalComponent,
  SelectorComponent,
  StatsComponent,
  ToastService,
} from '../../../../../../shared/components';
import type { SelectorOption } from '../../../../../../shared/components';
import { BankReconciliationService } from '../../services/bank-reconciliation.service';
import {
  BankAccount,
  BankReconciliation,
} from '../../interfaces/accounting.interface';

@Component({
  selector: 'vendix-reconciliation-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    CardComponent,
    IconComponent,
    StatsComponent,
    InputsearchComponent,
    ModalComponent,
    InputComponent,
    SelectorComponent,
    CurrencyPipe,
    DatePipe,
  ],
  template: `
    <div class="w-full">
      <!-- Stats -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total"
          [value]="stats().total"
          iconName="git-merge"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
          [clickable]="false"
        ></app-stats>
        <app-stats
          title="En Progreso"
          [value]="stats().in_progress"
          iconName="clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
          [clickable]="false"
        ></app-stats>
        <app-stats
          title="Completadas"
          [value]="stats().completed"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-600"
          [clickable]="false"
        ></app-stats>
        <app-stats
          title="Borradores"
          [value]="stats().draft"
          iconName="file-text"
          iconBgColor="bg-gray-200"
          iconColor="text-gray-600"
          [clickable]="false"
        ></app-stats>
      </div>

      <!-- Container -->
      <app-card [responsive]="true" [padding]="false" customClasses="md:min-h-[400px]">
        <!-- Search Header -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                    md:mt-0 md:static md:bg-transparent md:px-4 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <div class="flex items-center gap-2">
              <button
                (click)="goBack()"
                class="p-1.5 hover:bg-gray-100 rounded text-gray-500"
              >
                <app-icon name="arrow-left" [size]="18"></app-icon>
              </button>
              <h2
                class="text-[13px] font-bold text-gray-600 tracking-wide
                         md:text-lg md:font-semibold md:text-text-primary"
              >
                Conciliaciones ({{ filteredReconciliations().length }})
              </h2>
            </div>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                placeholder="Buscar..."
                [debounceTime]="300"
                (searchChange)="onSearch($event)"
              ></app-inputsearch>
              <app-button
                variant="primary"
                size="sm"
                (clicked)="openCreateModal()"
              >
                <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                <span class="hidden sm:inline">Nueva Conciliacion</span>
                <span class="sm:hidden">Nueva</span>
              </app-button>
            </div>
          </div>
        </div>

        <!-- Data -->
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
            <div class="col-span-2">Cuenta</div>
            <div class="col-span-2">Periodo</div>
            <div class="col-span-2 text-right">Saldo Extracto</div>
            <div class="col-span-2 text-right">Saldo Conciliado</div>
            <div class="col-span-1 text-right">Diferencia</div>
            <div class="col-span-1 text-center">Estado</div>
            <div class="col-span-2 text-right">Acciones</div>
          </div>

          @if (filteredReconciliations().length === 0) {
            <div
              class="flex flex-col items-center justify-center py-16 text-gray-400"
            >
              <app-icon name="git-merge" [size]="48"></app-icon>
              <p class="mt-4 text-base">No se encontraron conciliaciones</p>
              <p class="text-sm">Crea tu primera conciliacion para comenzar.</p>
            </div>
          } @else {
            <div class="divide-y divide-border">
              @for (rec of filteredReconciliations(); track rec.id) {
                <!-- Mobile Card -->
                <div
                  class="md:hidden p-3 mx-2 my-1 bg-surface rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] cursor-pointer"
                  (click)="openWorkspace(rec)"
                >
                  <div class="flex items-center justify-between">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span
                          class="text-[15px] font-bold text-text-primary truncate"
                        >
                          {{
                            rec.bank_account?.name ||
                              'Cuenta #' + rec.bank_account_id
                          }}
                        </span>
                        <span
                          class="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                          [class]="getStatusClasses(rec.status)"
                        >
                          {{ getStatusLabel(rec.status) }}
                        </span>
                      </div>
                      <div class="text-xs text-gray-500 mt-1">
                        {{ rec.period_start | date: 'dd/MM/yyyy' }} -
                        {{ rec.period_end | date: 'dd/MM/yyyy' }}
                      </div>
                      <div class="flex items-center gap-3 mt-1">
                        <span class="text-xs text-gray-500"
                          >Extracto:
                          <span class="font-semibold text-text-primary">{{
                            rec.statement_balance
                              | currency: 'COP' : 'symbol-narrow' : '1.0-0'
                          }}</span>
                        </span>
                        <span
                          class="text-xs"
                          [class]="
                            rec.difference === 0
                              ? 'text-emerald-600'
                              : 'text-red-500'
                          "
                        >
                          Dif:
                          {{
                            rec.difference
                              | currency: 'COP' : 'symbol-narrow' : '1.0-0'
                          }}
                        </span>
                      </div>
                    </div>
                    <app-icon
                      name="chevron-right"
                      [size]="18"
                      class="text-gray-400 ml-2"
                    ></app-icon>
                  </div>
                </div>

                <!-- Desktop Row -->
                <div
                  class="hidden md:grid md:grid-cols-12 gap-2 px-4 py-2.5 items-center hover:bg-gray-50 transition-colors cursor-pointer"
                  (click)="openWorkspace(rec)"
                >
                  <div
                    class="col-span-2 text-sm text-text-primary font-medium truncate"
                  >
                    {{
                      rec.bank_account?.name || 'Cuenta #' + rec.bank_account_id
                    }}
                  </div>
                  <div class="col-span-2 text-sm text-gray-600">
                    {{ rec.period_start | date: 'dd/MM/yyyy' }} -
                    {{ rec.period_end | date: 'dd/MM/yyyy' }}
                  </div>
                  <div
                    class="col-span-2 text-sm text-right font-mono text-gray-700"
                  >
                    {{
                      rec.statement_balance
                        | currency: 'COP' : 'symbol-narrow' : '1.0-0'
                    }}
                  </div>
                  <div
                    class="col-span-2 text-sm text-right font-mono text-gray-700"
                  >
                    {{
                      rec.reconciled_balance
                        | currency: 'COP' : 'symbol-narrow' : '1.0-0'
                    }}
                  </div>
                  <div
                    class="col-span-1 text-sm text-right font-semibold"
                    [class]="
                      rec.difference === 0 ? 'text-emerald-600' : 'text-red-500'
                    "
                  >
                    {{
                      rec.difference
                        | currency: 'COP' : 'symbol-narrow' : '1.0-0'
                    }}
                  </div>
                  <div class="col-span-1 text-center">
                    <span
                      class="text-xs px-2 py-0.5 rounded-full"
                      [class]="getStatusClasses(rec.status)"
                    >
                      {{ getStatusLabel(rec.status) }}
                    </span>
                  </div>
                  <div class="col-span-2 flex items-center justify-end gap-1">
                    <button
                      (click)="onDelete(rec, $event)"
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

      <!-- Create Modal -->
      <app-modal
        [isOpen]="isCreateModalOpen()"
        (isOpenChange)="isCreateModalOpen.set($event)"
        (cancel)="isCreateModalOpen.set(false)"
        [size]="'sm'"
        title="Nueva Conciliacion"
      >
        <div class="space-y-4">
          <app-selector
            label="Cuenta Bancaria"
            placeholder="Seleccionar cuenta..."
            [options]="bankAccountOptions()"
            [(ngModel)]="newRecForm.bank_account_id"
          ></app-selector>
          <app-input
            label="Fecha Inicio"
            type="date"
            [(ngModel)]="newRecForm.period_start"
          ></app-input>
          <app-input
            label="Fecha Fin"
            type="date"
            [(ngModel)]="newRecForm.period_end"
          ></app-input>
        </div>
        <div
          slot="footer"
          class="flex justify-end gap-3 pt-4 border-t border-gray-200 mt-4"
        >
          <app-button variant="outline" (clicked)="isCreateModalOpen.set(false)"
            >Cancelar</app-button
          >
          <app-button
            variant="primary"
            (clicked)="createReconciliation()"
            [disabled]="creating()"
          >
            <app-icon name="plus" [size]="16" slot="icon"></app-icon>
            Crear
          </app-button>
        </div>
      </app-modal>
    </div>
  `,
})
export class ReconciliationListComponent implements OnInit {
  private reconciliationService = inject(BankReconciliationService);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);
  private router = inject(Router);

  reconciliations = signal<BankReconciliation[]>([]);
  bankAccounts = signal<BankAccount[]>([]);
  loading = signal(false);
  creating = signal(false);
  searchTerm = signal('');
  isCreateModalOpen = signal(false);

  newRecForm: {
    bank_account_id: number | null;
    period_start: string;
    period_end: string;
  } = {
    bank_account_id: null,
    period_start: '',
    period_end: '',
  };

  filteredReconciliations = computed(() => {
    const term = this.searchTerm().toLowerCase();
    if (!term) return this.reconciliations();
    return this.reconciliations().filter(
      (r) =>
        r.bank_account?.name?.toLowerCase().includes(term) ||
        r.status.includes(term),
    );
  });

  stats = computed(() => {
    const all = this.reconciliations();
    return {
      total: all.length,
      in_progress: all.filter((r) => r.status === 'in_progress').length,
      completed: all.filter((r) => r.status === 'completed').length,
      draft: all.filter((r) => r.status === 'draft').length,
    };
  });

  bankAccountOptions = computed<SelectorOption[]>(() =>
    this.bankAccounts()
      .filter((a) => a.status === 'active')
      .map((a) => ({
        value: a.id,
        label: `${a.name} - ${a.bank_name}`,
      })),
  );

  ngOnInit(): void {
    this.loadData();
  }

  private loadData(): void {
    this.loading.set(true);
    this.reconciliationService.getReconciliations().subscribe({
      next: (res) => {
        this.reconciliations.set(res.data || []);
        this.loading.set(false);
      },
      error: () => {
        this.toastService.error('Error al cargar conciliaciones');
        this.loading.set(false);
      },
    });
    this.reconciliationService.getBankAccounts().subscribe({
      next: (res) => this.bankAccounts.set(res.data || []),
    });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
  }

  openCreateModal(): void {
    this.newRecForm = {
      bank_account_id: null,
      period_start: '',
      period_end: '',
    };
    this.isCreateModalOpen.set(true);
  }

  createReconciliation(): void {
    if (
      !this.newRecForm.bank_account_id ||
      !this.newRecForm.period_start ||
      !this.newRecForm.period_end
    ) {
      this.toastService.error('Completa todos los campos');
      return;
    }
    this.creating.set(true);
    this.reconciliationService
      .createReconciliation({
        bank_account_id: this.newRecForm.bank_account_id,
        period_start: this.newRecForm.period_start,
        period_end: this.newRecForm.period_end,
      })
      .subscribe({
        next: (res) => {
          this.creating.set(false);
          this.isCreateModalOpen.set(false);
          this.toastService.success('Conciliacion creada');
          this.router.navigate([
            '/store/accounting/bank-reconciliation/reconciliations',
            res.data.id,
          ]);
        },
        error: () => {
          this.creating.set(false);
          this.toastService.error('Error al crear la conciliacion');
        },
      });
  }

  openWorkspace(rec: BankReconciliation): void {
    this.router.navigate([
      '/store/accounting/bank-reconciliation/reconciliations',
      rec.id,
    ]);
  }

  onDelete(rec: BankReconciliation, event: MouseEvent): void {
    event.stopPropagation();
    this.dialogService
      .confirm({
        title: 'Eliminar Conciliacion',
        message: '¿Estas seguro de que deseas eliminar esta conciliacion?',
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
      })
      .then((confirmed) => {
        if (!confirmed) return;
        this.reconciliationService.deleteReconciliation(rec.id).subscribe({
          next: () => {
            this.toastService.success('Conciliacion eliminada');
            this.loadData();
          },
          error: () => this.toastService.error('Error al eliminar'),
        });
      });
  }

  goBack(): void {
    this.router.navigate(['/store/accounting/bank-reconciliation']);
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
