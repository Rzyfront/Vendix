import { Component, input, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';

import { ReportCategoryChipsComponent } from './components/report-category-chips/report-category-chips.component';
import { ReportCatalogCardComponent } from './components/report-catalog-card/report-catalog-card.component';

import {
  ReportCategory,
  ReportCategoryId,
  ReportDefinition,
} from '../../interfaces/report.interface';
import {
  REPORT_CATEGORIES,
  REPORT_DEFINITIONS,
} from '../../config/report-registry';

/**
 * ReportsCatalogComponent
 *
 * Composes the visual catalog of reports for `/admin/reports/overview/overview-summary`
 * (and any future page that wants the same browsing UX). Renders a header
 * with title + counter, a category chip filter, a debounced search input,
 * and a responsive grid of `ReportCatalogCardComponent`s grouped by
 * category. Empty state shows `search-x` icon with a hint message.
 *
 * Replicates the visual pattern of the analytics catalog
 * (`analytics/pages/overview/overview-summary`) but bound to the
 * `REPORT_CATEGORIES` / `REPORT_DEFINITIONS` registry so it can grow to
 * 30+ reports without touching this component.
 *
 * Notable difference vs the analytics catalog: `overview-summary` IS
 * shown here (not filtered out), because this page IS the host of the
 * overview summary itself.
 *
 * Both `reports` and `categories` are optional inputs with sensible
 * defaults from the registry — the parent can pass a filtered subset
 * for future reuses (e.g. a landing page restricted to one category).
 */
@Component({
  selector: 'app-reports-catalog',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    IconComponent,
    InputsearchComponent,
    ReportCategoryChipsComponent,
    ReportCatalogCardComponent,
  ],
  templateUrl: './reports-catalog.component.html',
  styleUrls: ['./reports-catalog.component.scss'],
})
export class ReportsCatalogComponent {
  readonly reports = input<ReportDefinition[]>(REPORT_DEFINITIONS);
  readonly categories = input<ReportCategory[]>(REPORT_CATEGORIES);

  readonly selectedCategory = signal<ReportCategoryId | null>(null);
  readonly searchTerm = signal<string>('');

  /** O(1) lookup of category metadata by id (label, icon, color). */
  private readonly categoryById = computed(
    () => new Map(this.categories().map((c) => [c.id, c])),
  );

  /**
   * Reports that survive the active filter (category + search).
   * Unlike the analytics catalog, `overview` is NOT excluded — the
   * overview summary lives on this same page.
   */
  readonly filteredReports = computed(() => {
    const category = this.selectedCategory();
    const search = this.searchTerm().toLowerCase().trim();

    let reports = this.reports();

    if (category) {
      reports = reports.filter((r) => r.category === category);
    }

    if (search) {
      reports = reports.filter(
        (r) =>
          r.title.toLowerCase().includes(search) ||
          r.description.toLowerCase().includes(search),
      );
    }

    return reports;
  });

  /** Filtered reports grouped by their category, in registry order. */
  readonly reportsByCategory = computed(() => {
    const grouped = new Map<ReportCategoryId, ReportDefinition[]>();
    const orderedCategories = this.categories();

    for (const cat of orderedCategories) {
      grouped.set(cat.id, []);
    }

    for (const report of this.filteredReports()) {
      const bucket = grouped.get(report.category);
      if (bucket) bucket.push(report);
    }

    return grouped;
  });

  /** Per-category counts for the chip badges. */
  readonly categoryCounts = computed(() => {
    const counts = new Map<ReportCategoryId, number>();
    for (const report of this.filteredReports()) {
      counts.set(report.category, (counts.get(report.category) ?? 0) + 1);
    }
    return counts;
  });

  onCategoryChange(id: ReportCategoryId | null): void {
    this.selectedCategory.set(id);
  }

  onSearchChange(term: string): void {
    this.searchTerm.set(term);
  }

  /** Helper for templates / external callers — count of reports in a category. */
  categoryCount(id: ReportCategoryId): number {
    return this.categoryCounts().get(id) ?? 0;
  }

  getCategoryColor = (id: ReportCategoryId): string => {
    return this.categoryById().get(id)?.color ?? 'var(--color-primary)';
  };

  getCategoryLabel = (id: ReportCategoryId): string => {
    return this.categoryById().get(id)?.label ?? id;
  };

  getCategoryIcon = (id: ReportCategoryId): string => {
    return this.categoryById().get(id)?.icon ?? 'folder';
  };
}
