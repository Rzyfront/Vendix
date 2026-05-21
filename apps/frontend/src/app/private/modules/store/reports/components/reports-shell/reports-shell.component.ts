import { Component, computed, inject } from '@angular/core';
import { RouterOutlet, ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { ReportCategoryId } from '../../interfaces/report.interface';
import {
  getCategoryById,
  getReportsByCategory,
} from '../../config/report-registry';
import {
  StickyHeaderComponent,
  StickyHeaderTab,
  StickyHeaderActionButton,
} from '../../../../../../shared/components/sticky-header/sticky-header.component';

@Component({
  selector: 'app-reports-shell',
  standalone: true,
  imports: [RouterOutlet, StickyHeaderComponent],
  templateUrl: './reports-shell.component.html',
  styleUrls: ['./reports-shell.component.scss'],
})
export class ReportsShellComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly categoryId = toSignal(
    this.route.data.pipe(map((data) => data['categoryId'] as ReportCategoryId)),
  );

  readonly category = computed(() => {
    const categoryId = this.categoryId();
    return categoryId ? getCategoryById(categoryId) : undefined;
  });

  readonly tabs = computed<StickyHeaderTab[]>(() => {
    const categoryId = this.categoryId();
    if (!categoryId) return [];

    return getReportsByCategory(categoryId).map((report) => ({
      id: report.id,
      label: report.title,
      icon: report.icon,
      route: report.route,
    }));
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'view-analytics',
      label: 'Ver Analitica',
      icon: 'bar-chart-3',
      variant: 'outline',
    },
  ]);

  onActionClick(actionId: string): void {
    if (actionId === 'view-analytics') {
      this.router.navigateByUrl('/admin/analytics');
    }
  }
}
