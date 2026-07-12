import {Component, inject, signal, computed, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgClass } from '@angular/common';
import { CarteraService } from '../../services/cartera.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  CardComponent,
  IconComponent,
  ButtonComponent,
  AlertBannerComponent,
} from '../../../../../../shared/components/index';
import { AgingReport } from '../../interfaces/cartera.interface';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { forkJoin } from 'rxjs';

type AgingTab = 'ar' | 'ap';

@Component({
  selector: 'vendix-aging-report',
  standalone: true,
  imports: [CardComponent, IconComponent, ButtonComponent, AlertBannerComponent,
    NgClass,
  ],
  templateUrl: './aging-report.component.html',
})
export class AgingReportComponent {
  private destroyRef = inject(DestroyRef);
  private cartera = inject(CarteraService);
  private currency = inject(CurrencyFormatService);

  readonly active_tab = signal<AgingTab>('ar');
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
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
    this.error.set(null);

    forkJoin({
      ar: this.cartera.getArAging(),
      ap: this.cartera.getApAging(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ ar, ap }) => {
          this.ar_aging.set(ar.data);
          this.ap_aging.set(ap.data);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(parseApiError(err).userMessage);
          this.loading.set(false);
        },
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
      'bg-success',  // Current
      'bg-[color-mix(in_srgb,var(--color-success),var(--color-warning))]',   // 1-30
      'bg-warning',   // 31-60
      'bg-[color-mix(in_srgb,var(--color-warning),var(--color-error))]',      // 61-90
      'bg-error',      // 91-120
      'bg-[color-mix(in_srgb,var(--color-error),var(--color-text-primary)_35%)]',      // 120+
    ];
    return colors[index] || 'bg-[var(--color-text-secondary)]';
  }

  getBucketTextColor(index: number): string {
    const colors = [
      'text-success',
      'text-[color-mix(in_srgb,var(--color-success),var(--color-warning))]',
      'text-warning',
      'text-[color-mix(in_srgb,var(--color-warning),var(--color-error))]',
      'text-error',
      'text-[color-mix(in_srgb,var(--color-error),var(--color-text-primary)_35%)]',
    ];
    return colors[index] || 'text-text-primary';
  }
}
