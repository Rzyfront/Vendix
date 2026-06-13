import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  CardComponent,
  StickyHeaderComponent,
  StatsComponent,
  ToastService,
} from '../../../../../../../shared/components/index';

import {
  EngineeringProduct,
  EngineeringQuadrant,
  MenuEngineeringReport,
} from '../../interfaces';
import { MenusService } from '../../services';

const QUADRANT_META: Record<
  EngineeringQuadrant,
  { label: string; description: string; color: string; icon: string }
> = {
  estrella: {
    label: 'Estrella',
    description: 'Alta popularidad · Alto margen',
    color: 'bg-green-50 border-green-300',
    icon: 'star',
  },
  caballo: {
    label: 'Caballo',
    description: 'Alta popularidad · Bajo margen',
    color: 'bg-amber-50 border-amber-300',
    icon: 'trending-up',
  },
  puzzle: {
    label: 'Puzzle',
    description: 'Baja popularidad · Alto margen',
    color: 'bg-blue-50 border-blue-300',
    icon: 'help-circle',
  },
  perro: {
    label: 'Perro',
    description: 'Baja popularidad · Bajo margen',
    color: 'bg-red-50 border-red-300',
    icon: 'x-octagon',
  },
};

@Component({
  selector: 'app-menu-engineering-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
  ],
  templateUrl: './menu-engineering-page.component.html',
  styleUrl: './menu-engineering-page.component.scss',
})
export class MenuEngineeringPageComponent implements OnInit {
  private readonly menusService = inject(MenusService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly report = signal<MenuEngineeringReport | null>(null);
  readonly isLoading = signal(false);
  readonly meta = QUADRANT_META;
  readonly quadrants: EngineeringQuadrant[] = [
    'estrella',
    'caballo',
    'puzzle',
    'perro',
  ];

  // Default range: last 30 days.
  readonly from = signal(this.daysAgoIso(30));
  readonly to = signal(this.daysAgoIso(0));

  readonly summary = computed(() => {
    const r = this.report();
    if (!r) {
      return {
        total_products: 0,
        units_sold: 0,
        revenue: 0,
        profit: 0,
      };
    }
    return {
      total_products: r.total_products,
      units_sold: r.totals.units_sold,
      revenue: r.totals.revenue,
      profit: r.totals.profit,
    };
  });

  ngOnInit(): void {
    this.loadReport();
  }

  loadReport(): void {
    this.isLoading.set(true);
    this.menusService
      .engineeringReport({
        from: this.from(),
        to: this.to(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.report.set(data);
          this.isLoading.set(false);
        },
        error: (e: unknown) => {
          this.toastService.error(
            typeof e === 'string'
              ? e
              : 'Error al generar el reporte de ingeniería',
          );
          this.isLoading.set(false);
        },
      });
  }

  productsOf(quadrant: EngineeringQuadrant): EngineeringProduct[] {
    return this.report()?.groups?.[quadrant] ?? [];
  }

  countOf(quadrant: EngineeringQuadrant): number {
    return this.report()?.counts?.[quadrant] ?? 0;
  }

  formatCurrency(n: number): string {
    return n.toLocaleString('es-CO', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  private daysAgoIso(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }
}
