import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { WithholdingTaxService } from './services/withholding-tax.service';
import { WithholdingStats } from './interfaces/withholding.interface';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import {
  ScrollableTab,
  ScrollableTabsComponent,
} from '../../../../shared/components';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';
import { WithholdingConceptsTabComponent } from './components/withholding-concepts-tab.component';
import { WithholdingCalculationsListComponent } from './components/withholding-calculations-list.component';
import { WithholdingCertificateViewerComponent } from './components/withholding-certificate-viewer.component';

/**
 * Retenciones container: stats cards on top plus three internal tabs —
 * Conceptos (CRUD), Cálculos (audit of practiced/suffered withholdings) and
 * Certificados (printable art. 381 ET certificates per supplier/year).
 */
@Component({
  selector: 'app-withholding-tax',
  standalone: true,
  imports: [
    StatsComponent,
    ScrollableTabsComponent,
    WithholdingConceptsTabComponent,
    WithholdingCalculationsListComponent,
    WithholdingCertificateViewerComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats -->
      <div class="sticky top-0 z-20 bg-white dark:bg-gray-900 pb-2 md:static md:z-auto">
        <div class="flex gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-4 md:overflow-visible">
          <app-stats title="Conceptos Activos" [value]="stats()?.active_concepts || 0" icon="file-text" color="blue"></app-stats>
          <app-stats title="UVT Vigente" [value]="formatCurrency(stats()?.current_uvt || 0)" icon="calculator" color="green"></app-stats>
          <app-stats title="Ret. del Mes" [value]="formatCurrency(stats()?.month_withholdings || 0)" icon="trending-down" color="orange"></app-stats>
          <app-stats title="Ret. del Año" [value]="formatCurrency(stats()?.year_withholdings || 0)" icon="calendar" color="purple"></app-stats>
        </div>
      </div>

      <!-- Tabs -->
      <div class="mt-2 mb-3">
        <app-scrollable-tabs
          [tabs]="tabs"
          [activeTab]="activeTab()"
          (tabChange)="onTabChange($event)"
          size="sm"
        ></app-scrollable-tabs>
      </div>

      <!-- Tab Content -->
      @if (activeTab() === 'concepts') {
        <app-withholding-concepts-tab
          (changed)="loadStats()"
        ></app-withholding-concepts-tab>
      } @else if (activeTab() === 'calculations') {
        <app-withholding-calculations-list></app-withholding-calculations-list>
      } @else if (activeTab() === 'certificates') {
        <app-withholding-certificate-viewer></app-withholding-certificate-viewer>
      }
    </div>
  `,
})
export class WithholdingTaxComponent {
  private service = inject(WithholdingTaxService);
  private currencyService = inject(CurrencyFormatService);
  private destroyRef = inject(DestroyRef);

  readonly stats = signal<WithholdingStats | null>(null);
  readonly activeTab = signal<string>('concepts');

  readonly tabs: ScrollableTab[] = [
    { id: 'concepts', label: 'Conceptos', icon: 'file-text' },
    { id: 'calculations', label: 'Cálculos', icon: 'calculator' },
    { id: 'certificates', label: 'Certificados', icon: 'printer' },
  ];

  constructor() {
    this.loadStats();
  }

  onTabChange(tabId: string): void {
    this.activeTab.set(tabId);
  }

  loadStats(): void {
    this.service.getStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res: any) => {
        const data = res?.data;
        if (!data) {
          this.stats.set(null);
          return;
        }
        // Map the backend stats shape (current_uvt_value + monthly/yearly
        // aggregates) onto the flat card model used by the template.
        this.stats.set({
          active_concepts: Number(data.active_concepts) || 0,
          current_uvt:
            Number(data.current_uvt_value ?? data.current_uvt) || 0,
          month_withholdings:
            Number(
              data.monthly?.total_withheld ?? data.month_withholdings,
            ) || 0,
          year_withholdings:
            Number(data.yearly?.total_withheld ?? data.year_withholdings) ||
            0,
        });
      });
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(Number(value) || 0, 0);
  }
}
