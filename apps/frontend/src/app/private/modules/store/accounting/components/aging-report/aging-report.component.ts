import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CarteraService } from '../../services/cartera.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  CardComponent,
  IconComponent,
  ButtonComponent,
} from '../../../../../../shared/components/index';
import { AgingReport } from '../../interfaces/cartera.interface';

type AgingTab = 'ar' | 'ap';

@Component({
  selector: 'vendix-aging-report',
  standalone: true,
  imports: [CommonModule, CardComponent, IconComponent, ButtonComponent],
  templateUrl: './aging-report.component.html',
})
export class AgingReportComponent implements OnInit {
  private cartera = inject(CarteraService);
  private currency = inject(CurrencyFormatService);

  active_tab: AgingTab = 'ar';
  loading = true;
  ar_aging: AgingReport | null = null;
  ap_aging: AgingReport | null = null;

  get current_report(): AgingReport | null {
    return this.active_tab === 'ar' ? this.ar_aging : this.ap_aging;
  }

  get entity_label(): string {
    return this.active_tab === 'ar' ? 'Cliente' : 'Proveedor';
  }

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.loading = true;

    this.cartera.getArAging().subscribe({
      next: (res) => { this.ar_aging = res.data; },
    });

    this.cartera.getApAging().subscribe({
      next: (res) => { this.ap_aging = res.data; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  switchTab(tab: AgingTab): void {
    this.active_tab = tab;
  }

  formatCurrency(val: number | undefined): string {
    return this.currency.format(Number(val) || 0);
  }

  getBarWidth(value: number, total: number): string {
    if (!total || !value) return '0%';
    return `${Math.min((value / total) * 100, 100)}%`;
  }

  getBucketColor(index: number): string {
    const colors = [
      'bg-emerald-400',  // Current
      'bg-yellow-400',   // 1-30
      'bg-orange-400',   // 31-60
      'bg-red-400',      // 61-90
      'bg-red-600',      // 91-120
      'bg-red-800',      // 120+
    ];
    return colors[index] || 'bg-gray-400';
  }

  getBucketTextColor(index: number): string {
    const colors = [
      'text-emerald-700',
      'text-yellow-700',
      'text-orange-700',
      'text-red-700',
      'text-red-800',
      'text-red-900',
    ];
    return colors[index] || 'text-gray-700';
  }
}
