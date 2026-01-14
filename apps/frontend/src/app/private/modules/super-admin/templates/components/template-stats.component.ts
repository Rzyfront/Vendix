import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StatsComponent } from '../../../../../shared/components/stats/stats.component';

@Component({
  selector: 'app-template-stats',
  standalone: true,
  imports: [CommonModule, StatsComponent],
  template: `
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <app-stats
        title="Total Templates"
        [value]="stats.totalTemplates"
        icon="file-text"
        color="primary"
      ></app-stats>
      <app-stats
        title="Active Templates"
        [value]="stats.activeTemplates"
        icon="check-circle"
        color="success"
      ></app-stats>
      <app-stats
        title="System Templates"
        [value]="stats.systemTemplates"
        icon="lock"
        color="warning"
      ></app-stats>
      <app-stats
        title="Custom Templates"
        [value]="stats.customTemplates"
        icon="unlock"
        color="info"
      ></app-stats>
    </div>
  `,
})
export class TemplateStatsComponent {
  @Input() stats = {
    totalTemplates: 0,
    activeTemplates: 0,
    systemTemplates: 0,
    customTemplates: 0,
  };
}
