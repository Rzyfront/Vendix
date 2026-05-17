import { Component, input, output, computed } from '@angular/core';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { AnalyticsCategory, AnalyticsCategoryId } from '../../config/analytics-registry';

@Component({
  selector: 'app-analytics-category-chips',
  standalone: true,
  imports: [ButtonComponent, IconComponent],
  templateUrl: './analytics-category-chips.component.html',
  styleUrls: ['./analytics-category-chips.component.scss'],
})
export class AnalyticsCategoryChipsComponent {
  readonly categories = input.required<AnalyticsCategory[]>();
  readonly selectedCategory = input<AnalyticsCategoryId | null>(null);

  readonly categoryChange = output<AnalyticsCategoryId | null>();

  readonly chips = computed(() => {
    return this.categories().map((cat) => ({
      ...cat,
      isSelected: this.selectedCategory() === cat.id,
    }));
  });

  onChipClick(categoryId: AnalyticsCategoryId | null): void {
    this.categoryChange.emit(
      categoryId === this.selectedCategory() ? null : categoryId,
    );
  }

  getChipVariant(isSelected: boolean): 'primary' | 'outline' {
    return isSelected ? 'primary' : 'outline';
  }

  trackByCategoryId(
    index: number,
    chip: AnalyticsCategory & { isSelected: boolean },
  ): string {
    return chip.id;
  }
}
