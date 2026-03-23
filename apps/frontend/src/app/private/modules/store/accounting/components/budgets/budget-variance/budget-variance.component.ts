import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import { AccountingService } from '../../../services/accounting.service';
import { Budget, VarianceRow, VarianceAlert } from '../../../interfaces/accounting.interface';
import {
  ButtonComponent,
  ToastService,
  SelectorComponent,
  SelectorOption,
  IconComponent,
} from '../../../../../../../shared/components/index';

@Component({
  selector: 'vendix-budget-variance',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    SelectorComponent,
    IconComponent,
  ],
  templateUrl: './budget-variance.component.html',
  styleUrls: ['./budget-variance.component.scss'],
})
export class BudgetVarianceComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private accounting_service = inject(AccountingService);
  private toast_service = inject(ToastService);

  budget = signal<Budget | null>(null);
  variance_rows = signal<VarianceRow[]>([]);
  alerts = signal<VarianceAlert[]>([]);
  loading = signal(false);
  selected_month = signal<number | null>(null);

  month_options: SelectorOption[] = [
    { value: null as any, label: 'Acumulado YTD' },
    { value: 1, label: 'Enero' },
    { value: 2, label: 'Febrero' },
    { value: 3, label: 'Marzo' },
    { value: 4, label: 'Abril' },
    { value: 5, label: 'Mayo' },
    { value: 6, label: 'Junio' },
    { value: 7, label: 'Julio' },
    { value: 8, label: 'Agosto' },
    { value: 9, label: 'Septiembre' },
    { value: 10, label: 'Octubre' },
    { value: 11, label: 'Noviembre' },
    { value: 12, label: 'Diciembre' },
  ];

  totals = computed(() => {
    const rows = this.variance_rows();
    return {
      budgeted: rows.reduce((s, r) => s + r.budgeted, 0),
      actual: rows.reduce((s, r) => s + r.actual, 0),
      variance: rows.reduce((s, r) => s + r.variance, 0),
    };
  });

  private budget_id = 0;

  ngOnInit(): void {
    this.budget_id = Number(this.route.snapshot.paramMap.get('budgetId'));
    if (!this.budget_id) {
      this.router.navigate(['/store/accounting/budgets']);
      return;
    }
    this.loadBudget();
    this.loadVariance();
    this.loadAlerts();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadBudget(): void {
    this.accounting_service
      .getBudget(this.budget_id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.budget.set(res.data),
      });
  }

  loadVariance(): void {
    this.loading.set(true);
    const month = this.selected_month() ?? undefined;
    this.accounting_service
      .getBudgetVariance(this.budget_id, month)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.variance_rows.set(res.data || []);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toast_service.show({ variant: 'error', description: 'Error al cargar varianza' });
        },
      });
  }

  private loadAlerts(): void {
    this.accounting_service
      .getBudgetAlerts(this.budget_id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.alerts.set(res.data || []),
      });
  }

  onMonthChange(value: any): void {
    this.selected_month.set(value);
    this.loadVariance();
  }

  isOverThreshold(row: VarianceRow): boolean {
    const threshold = this.budget()?.variance_threshold || 10;
    return Math.abs(row.variance_pct) > threshold;
  }

  goBack(): void {
    this.router.navigate(['/store/accounting/budgets']);
  }

  goToEditor(): void {
    this.router.navigate(['/store/accounting/budgets', this.budget_id, 'editor']);
  }

  formatCurrency(value: number): string {
    return `$${value.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }

  formatPct(value: number): string {
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  }
}
