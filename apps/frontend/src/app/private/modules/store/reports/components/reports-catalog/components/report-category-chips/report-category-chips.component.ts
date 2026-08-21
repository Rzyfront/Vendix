import { Component, input, output, computed } from '@angular/core';
import { ButtonComponent } from '../../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../../shared/components/icon/icon.component';
import { ReportCategory, ReportCategoryId } from '../../../../interfaces/report.interface';

/**
 * ReportCategoryChipsComponent
 *
 * Chip filter for the reports catalog. Mirrors the visual pattern of
 * AnalyticsCategoryChipsComponent (rounded-full buttons with category icon
 * + label) but bound to `ReportCategory` / `ReportCategoryId` instead of
 * analytics domain types to avoid cross-domain coupling.
 *
 * The component renders:
 * - 1 "Todas" chip (selected when `selectedCategory === null`)
 * - 1 chip per entry in `categories()` (10 in current registry)
 *
 * Each chip shows icon + label + an optional count badge. The count comes
 * from the parent via `categoryCounts` (Map<ReportCategoryId, number>) —
 * the parent computes the counts from `REPORT_DEFINITIONS`. The "Todas"
 * chip shows the sum of all counts.
 *
 * Toggle behavior: clicking a selected chip emits `null` (reset filter);
 * clicking another emits the new category id.
 */
@Component({
  selector: 'app-report-category-chips',
  standalone: true,
  imports: [ButtonComponent, IconComponent],
  templateUrl: './report-category-chips.component.html',
  styleUrls: ['./report-category-chips.component.scss'],
})
export class ReportCategoryChipsComponent {
  readonly categories = input.required<ReportCategory[]>();
  readonly selectedCategory = input<ReportCategoryId | null>(null);

  /**
   * Optional per-category counts, keyed by category id. The parent
   * (ReportsCatalogComponent) computes this from the filtered list of
   * reports so the chip badge reflects what is actually renderable.
   *
   * If `undefined`, no badge is shown.
   */
  readonly categoryCounts = input<ReadonlyMap<ReportCategoryId, number> | undefined>(undefined);

  readonly categoryChange = output<ReportCategoryId | null>();

  readonly chips = computed(() => {
    return this.categories().map((cat) => ({
      ...cat,
      isSelected: this.selectedCategory() === cat.id,
      count: this.categoryCounts()?.get(cat.id),
    }));
  });

  readonly totalCount = computed(() => {
    const counts = this.categoryCounts();
    if (!counts) {
      return undefined;
    }
    let total = 0;
    counts.forEach((value) => (total += value));
    return total;
  });

  onChipClick(categoryId: ReportCategoryId | null): void {
    this.categoryChange.emit(
      categoryId === this.selectedCategory() ? null : categoryId,
    );
  }

  getChipVariant(isSelected: boolean): 'primary' | 'outline' {
    return isSelected ? 'primary' : 'outline';
  }

  trackByCategoryId(
    _index: number,
    chip: ReportCategory & { isSelected: boolean; count?: number },
  ): string {
    return chip.id;
  }
}
