import { Component, inject, signal, computed } from '@angular/core';
import { NgClass } from '@angular/common';
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
  imports: [CardComponent, IconComponent, ButtonComponent,
    NgClass,
  ],
  templateUrl: './aging-report.component.html',
})
export class AgingReportComponent {
  private cartera = inject(CarteraService);
  private currency = inject(CurrencyFormatService);

  readonly active_tab = signal<AgingTab>('ar');
  readonly loading = signal(true);
  readonly ar_aging = signal<AgingReport | null>(null);
  readonly ap_aging = signal<AgingReport | null>(null);

  readonly current_report = computed<AgingReport | null>(() =>
    this.active_tab() === 'ar' ? this.ar_aging() : this.ap_aging(),
  );

  readonly entity_label = computed(() =>
    this.active_tab() === 'ar' ? 'Cliente' : 'Proveedor',
  );

  constructor() {
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);

    this.cartera.getArAging().subscribe({
      next: (res) => { this.ar_aging.set(res.data); },
    });

    this.cartera.getApAging().subscribe({
      next: (res) => { this.ap_aging.set(res.data); this.loading.set(false); },
      error: () => { this.loading.set(false); },
    });
  }

  switchTab(tab: AgingTab): void {
    this.active_tab.set(tab);
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
