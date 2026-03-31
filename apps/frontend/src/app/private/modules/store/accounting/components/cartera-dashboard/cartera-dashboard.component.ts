import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { CarteraService } from '../../services/cartera.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  CarteraDashboard,
  AgingReport,
  AgingBucket,
  AccountReceivable,
  AccountPayable,
} from '../../interfaces/cartera.interface';
import {
  CardComponent,
  IconComponent,
  StatsComponent,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'vendix-cartera-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    IconComponent,
    StatsComponent,
  ],
  templateUrl: './cartera-dashboard.component.html',
})
export class CarteraDashboardComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private carteraService = inject(CarteraService);
  private currencyService = inject(CurrencyFormatService);

  // Data
  ar_dashboard: CarteraDashboard | null = null;
  ap_dashboard: CarteraDashboard | null = null;
  ar_aging: AgingReport | null = null;
  ap_aging: AgingReport | null = null;
  ar_upcoming: AccountReceivable[] = [];
  ap_upcoming: AccountPayable[] = [];
  is_loading = true;

  ngOnInit(): void {
    this.loadAll();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadAll(): void {
    this.is_loading = true;
    let pending = 6;
    const done = () => {
      pending--;
      if (pending === 0) this.is_loading = false;
    };

    this.carteraService
      .getArDashboard()
      .pipe(takeUntil(this.destroy$))
      .subscribe({ next: (r) => { this.ar_dashboard = r.data; done(); }, error: done });

    this.carteraService
      .getApDashboard()
      .pipe(takeUntil(this.destroy$))
      .subscribe({ next: (r) => { this.ap_dashboard = r.data; done(); }, error: done });

    this.carteraService
      .getArAging()
      .pipe(takeUntil(this.destroy$))
      .subscribe({ next: (r) => { this.ar_aging = r.data; done(); }, error: done });

    this.carteraService
      .getApAging()
      .pipe(takeUntil(this.destroy$))
      .subscribe({ next: (r) => { this.ap_aging = r.data; done(); }, error: done });

    this.carteraService
      .getArUpcoming(7)
      .pipe(takeUntil(this.destroy$))
      .subscribe({ next: (r) => { this.ar_upcoming = r.data; done(); }, error: done });

    this.carteraService
      .getApUpcoming(7)
      .pipe(takeUntil(this.destroy$))
      .subscribe({ next: (r) => { this.ap_upcoming = r.data; done(); }, error: done });
  }

  // ── Format helpers ──────────────────────────────────

  format(value: number): string {
    return this.currencyService.format(value || 0);
  }

  get ar_total_pending(): string {
    return this.format(this.ar_dashboard?.total_pending || 0);
  }

  get ar_total_overdue(): string {
    return this.format(this.ar_dashboard?.total_overdue || 0);
  }

  get ar_due_soon(): string {
    return this.format(this.ar_dashboard?.due_soon || 0);
  }

  get ar_collected_month(): string {
    return this.format(this.ar_dashboard?.collected_this_month || 0);
  }

  get ap_total_pending(): string {
    return this.format(this.ap_dashboard?.total_pending || 0);
  }

  get ap_total_overdue(): string {
    return this.format(this.ap_dashboard?.total_overdue || 0);
  }

  get ap_due_soon(): string {
    return this.format(this.ap_dashboard?.due_soon || 0);
  }

  get ap_paid_month(): string {
    return this.format(this.ap_dashboard?.paid_this_month || 0);
  }

  // ── Aging helpers ───────────────────────────────────

  getAgingBarWidth(bucket: AgingBucket, report: AgingReport): string {
    if (!report || report.totals.grand_total === 0) return '0%';
    const pct = (bucket.total / report.totals.grand_total) * 100;
    return `${Math.max(pct, 2)}%`;
  }

  getAgingBarColor(index: number): string {
    const colors = [
      'bg-emerald-400',
      'bg-blue-400',
      'bg-amber-400',
      'bg-orange-400',
      'bg-red-400',
      'bg-red-600',
    ];
    return colors[index] || 'bg-gray-400';
  }
}
