import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable, map, combineLatest, BehaviorSubject } from 'rxjs';

import { ChartAccount } from '../../interfaces/accounting.interface';
import { selectAccounts, selectAccountsLoading } from '../../state/selectors/accounting.selectors';
import { deleteAccount } from '../../state/actions/accounting.actions';
import { AccountCreateComponent } from './account-create/account-create.component';
import {
  ButtonComponent,
  IconComponent,
  StatsComponent,
  InputsearchComponent,
} from '../../../../../../shared/components/index';

interface AccountStats {
  total: number;
  active: number;
  accepts_entries: number;
  types: number;
}

@Component({
  selector: 'vendix-chart-of-accounts',
  standalone: true,
  imports: [
    CommonModule,
    AccountCreateComponent,
    ButtonComponent,
    IconComponent,
    StatsComponent,
    InputsearchComponent,
  ],
  template: `
    <div class="w-full">

      <!-- Stats: Sticky on mobile, static on desktop -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        @if (stats$ | async; as stats) {
          <app-stats
            title="Total Cuentas"
            [value]="stats.total"
            iconName="book-open"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
            [clickable]="false"
          ></app-stats>
          <app-stats
            title="Activas"
            [value]="stats.active"
            iconName="check-circle"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-600"
            [clickable]="false"
          ></app-stats>
          <app-stats
            title="Aceptan Asientos"
            [value]="stats.accepts_entries"
            iconName="file-text"
            iconBgColor="bg-purple-100"
            iconColor="text-purple-600"
            [clickable]="false"
          ></app-stats>
          <app-stats
            title="Tipos de Cuenta"
            [value]="stats.types"
            iconName="layers"
            iconBgColor="bg-amber-100"
            iconColor="text-amber-600"
            [clickable]="false"
          ></app-stats>
        }
      </div>

      <!-- Unified Container: Search Header + Data -->
      <div class="md:bg-surface md:rounded-xl md:shadow-[0_2px_8px_rgba(0,0,0,0.07)]
                  md:border md:border-border md:min-h-[400px]">

        <!-- Search Header -->
        <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                    md:mt-0 md:static md:bg-transparent md:px-4 md:py-4 md:border-b md:border-border">
          <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
            <h2 class="text-[13px] font-bold text-gray-600 tracking-wide
                       md:text-lg md:font-semibold md:text-text-primary">
              Plan de Cuentas ({{ (flatCount$ | async) || 0 }})
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                placeholder="Buscar cuenta..."
                [debounceTime]="300"
                (searchChange)="onSearch($event)"
              ></app-inputsearch>
              <app-button variant="primary" size="sm" (clicked)="openCreateModal()">
                <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                <span class="hidden sm:inline">Nueva Cuenta</span>
                <span class="sm:hidden">Nueva</span>
              </app-button>
            </div>
          </div>
        </div>

        <!-- Data Content -->
        <div class="relative p-2 md:p-4">
          @if (loading$ | async) {
            <div class="absolute inset-0 bg-surface/50 z-10 flex items-center justify-center">
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          }

          <!-- Table Header (desktop) -->
          <div class="hidden md:grid md:grid-cols-12 gap-2 px-4 py-3 bg-gray-50 rounded-lg
                      text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
            <div class="col-span-1">Código</div>
            <div class="col-span-4">Nombre</div>
            <div class="col-span-2">Tipo</div>
            <div class="col-span-1 text-center">Naturaleza</div>
            <div class="col-span-1 text-center">Estado</div>
            <div class="col-span-1 text-center">Asientos</div>
            <div class="col-span-2 text-right">Acciones</div>
          </div>

          @if (filteredAccounts$ | async; as accounts) {
            @if (accounts.length === 0) {
              <div class="flex flex-col items-center justify-center py-16 text-gray-400">
                <app-icon name="book-open" [size]="48"></app-icon>
                <p class="mt-4 text-base">No se encontraron cuentas</p>
                <p class="text-sm">{{ searchTerm ? 'Intenta con otro término de búsqueda.' : 'Crea tu primera cuenta para comenzar.' }}</p>
              </div>
            } @else {
              <div class="divide-y divide-border">
                @for (account of accounts; track account.id) {
                  <ng-container
                    *ngTemplateOutlet="accountRow; context: { $implicit: account, depth: 0 }"
                  ></ng-container>
                }
              </div>
            }
          }
        </div>
      </div>

      <!-- Account Create/Edit Modal -->
      <vendix-account-create
        [(isOpen)]="is_create_modal_open"
        [editAccount]="selected_account"
        [accounts]="(accounts$ | async) || []"
      ></vendix-account-create>
    </div>

    <!-- Recursive row template -->
    <ng-template #accountRow let-account let-depth="depth">
      <!-- Mobile Card -->
      <div class="md:hidden p-3 mx-2 my-1 bg-surface rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.07)]"
           [style.margin-left.px]="depth * 16 + 8">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 min-w-0">
            @if (account.children?.length) {
              <button (click)="toggleExpand(account.id)" class="p-1 hover:bg-gray-100 rounded">
                <app-icon [name]="isExpanded(account.id) ? 'chevron-down' : 'chevron-right'" [size]="14"></app-icon>
              </button>
            } @else {
              <span class="w-6"></span>
            }
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-xs font-mono text-gray-500">{{ account.code }}</span>
                <span class="text-[15px] font-bold text-text-primary truncate">{{ account.name }}</span>
              </div>
              <div class="flex items-center gap-2 mt-1">
                <span class="text-[10px] font-bold uppercase text-gray-500 px-1.5 py-0.5 rounded bg-gray-100">{{ getTypeLabel(account.account_type) }}</span>
                <span class="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                      [class]="account.nature === 'debit' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'">
                  {{ account.nature === 'debit' ? 'Débito' : 'Crédito' }}
                </span>
                @if (!account.is_active) {
                  <span class="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-50 text-red-500">Inactivo</span>
                }
              </div>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <button (click)="editAccount(account)"
                    class="p-1.5 rounded border border-blue-200 bg-blue-50 text-blue-500 hover:bg-blue-100">
              <app-icon name="edit" [size]="14"></app-icon>
            </button>
            @if (account.accepts_entries && !account.children?.length) {
              <button (click)="onDeleteAccount(account)"
                      class="p-1.5 rounded border border-red-200 bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-500">
                <app-icon name="trash-2" [size]="14"></app-icon>
              </button>
            }
          </div>
        </div>
      </div>

      <!-- Desktop Row -->
      <div class="hidden md:grid md:grid-cols-12 gap-2 px-4 py-2.5 items-center hover:bg-gray-50 transition-colors"
           [style.padding-left.px]="depth * 24 + 16">
        <div class="col-span-1 flex items-center gap-1">
          @if (account.children?.length) {
            <button (click)="toggleExpand(account.id)" class="p-0.5 hover:bg-gray-200 rounded">
              <app-icon [name]="isExpanded(account.id) ? 'chevron-down' : 'chevron-right'" [size]="14"></app-icon>
            </button>
          } @else {
            <span class="w-5"></span>
          }
          <span class="text-sm font-mono text-gray-600">{{ account.code }}</span>
        </div>
        <div class="col-span-4 text-sm text-text-primary font-medium truncate">{{ account.name }}</div>
        <div class="col-span-2 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 w-fit">
          {{ getTypeLabel(account.account_type) }}
        </div>
        <div class="col-span-1 text-center">
          <span class="text-xs px-2 py-0.5 rounded-full"
                [class]="account.nature === 'debit' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'">
            {{ account.nature === 'debit' ? 'Débito' : 'Crédito' }}
          </span>
        </div>
        <div class="col-span-1 text-center">
          <span class="text-xs px-2 py-0.5 rounded-full"
                [class]="account.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'">
            {{ account.is_active ? 'Activo' : 'Inactivo' }}
          </span>
        </div>
        <div class="col-span-1 text-center">
          @if (account.accepts_entries) {
            <app-icon name="check" [size]="16" class="text-emerald-500"></app-icon>
          } @else {
            <app-icon name="minus" [size]="16" class="text-gray-300"></app-icon>
          }
        </div>
        <div class="col-span-2 flex items-center justify-end gap-1">
          <button (click)="editAccount(account)" class="p-1.5 hover:bg-gray-100 rounded text-gray-500 hover:text-primary">
            <app-icon name="edit" [size]="14"></app-icon>
          </button>
          @if (account.accepts_entries && !account.children?.length) {
            <button (click)="onDeleteAccount(account)" class="p-1.5 hover:bg-red-50 rounded text-gray-400 hover:text-red-500">
              <app-icon name="trash-2" [size]="14"></app-icon>
            </button>
          }
        </div>
      </div>

      <!-- Children (recursive) -->
      @if (account.children?.length && isExpanded(account.id)) {
        @for (child of account.children; track child.id) {
          <ng-container
            *ngTemplateOutlet="accountRow; context: { $implicit: child, depth: depth + 1 }"
          ></ng-container>
        }
      }
    </ng-template>
  `,
})
export class ChartOfAccountsComponent implements OnInit {
  private store = inject(Store);

  accounts$: Observable<ChartAccount[]> = this.store.select(selectAccounts);
  loading$: Observable<boolean> = this.store.select(selectAccountsLoading);

  private search$ = new BehaviorSubject<string>('');
  searchTerm = '';

  // Filtered accounts (tree-aware search)
  filteredAccounts$: Observable<ChartAccount[]> = combineLatest([
    this.accounts$,
    this.search$,
  ]).pipe(
    map(([accounts, search]) => {
      if (!search.trim()) return accounts;
      return this.filterTree(accounts, search.toLowerCase());
    }),
  );

  // Stats computed from flattened accounts
  stats$: Observable<AccountStats> = this.accounts$.pipe(
    map((accounts) => {
      const flat = this.flattenAccounts(accounts);
      const types = new Set(flat.map((a) => a.account_type));
      return {
        total: flat.length,
        active: flat.filter((a) => a.is_active).length,
        accepts_entries: flat.filter((a) => a.accepts_entries).length,
        types: types.size,
      };
    }),
  );

  flatCount$: Observable<number> = this.accounts$.pipe(
    map((accounts) => this.flattenAccounts(accounts).length),
  );

  is_create_modal_open = false;
  selected_account: ChartAccount | null = null;
  expanded_ids = new Set<number>();

  ngOnInit(): void {
    // Accounts already loaded by parent AccountingComponent
  }

  onSearch(term: string): void {
    this.searchTerm = term;
    this.search$.next(term);
  }

  openCreateModal(): void {
    this.selected_account = null;
    this.is_create_modal_open = true;
  }

  editAccount(account: ChartAccount): void {
    this.selected_account = account;
    this.is_create_modal_open = true;
  }

  onDeleteAccount(account: ChartAccount): void {
    if (confirm(`¿Estás seguro de que deseas eliminar la cuenta "${account.code} - ${account.name}"?`)) {
      this.store.dispatch(deleteAccount({ id: account.id }));
    }
  }

  toggleExpand(id: number): void {
    if (this.expanded_ids.has(id)) {
      this.expanded_ids.delete(id);
    } else {
      this.expanded_ids.add(id);
    }
  }

  isExpanded(id: number): boolean {
    return this.expanded_ids.has(id);
  }

  getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      asset: 'Activo',
      liability: 'Pasivo',
      equity: 'Patrimonio',
      revenue: 'Ingresos',
      expense: 'Gasto',
    };
    return labels[type] || type;
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

  private filterTree(accounts: ChartAccount[], search: string): ChartAccount[] {
    const result: ChartAccount[] = [];
    for (const account of accounts) {
      const matches =
        account.code.toLowerCase().includes(search) ||
        account.name.toLowerCase().includes(search) ||
        this.getTypeLabel(account.account_type).toLowerCase().includes(search);

      const filteredChildren = account.children?.length
        ? this.filterTree(account.children, search)
        : [];

      if (matches || filteredChildren.length > 0) {
        result.push({
          ...account,
          children: filteredChildren.length > 0 ? filteredChildren : account.children,
        });
        // Auto-expand parents that have matching children
        if (filteredChildren.length > 0) {
          this.expanded_ids.add(account.id);
        }
      }
    }
    return result;
  }
}
