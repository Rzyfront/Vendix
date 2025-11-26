import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-cost-analysis',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Análisis de costos y márgenes</h1>

      <div class="bg-white rounded-lg shadow p-6">
        <p class="text-gray-600">
          Aquí se mostrarán el análisis de costos y los cálculos de márgenes.
        </p>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class CostAnalysisComponent {}
