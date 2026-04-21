import { Component, input, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { AnalyticsView, getCategoryById } from '../../config/analytics-registry';

@Component({
  selector: 'app-analytics-card',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './analytics-card.component.html',
  styleUrls: ['./analytics-card.component.scss'],
})
export class AnalyticsCardComponent {
  readonly view = input.required<AnalyticsView>();
  private readonly router = inject(Router);

  readonly showTooltip = signal(false);

  readonly categoryLabel = computed(() => {
    const cat = getCategoryById(this.view().category);
    return cat?.label ?? this.view().category;
  });

  readonly categoryColor = computed(() => {
    const cat = getCategoryById(this.view().category);
    return cat?.color ?? 'var(--color-primary)';
  });

  onClick(): void {
    this.router.navigateByUrl(this.view().route);
  }
}
