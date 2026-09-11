import { Component, input, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

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
 * overview summary itself — pero FIX QUI-807: si la card apunta a la
 * misma URL donde el catálogo está montado (route == current URL),
 * se oculta del catálogo visible. El click en una card con route ==
 * router.url es un no-op (router no navega a la misma URL); la fix
 * correcta es no mostrarla, no forzar recarga.
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

  /**
   * FIX QUI-807 — el catálogo se renderiza a veces dentro de la misma ruta
   * que uno de los reports listados (ej. `/admin/reports/overview/overview-summary`
   * muestra la card de "Resumen General" cuya `route` apunta a la misma URL).
   * Si dejamos esa card visible, el click ejecuta
   * `router.navigateByUrl(router.url)` que el router trata como no-op
   * (mismo destino → sin navegación visible → "no hace nada").
   *
   * Excluimos del catálogo toda card cuya `route` coincida con la URL
   * actual, normalizando con `router.parseUrl(route).toString()` para
   * cubrir diferencias de trailing slash / query / fragment.
   */
  private readonly router = inject(Router);

  private normalize(url: string): string {
    // Parseamos la URL con el router y comparamos sólo el segmento primary
    // (path sin query/fragment). Dos URLs son "iguales" si comparten path
    // base: `/admin/reports/overview/overview-summary` y
    // `/admin/reports/overview/overview-summary?foo=1` matchean, pero
    // `/admin/reports/sales/summary` no.
    try {
      const tree = this.router.parseUrl(url);
      const primary = tree.root.children['primary']?.segments ?? [];
      return primary.map((s) => s.path).join('/');
    } catch {
      return url.split('?')[0];
    }
  }

  /**
   * Reports visibles: `reports()` menos los que apuntan a la URL actual.
   * Usado por `filteredReports`, `categoryCounts` y `reportsByCategory`
   * para mantener coherentes los contadores y la grilla.
   */
  private readonly availableReports = computed(() => {
    const current = this.normalize(this.router.url);
    return this.reports().filter(
      (r) => this.normalize(r.route) !== current,
    );
  });

  /** O(1) lookup of category metadata by id (label, icon, color). */
  private readonly categoryById = computed(
    () => new Map(this.categories().map((c) => [c.id, c])),
  );

  /**
   * Reports that survive the active filter (category + search).
   * Unlike the analytics catalog, `overview` is NOT excluded — the
   * overview summary lives on this same page. (FIX QUI-807: pero sí se
   * excluye del catálogo visible cuando la URL actual coincide con su
   * `route`; ver `availableReports`.)
   */
  readonly filteredReports = computed(() => {
    const category = this.selectedCategory();
    const search = this.searchTerm().toLowerCase().trim();

    let reports = this.availableReports();

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
    // FIX QUI-807: contar `availableReports` (que ya excluye los de la
    // URL actual) para que el contador del chip matchee la grilla visible.
    for (const report of this.availableReports()) {
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
