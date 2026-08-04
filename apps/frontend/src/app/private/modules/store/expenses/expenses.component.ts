import { Component, OnDestroy, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';

import {
  loadExpenses,
  loadExpensesSummary,
  loadExpenseCategories,
  setSearch,
  setStateFilter,
  setDateRange,
  clearFilters,
} from './state/actions/expenses.actions';
import { selectExpenses, selectExpensesLoading } from './state/selectors/expenses.selectors';
import { Expense } from './interfaces/expense.interface';
import {
  VexiUiAction,
  VexiUiActionResult,
  VexiUiHost,
  VexiUiHostRegistry,
  VexiUiScreen,
} from '../../../../core/services/vexi-ui-host.registry';

import { ExpensesStatsComponent } from './components/expenses-stats/expenses-stats.component';
import { ExpensesListComponent } from './components/expenses-list/expenses-list.component';
import { ExpenseCreateComponent } from './components/expense-create/expense-create.component';
import { ExpenseEditComponent } from './components/expense-edit/expense-edit.component';
import { ExpenseCategoriesComponent } from './components/expense-categories/expense-categories.component';
import { ExpenseScannerModalComponent } from './components/expense-scanner/expense-scanner-modal.component';
import { CurrencyFormatService } from '../../../../shared/pipes/currency';

@Component({
  selector: 'vendix-expenses',
  standalone: true,
  imports: [
    ExpensesStatsComponent,
    ExpensesListComponent,
    ExpenseCreateComponent,
    ExpenseEditComponent,
    ExpenseCategoriesComponent,
    ExpenseScannerModalComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <vendix-expenses-stats></vendix-expenses-stats>
      </div>

      <!-- Expenses List -->
      <app-expenses-list
        [expenses]="expenses() || []"
        [loading]="loading() || false"
        (create)="openCreateModal()"
        (edit)="editExpense($event)"
        (categories)="openCategoriesModal()"
        (scan)="isScannerModalOpen.set(true)"
        (refresh)="refreshExpenses()"
      ></app-expenses-list>

      <!-- Create Expense Modal -->
      <vendix-expense-create
        [isOpen]="isCreateModalOpen()"
        (isOpenChange)="isCreateModalOpen.set($event)"
      ></vendix-expense-create>

      <!-- Edit Expense Modal -->
      <vendix-expense-edit
        [isOpen]="isEditModalOpen()"
        (isOpenChange)="isEditModalOpen.set($event)"
        [expense]="selectedExpense()"
      ></vendix-expense-edit>

      <!-- Categories Modal -->
      <vendix-expense-categories
        [isOpen]="isCategoriesModalOpen()"
        (isOpenChange)="isCategoriesModalOpen.set($event)"
      ></vendix-expense-categories>

      <!-- Expense Scanner Modal -->
      <app-expense-scanner-modal
        [isOpen]="isScannerModalOpen()"
        (isOpenChange)="isScannerModalOpen.set($event)"
        (created)="onScannedCreated($event)"
      ></app-expense-scanner-modal>
    </div>
  `,
})
/**
 * Gastos, y the module that also acts as Vexi's operable host for this screen.
 *
 * `VexiUiHost` is implemented on the component rather than on a service on purpose:
 * the modal flags, the selection and the filter dispatches live here, and reaching
 * them from outside would mean either duplicating the state or exposing the
 * component's internals. Registering itself is also what makes "is the user in
 * Gastos" answerable — the route and the mounted component disagree during a
 * transition, and driving a screen that is tearing down loses the work silently.
 */
export class ExpensesComponent implements VexiUiHost, OnDestroy {
  private currencyService = inject(CurrencyFormatService);
  private store = inject(Store);
  private vexiHosts = inject(VexiUiHostRegistry);

  readonly vexiModuleKey = 'expenses';

  readonly expenses = toSignal(this.store.select(selectExpenses), { initialValue: [] });
  readonly loading = toSignal(this.store.select(selectExpensesLoading), { initialValue: false });

  // Modal states
  readonly isCreateModalOpen = signal(false);
  readonly isEditModalOpen = signal(false);
  readonly isCategoriesModalOpen = signal(false);
  readonly isScannerModalOpen = signal(false);
  readonly selectedExpense = signal<Expense | null>(null);

  constructor() {
    this.currencyService.loadCurrency();
    this.store.dispatch(loadExpenses());
    this.store.dispatch(loadExpensesSummary());
    this.store.dispatch(loadExpenseCategories());
    this.vexiHosts.register(this);
  }

  ngOnDestroy(): void {
    this.vexiHosts.unregister(this);
  }

  // ── Vexi ────────────────────────────────────────────────────────────────

  readScreen(): VexiUiScreen {
    const rows = this.expenses() ?? [];

    return {
      module_key: this.vexiModuleKey,
      title: 'Gastos',
      visible_count: rows.length,
      selection: this.selectedExpense()?.description ?? null,
      notes: this.loading()
        ? 'La lista todavía está cargando.'
        : this.openModalNote(),
    };
  }

  listActions(): VexiUiAction[] {
    return [
      { id: 'nuevo_gasto', label: 'Abrir el formulario de nuevo gasto' },
      { id: 'escanear_recibo', label: 'Abrir el escáner de recibos' },
      { id: 'categorias', label: 'Abrir las categorías de gasto' },
      { id: 'limpiar_filtros', label: 'Quitar todos los filtros de la lista' },
    ];
  }

  async runAction(id: string): Promise<VexiUiActionResult> {
    switch (id) {
      case 'nuevo_gasto':
        this.openCreateModal();
        return {
          status: 'needs_user_input',
          message:
            'Abrí el formulario de nuevo gasto. Está vacío y sin guardar: la persona tiene que completarlo y confirmarlo.',
        };
      case 'escanear_recibo':
        this.isScannerModalOpen.set(true);
        return {
          status: 'needs_user_input',
          message:
            'Abrí el escáner de recibos para que la persona suba la foto desde ahí.',
        };
      case 'categorias':
        this.openCategoriesModal();
        return { status: 'ok', message: 'Abrí las categorías de gasto.' };
      case 'limpiar_filtros':
        this.store.dispatch(clearFilters());
        return { status: 'ok', message: 'Quité los filtros de la lista.' };
      default:
        return {
          status: 'not_found',
          message: `La pantalla de Gastos no tiene una acción "${id}".`,
        };
    }
  }

  /**
   * Applies the filters this module actually owns, and says which it ignored.
   *
   * Reporting the unknown keys instead of silently dropping them is what keeps Vexi
   * from telling the person "ya filtré por proveedor" over a filter this screen has
   * no concept of.
   */
  async setFilter(values: Record<string, unknown>): Promise<VexiUiActionResult> {
    const applied: string[] = [];
    const ignored: string[] = [];

    for (const [key, value] of Object.entries(values)) {
      switch (key) {
        case 'search':
          this.store.dispatch(setSearch({ search: String(value ?? '') }));
          applied.push('búsqueda');
          break;
        case 'state':
        case 'estado':
          this.store.dispatch(
            setStateFilter({ stateFilter: String(value ?? '') }),
          );
          applied.push('estado');
          break;
        case 'date_from':
        case 'date_to': {
          // Both ends travel in one action, so the pair is resolved once rather
          // than dispatching twice and refetching in between.
          const from = String(values['date_from'] ?? '');
          const to = String(values['date_to'] ?? '');
          if (!applied.includes('fechas')) {
            this.store.dispatch(setDateRange({ dateFrom: from, dateTo: to }));
            applied.push('fechas');
          }
          break;
        }
        default:
          ignored.push(key);
      }
    }

    if (!applied.length) {
      return {
        status: 'not_found',
        message: `La lista de Gastos no filtra por ${ignored.join(', ')}. Filtra por búsqueda, estado o rango de fechas.`,
      };
    }

    // Sin conteo: los filtros son acciones NgRx y el efecto refetchea, así que
    // `expenses()` acá todavía trae el resultado anterior. Devolver su longitud
    // hacía que Vexi afirmara un número que la pantalla nunca mostró.
    return {
      status: 'ok',
      message: `Filtré la lista por ${applied.join(', ')}.${
        ignored.length
          ? ` No apliqué ${ignored.join(', ')} porque esta lista no filtra por eso.`
          : ''
      } La lista se está recargando; si necesitas el conteo, léelo de la pantalla después.`,
    };
  }

  /**
   * Same ids as `listActions`, because on this screen every dialog IS an action.
   *
   * Kept as a distinct method anyway: the model reaches for `ui_open_modal` when it
   * wants a form and for `ui_click_action` when it wants something to happen, and
   * refusing one of the two would cost a turn over a distinction that does not exist
   * here.
   */
  openModal(id: string): Promise<VexiUiActionResult> {
    return this.runAction(id);
  }

  refresh(): VexiUiActionResult {
    this.refreshExpenses();
    return { status: 'ok', message: 'Recargué la lista de gastos.' };
  }

  /** Names an open modal, so Vexi does not act as if the screen were idle. */
  private openModalNote(): string | undefined {
    if (this.isCreateModalOpen()) return 'Hay un formulario de nuevo gasto abierto.';
    if (this.isEditModalOpen()) return 'Hay un gasto abierto en edición.';
    if (this.isScannerModalOpen()) return 'El escáner de recibos está abierto.';
    if (this.isCategoriesModalOpen()) return 'Las categorías están abiertas.';
    return undefined;
  }

  // Modal handlers
  openCreateModal(): void {
    this.isCreateModalOpen.set(true);
  }

  openCategoriesModal(): void {
    this.isCategoriesModalOpen.set(true);
  }

  editExpense(expense: Expense): void {
    this.selectedExpense.set(expense);
    this.isEditModalOpen.set(true);
  }

  refreshExpenses(): void {
    this.store.dispatch(loadExpenses());
    this.store.dispatch(loadExpensesSummary());
  }

  onScannedCreated(expense: Expense): void {
    this.isScannerModalOpen.set(false);
  }
}
