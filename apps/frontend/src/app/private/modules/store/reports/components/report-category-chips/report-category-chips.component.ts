import { Component, input, output, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ReportCategoryId } from '../../interfaces/report.interface';
import { REPORT_CATEGORIES, REPORT_DEFINITIONS } from '../../config/report-registry';

@Component({
  selector: 'vendix-report-category-chips',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './report-category-chips.component.html',
  styleUrls: ['./report-category-chips.component.scss'],
})
export class ReportCategoryChipsComponent {
  activeCategory = input<ReportCategoryId | null>(null);
  categoryChange = output<ReportCategoryId | null>();

  categories = REPORT_CATEGORIES;
  totalReports = REPORT_DEFINITIONS.length;

  getReportCount(categoryId: ReportCategoryId): number {
    return REPORT_DEFINITIONS.filter(r => r.category === categoryId).length;
  }

  isActive(categoryId: ReportCategoryId | null): boolean {
    return this.activeCategory() === categoryId;
  }

  selectCategory(categoryId: ReportCategoryId | null): void {
    this.categoryChange.emit(categoryId);
  }
}
