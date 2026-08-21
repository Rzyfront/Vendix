import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

import { ReportsCatalogComponent } from '../../components/reports-catalog/reports-catalog.component';

import {
  REPORT_CATEGORIES,
  REPORT_DEFINITIONS,
} from '../../config/report-registry';
import {
  ReportCategory,
  ReportCategoryId,
  ReportDefinition,
} from '../../interfaces/report.interface';

/**
 * CategoryReportsCatalogComponent
 *
 * Generic host that renders the catalog of reports filtered to a single
 * parent category (sales, inventory, products, customers, purchases,
 * reviews, financial). Lives at `/admin/reports/{category}` for every
 * category that does NOT own its own consolidated summary.
 *
 * `/admin/reports/overview/overview-summary` keeps its custom summary
 * (the consolidated 8-card dashboard) and is the ONLY page with the
 * global summary view — every other sub-route now collapses into this
 * catalog via `redirectTo: ''`, so clicking on a category card lands on
 * the catalog page instead of a duplicated summary.
 *
 * Data flow:
 *   - `ActivatedRoute.data.categoryId` (signal via `toSignal`) is the
 *     single source of truth inherited from the parent `ReportsShellComponent`
 *     route config.
 *   - `filteredCategories` / `filteredReports` are pure `computed()` slices
 *     over the static `REPORT_CATEGORIES` / `REPORT_DEFINITIONS` registries.
 *
 * This component deliberately does NOT:
 *   - Inject `Store` (NgRx) — the catalog is read-only and registry-driven.
 *   - Fetch overview data — overview data lives on
 *     `OverviewSummaryReportComponent` only.
 *   - Manage filters, paginación or export — the catalog is the entry
 *     surface; clicking a card navigates to the real report.
 *
 * Skills applied:
 *   - `vendix-zoneless-signals` (signal reads, OnPush, no NgRx, no NgZone)
 *   - `vendix-frontend-component` (standalone, reuses shared `ReportsCatalogComponent`)
 *   - `vendix-frontend-routing` (reads `categoryId` from `ActivatedRoute.data`)
 */
@Component({
  selector: 'app-category-reports-catalog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReportsCatalogComponent],
  template: `
    <app-reports-catalog
      [categories]="filteredCategories()"
      [reports]="filteredReports()"
    />
  `,
})
export class CategoryReportsCatalogComponent {
  private readonly route = inject(ActivatedRoute);

  /**
   * `categoryId` inherited from the parent route's `data.categoryId`
   * (set on the `ReportsShellComponent` route AND on each child route for
   * self-containment). `undefined` while the route data has not emitted
   * yet — the computed slices fall back to empty arrays so the catalog
   * renders the empty state instead of leaking unrelated categories.
   */
  readonly categoryId = toSignal(
    this.route.data.pipe(map((data) => data['categoryId'] as ReportCategoryId | undefined)),
    { initialValue: undefined as ReportCategoryId | undefined },
  );

  /** Only the matching `ReportCategory` (used for chips/headers). */
  readonly filteredCategories = computed<ReportCategory[]>(() => {
    const id = this.categoryId();
    if (!id) return [];
    return REPORT_CATEGORIES.filter((c) => c.id === id);
  });

  /** Only the reports whose `category` matches the active parent. */
  readonly filteredReports = computed<ReportDefinition[]>(() => {
    const id = this.categoryId();
    if (!id) return [];
    return REPORT_DEFINITIONS.filter((r) => r.category === id);
  });
}