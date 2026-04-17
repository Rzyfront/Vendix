import {Component,
  inject,
  signal,
  computed,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';


import { AccountingService } from '../../../services/accounting.service';
import { Budget, BudgetLine, ChartAccount } from '../../../interfaces/accounting.interface';
import {
  ButtonComponent,
  ToastService,
  SelectorComponent,
  SelectorOption,
  IconComponent} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';

const MONTH_KEYS = [
  'month_01', 'month_02', 'month_03', 'month_04',
  'month_05', 'month_06', 'month_07', 'month_08',
  'month_09', 'month_10', 'month_11', 'month_12',
] as const;

const MONTH_LABELS = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];

interface EditorLine {
  id?: number;
  account_id: number;
  account_code: string;
  account_name: string;
  months: number[];
  total: number;
}

@Component({
  selector: 'vendix-budget-editor',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    SelectorComponent,
    IconComponent
],
  templateUrl: './budget-editor.component.html',
  styleUrls: ['./budget-editor.component.scss']})
export class BudgetEditorComponent implements {
  private destroyRef = inject(DestroyRef);
private route = inject(ActivatedRoute);
  private router = inject(Router);
  private accounting_service = inject(AccountingService);
  private toast_service = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);

  budget = signal<Budget | null>(null);
  lines = signal<EditorLine[]>([]);
  loading = signal(false);
  saving = signal(false);
  accounts = signal<ChartAccount[]>([]);
  account_options = signal<SelectorOption[]>([]);
  selected_account_id = signal<number | null>(null);

  month_labels = MONTH_LABELS;

  is_editable = computed(() => {
    const b = this.budget();
    return b?.status === 'draft';
  });

  status_label = computed(() => {
    const b = this.budget();
    if (!b) return '';
    const labels: Record<string, string> = {
      draft: 'Borrador',
      approved: 'Aprobado',
      active: 'Activo',
      closed: 'Cerrado'};
    return labels[b.status] || b.status;
  });

  column_totals = computed(() => {
    const all_lines = this.lines();
    const totals: number[] = new Array(12).fill(0);
    for (const line of all_lines) {
      for (let i = 0; i < 12; i++) {
        totals[i] += line.months[i] || 0;
      }
    }
    return totals;
  });

  grand_total = computed(() => {
    return this.column_totals().reduce((sum, v) => sum + v, 0);
  });

  private budget_id = 0;

  constructor() {
    this.budget_id = Number(this.route.snapshot.paramMap.get('budgetId'));
    if (!this.budget_id) {
      this.router.navigate(['/store/accounting/budgets']);
      return;
    }
    this.loadBudget();
    this.loadAccounts();
  }
private loadBudget(): void {
    this.loading.set(true);
    this.accounting_service
      .getBudget(this.budget_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const b = res.data;
          this.budget.set(b);
          this.lines.set(this.mapLinesToEditor(b.budget_lines || []));
          this.loading.set(false);
        },
        error: () => {
          this.toast_service.show({ variant: 'error', description: 'Error al cargar presupuesto' });
          this.loading.set(false);
          this.router.navigate(['/store/accounting/budgets']);
        }});
  }

  private loadAccounts(): void {
    this.accounting_service
      .getChartOfAccounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const flat = this.flattenAccounts(res.data || []);
          const entry_accounts = flat.filter((a) => a.accepts_entries && a.is_active);
          this.accounts.set(entry_accounts);
          this.account_options.set(
            entry_accounts.map((a) => ({
              value: a.id,
              label: `${a.code} - ${a.name}`})),
          );
        }});
  }

  private flattenAccounts(accounts: ChartAccount[]): ChartAccount[] {
    const result: ChartAccount[] = [];
    const recurse = (items: ChartAccount[]) => {
      for (const a of items) {
        result.push(a);
        if (a.children?.length) recurse(a.children);
      }
    };
    recurse(accounts);
    return result;
  }

  private mapLinesToEditor(lines: BudgetLine[]): EditorLine[] {
    return lines.map((l) => ({
      id: l.id,
      account_id: l.account_id,
      account_code: l.account?.code || '',
      account_name: l.account?.name || '',
      months: MONTH_KEYS.map((k) => Number(l[k]) || 0),
      total: Number(l.total_budgeted) || 0}));
  }

  addLine(): void {
    const account_id = this.selected_account_id();
    if (!account_id) return;

    // Check if account already exists
    if (this.lines().some((l) => l.account_id === account_id)) {
      this.toast_service.show({ variant: 'warning', description: 'Esta cuenta ya esta en el presupuesto' });
      return;
    }

    const account = this.accounts().find((a) => a.id === account_id);
    if (!account) return;

    const new_line: EditorLine = {
      account_id: account.id,
      account_code: account.code,
      account_name: account.name,
      months: new Array(12).fill(0),
      total: 0};

    this.lines.update((prev) => [...prev, new_line]);
    this.selected_account_id.set(null);
  }

  removeLine(index: number): void {
    this.lines.update((prev) => prev.filter((_, i) => i !== index));
  }

  onCellChange(line_index: number, month_index: number, value: string): void {
    const num_value = Number(value) || 0;
    this.lines.update((prev) => {
      const updated = [...prev];
      const line = { ...updated[line_index] };
      line.months = [...line.months];
      line.months[month_index] = num_value;
      line.total = line.months.reduce((s, v) => s + v, 0);
      updated[line_index] = line;
      return updated;
    });
  }

  saveLines(): void {
    if (!this.budget_id) return;

    this.saving.set(true);
    const payload = this.lines().map((l) => {
      const line_data: Record<string, any> = {
        account_id: l.account_id};
      if (l.id) line_data['id'] = l.id;
      MONTH_KEYS.forEach((k, i) => {
        line_data[k] = l.months[i] || 0;
      });
      return line_data;
    });

    this.accounting_service
      .updateBudgetLines(this.budget_id, payload as any)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.toast_service.show({ variant: 'success', description: 'Lineas guardadas' });
          this.saving.set(false);
          // Refresh to get updated IDs
          if (res.data) {
            this.budget.set(res.data);
            this.lines.set(this.mapLinesToEditor(res.data.budget_lines || []));
          }
        },
        error: () => {
          this.toast_service.show({ variant: 'error', description: 'Error al guardar lineas' });
          this.saving.set(false);
        }});
  }

  approveBudget(): void {
    if (!this.budget_id) return;
    this.accounting_service
      .approveBudget(this.budget_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.budget.set(res.data);
          this.toast_service.show({ variant: 'success', description: 'Presupuesto aprobado' });
        },
        error: () => {
          this.toast_service.show({ variant: 'error', description: 'Error al aprobar' });
        }});
  }

  activateBudget(): void {
    if (!this.budget_id) return;
    this.accounting_service
      .activateBudget(this.budget_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.budget.set(res.data);
          this.toast_service.show({ variant: 'success', description: 'Presupuesto activado' });
        },
        error: () => {
          this.toast_service.show({ variant: 'error', description: 'Error al activar' });
        }});
  }

  closeBudget(): void {
    if (!this.budget_id) return;
    this.accounting_service
      .closeBudget(this.budget_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.budget.set(res.data);
          this.toast_service.show({ variant: 'success', description: 'Presupuesto cerrado' });
        },
        error: () => {
          this.toast_service.show({ variant: 'error', description: 'Error al cerrar' });
        }});
  }

  goBack(): void {
    this.router.navigate(['/store/accounting/budgets']);
  }

  goToVariance(): void {
    this.router.navigate(['/store/accounting/budgets', this.budget_id, 'variance']);
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(Number(value) || 0, 0);
  }

  trackByIndex(index: number): number {
    return index;
  }
}
