import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartShowcaseComponent } from '../../../shared/components/chart/chart-showcase.component';

@Component({
  selector: 'app-charts-demo',
  standalone: true,
  imports: [CommonModule, ChartShowcaseComponent],
  template: `
    <div class="min-h-screen">
      <app-chart-showcase></app-chart-showcase>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class ChartsDemoComponent {}
