import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { WithholdingTaxService } from './services/withholding-tax.service';
import { WithholdingStats } from './interfaces/withholding.interface';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';

/** Routed views that change the stats expose a `changed` output (Conceptos). */
interface StatsChangingView {
  changed: { subscribe(listener: () => void): unknown };
}

function changesStats(view: unknown): view is StatsChangingView {
  const changed = (view as Partial<StatsChangingView> | null)?.changed;
  return typeof changed?.subscribe === 'function';
}

/**
 * Retenciones container: stats cards on top of the routed view. Conceptos
 * (CRUD), Retenciones calculadas (audit of practiced/suffered withholdings)
 * and Certificados (printable art. 381 ET certificates per supplier/year) are
 * sibling pills of Impuestos (layer 4), declared in `TAXES_SUB_TABS`, so this
 * component no longer renders its own tab row (that was a layer 5).
 */
@Component({
  selector: 'app-withholding-tax',
  standalone: true,
  imports: [StatsComponent, RouterOutlet],
  template: `
    <div class="w-full">
      <!-- Stats -->
      <div class="sticky top-0 z-20 bg-background pb-2 md:static md:z-auto">
        <div class="flex gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-4 md:overflow-visible">
          <app-stats title="Conceptos Activos" [value]="stats()?.active_concepts || 0" icon="file-text" color="blue"></app-stats>
          <app-stats title="UVT Vigente" [value]="formatCurrency(stats()?.current_uvt || 0)" icon="calculator" color="green"></app-stats>
          <app-stats title="Ret. del Mes" [value]="formatCurrency(stats()?.month_withholdings || 0)" icon="trending-down" color="orange"></app-stats>
          <app-stats title="Ret. del Año" [value]="formatCurrency(stats()?.year_withholdings || 0)" icon="calendar" color="purple"></app-stats>
        </div>
      </div>

      <!-- Routed view -->
      <div class="mt-2">
        <router-outlet (activate)="onActivate($event)" />
      </div>
    </div>
  `,
})
export class WithholdingTaxComponent {
  private service = inject(WithholdingTaxService);
  private currencyService = inject(CurrencyFormatService);
  private destroyRef = inject(DestroyRef);

  readonly stats = signal<WithholdingStats | null>(null);

  constructor() {
    this.loadStats();
  }

  /**
   * Conceptos edits change the "Conceptos Activos" card. The view is routed,
   * so its `changed` output is wired here instead of in the template. It is
   * matched by shape, not by class, so this shell does not import Conceptos and
   * its route keeps loading lazily. The subscription ends with the routed
   * component.
   */
  onActivate(view: unknown): void {
    if (changesStats(view)) {
      view.changed.subscribe(() => this.loadStats());
    }
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
