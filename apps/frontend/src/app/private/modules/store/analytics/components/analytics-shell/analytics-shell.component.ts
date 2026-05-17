import { Component, computed, inject } from '@angular/core';
import { RouterOutlet, ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import {
  AnalyticsCategoryId,
  getCategoryById,
  getViewsByCategory,
} from '../../config/analytics-registry';
import {
  StickyHeaderComponent,
  StickyHeaderTab,
} from '../../../../../../shared/components/sticky-header/sticky-header.component';

@Component({
  selector: 'app-analytics-shell',
  standalone: true,
  imports: [RouterOutlet, StickyHeaderComponent],
  templateUrl: './analytics-shell.component.html',
  styleUrls: ['./analytics-shell.component.scss'],
})
export class AnalyticsShellComponent {
  private readonly route = inject(ActivatedRoute);

  private readonly categoryId = toSignal(
    this.route.data.pipe(map((data) => data['categoryId'] as AnalyticsCategoryId)),
  );

  readonly category = computed(() => {
    const categoryId = this.categoryId();
    return categoryId ? getCategoryById(categoryId) : undefined;
  });

  readonly tabs = computed<StickyHeaderTab[]>(() => {
    const categoryId = this.categoryId();
    if (!categoryId) return [];

    return getViewsByCategory(categoryId).map((view) => ({
      id: view.key,
      label: view.title,
      icon: view.icon,
      route: view.route,
    }));
  });
}
