import { Component, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { AnalyticsView } from '../../config/analytics-registry';

@Component({
  selector: 'app-analytics-card',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './analytics-card.component.html',
  styleUrls: ['./analytics-card.component.scss'],
})
export class AnalyticsCardComponent {
  readonly view = input.required<AnalyticsView>();

  readonly cardClick = output<AnalyticsView>();

  constructor(private router: Router) {}

  onClick(): void {
    this.cardClick.emit(this.view());
    this.router.navigateByUrl(this.view().route);
  }
}
