import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ReportCardComponent } from '../../components/report-card/report-card.component';
import { ReportSearchComponent } from '../../components/report-search/report-search.component';
import { ReportCategoryChipsComponent } from '../../components/report-category-chips/report-category-chips.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ReportCategoryId, ReportDefinition } from '../../interfaces/report.interface';
import { REPORT_CATEGORIES, REPORT_DEFINITIONS, getCategoryById } from '../../config/report-registry';

@Component({
  selector: 'vendix-report-list',
  standalone: true,
  imports: [
    CommonModule,
    ReportCardComponent,
    ReportSearchComponent,
    ReportCategoryChipsComponent,
    IconComponent,
  ],
  templateUrl: './report-list.component.html',
  styleUrls: ['./report-list.component.scss'],
})
export class ReportListComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroy$ = new Subject<void>();

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

  ngOnInit(): void {
    // Read queryParam for category pre-filter (e.g., from accounting sidebar)
    this.route.queryParamMap
      .pipe(takeUntil(this.destroy$))
      .subscribe(params => {
        const category = params.get('category');
        if (category && this.categories.some(c => c.id === category)) {
          this.activeCategory.set(category as ReportCategoryId);
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchChange(term: string): void {
    this.searchTerm.set(term);
  }

  onCategoryChange(category: ReportCategoryId | null): void {
    this.activeCategory.set(category);
  }

  onReportSelected(reportId: string): void {
    this.router.navigate([reportId], { relativeTo: this.route });
  }
}
