import { Component, input } from '@angular/core';

import { StatsComponent } from '../../../../../shared/components/stats/stats.component';

@Component({
  selector: 'app-template-stats',
  standalone: true,
  imports: [StatsComponent],
  template: `
    <div class="stats-container">
      <app-stats
        title="Total Templates"
        [value]="stats().totalTemplates"
        icon="file-text"
        color="primary"
      ></app-stats>
      <app-stats
        title="Active Templates"
        [value]="stats().activeTemplates"
        icon="check-circle"
        color="success"
      ></app-stats>
      <app-stats
        title="System Templates"
        [value]="stats().systemTemplates"
        icon="lock"
        color="warning"
      ></app-stats>
      <app-stats
        title="Custom Templates"
        [value]="stats().customTemplates"
        icon="unlock"
        color="info"
      ></app-stats>
    </div>
  `,
})
export class TemplateStatsComponent {
  readonly stats = input({
    totalTemplates: 0,
    activeTemplates: 0,
    systemTemplates: 0,
    customTemplates: 0,
});
}
