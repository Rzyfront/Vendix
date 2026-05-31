import { Component, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Router, ActivatedRoute } from '@angular/router';
import { ReportCardComponent } from '../../components/report-card/report-card.component';
import { ReportSearchComponent } from '../../components/report-search/report-search.component';
import { ReportCategoryChipsComponent } from '../../components/report-category-chips/report-category-chips.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { StickyHeaderComponent } from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { ReportCategoryId, ReportDefinition } from '../../interfaces/report.interface';
import { REPORT_CATEGORIES, REPORT_DEFINITIONS, getCategoryById, getReportById } from '../../config/report-registry';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

const DISABLED_MODULE_MESSAGES: Record<string, { moduleKey: string; message: string }> = {
  accounting: { moduleKey: 'accounting', message: 'Módulo de Contabilidad desactivado' },
  payroll: { moduleKey: 'payroll', message: 'Módulo de Nómina desactivado' },
};

@Component({
  selector: 'vendix-report-list',
  standalone: true,
  imports: [
    ReportCardComponent,
    ReportSearchComponent,
    ReportCategoryChipsComponent,
    IconComponent,
    StickyHeaderComponent
],
  templateUrl: './report-list.component.html',
  styleUrls: ['./report-list.component.scss'],
})
export class ReportListComponent {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private authFacade = inject(AuthFacade);
  private toast = inject(ToastService);

  searchTerm = signal('');
  activeCategory = signal<ReportCategoryId | null>(null);

  categories = REPORT_CATEGORIES;
  allReports = REPORT_DEFINITIONS;

  filteredGroups = computed(() => {
    const search = this.searchTerm().toLowerCase().trim();
    const category = this.activeCategory();

    // Filter categories to show
    const categoriesToShow = category
      ? this.categories.filter(c => c.id === category)
      : this.categories;

    return categoriesToShow
      .map(cat => {
        let reports = this.allReports.filter(r => r.category === cat.id);

        // Apply search filter
        if (search) {
          reports = reports.filter(r =>
            r.title.toLowerCase().includes(search) ||
            r.description.toLowerCase().includes(search) ||
            r.detailedDescription.toLowerCase().includes(search)
          );
        }

        return { category: cat, reports };
      })
      .filter(group => group.reports.length > 0);
  });

  totalFiltered = computed(() =>
    this.filteredGroups().reduce((sum, g) => sum + g.reports.length, 0)
  );

  constructor() {
    // Read queryParam for category pre-filter (e.g., from accounting sidebar)
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => {
        const category = params.get('category');
        if (category && this.categories.some(c => c.id === category)) {
          this.activeCategory.set(category as ReportCategoryId);
        }
      });
  }

  onSearchChange(term: string): void {
    this.searchTerm.set(term);
  }

  onCategoryChange(category: ReportCategoryId | null): void {
    if (category && this.isModuleDisabled(category)) return;
    this.activeCategory.set(category);
  }

  onReportSelected(reportId: string): void {
    const report = getReportById(reportId);
    if (report && this.isModuleDisabled(report.category)) return;
    this.router.navigate([reportId], { relativeTo: this.route });
  }

  private isModuleDisabled(categoryId: string): boolean {
    const config = DISABLED_MODULE_MESSAGES[categoryId];
    if (!config) return false;
    if (this.authFacade.isModuleVisible(config.moduleKey)) return false;
    this.toast.warning(config.message);
    return true;
  }
}
