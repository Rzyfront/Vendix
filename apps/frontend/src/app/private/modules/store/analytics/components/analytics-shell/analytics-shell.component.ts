import { Component, computed, inject } from '@angular/core';
import { RouterOutlet, ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { AnalyticsTabBarComponent } from '../analytics-tab-bar/analytics-tab-bar.component';
import {
  AnalyticsCategoryId,
  getCategoryById,
  getViewsByCategory,
} from '../../config/analytics-registry';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-analytics-shell',
  standalone: true,
  imports: [RouterOutlet, AnalyticsTabBarComponent, IconComponent],
  templateUrl: './analytics-shell.component.html',
  styleUrls: ['./analytics-shell.component.scss'],
})
export class AnalyticsShellComponent {
  private readonly route = inject(ActivatedRoute);

  private readonly categoryId = toSignal(
    this.route.data.pipe(map((data) => data['categoryId'] as AnalyticsCategoryId)),
  );

  readonly category = computed(() => getCategoryById(this.categoryId()!));
  readonly tabs = computed(() => getViewsByCategory(this.categoryId()!));
}
