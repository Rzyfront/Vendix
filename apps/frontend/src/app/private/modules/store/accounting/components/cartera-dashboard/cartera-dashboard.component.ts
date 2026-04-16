import { Component, OnDestroy, inject, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
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
    DatePipe,
    CardComponent,
    IconComponent,
    StatsComponent,
  ],
  templateUrl: './cartera-dashboard.component.html',
})
export class CarteraDashboardComponent implements OnDestroy {
  private destroy$ = new Subject<void>();
  private carteraService = inject(CarteraService);
  private currencyService = inject(CurrencyFormatService);

  // Data
  readonly ar_dashboard = signal<CarteraDashboard | null>(null);
  readonly ap_dashboard = signal<CarteraDashboard | null>(null);
  readonly ar_aging = signal<AgingReport | null>(null);
  readonly ap_aging = signal<AgingReport | null>(null);
  readonly ar_upcoming = signal<AccountReceivable[]>([]);
  readonly ap_upcoming = signal<AccountPayable[]>([]);
  readonly is_loading = signal(true);

  constructor() {
    this.loadAll();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadAll(): void {
    this.is_loading.set(true);
    let pending = 6;
    const done = () => {
      pending--;
      if (pending === 0) this.is_loading.set(false);
    };

    this.carteraService
      .getArDashboard()
      .pipe(takeUntil(this.destroy$))
      .subscribe({ next: (r) => { this.ar_dashboard.set(r.data); done(); }, error: done });

    this.carteraService
      .getApDashboard()
      .pipe(takeUntil(this.destroy$))
      .subscribe({ next: (r) => { this.ap_dashboard.set(r.data); done(); }, error: done });

    this.carteraService
      .getArAging()
      .pipe(takeUntil(this.destroy$))
      .subscribe({ next: (r) => { this.ar_aging.set(r.data); done(); }, error: done });

    this.carteraService
      .getApAging()
      .pipe(takeUntil(this.destroy$))
      .subscribe({ next: (r) => { this.ap_aging.set(r.data); done(); }, error: done });

    this.carteraService
      .getArUpcoming(7)
      .pipe(takeUntil(this.destroy$))
      .subscribe({ next: (r) => { this.ar_upcoming.set(r.data); done(); }, error: done });

    this.carteraService
      .getApUpcoming(7)
      .pipe(takeUntil(this.destroy$))
      .subscribe({ next: (r) => { this.ap_upcoming.set(r.data); done(); }, error: done });
  }

  // ── Format helpers ──────────────────────────────────

  format(value: number): string {
    return this.currencyService.format(value || 0);
  }

  readonly ar_total_pending = computed(() => this.format(this.ar_dashboard()?.total_pending || 0));
  readonly ar_total_overdue = computed(() => this.format(this.ar_dashboard()?.total_overdue || 0));
  readonly ar_due_soon = computed(() => this.format(this.ar_dashboard()?.due_soon || 0));
  readonly ar_collected_month = computed(() => this.format(this.ar_dashboard()?.collected_this_month || 0));
  readonly ap_total_pending = computed(() => this.format(this.ap_dashboard()?.total_pending || 0));
  readonly ap_total_overdue = computed(() => this.format(this.ap_dashboard()?.total_overdue || 0));
  readonly ap_due_soon = computed(() => this.format(this.ap_dashboard()?.due_soon || 0));
  readonly ap_paid_month = computed(() => this.format(this.ap_dashboard()?.paid_this_month || 0));

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
