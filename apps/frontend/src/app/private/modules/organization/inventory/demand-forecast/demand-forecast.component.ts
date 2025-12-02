import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-demand-forecast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Previsión de la demanda</h1>

      <div class="bg-white rounded-lg shadow p-6">
        <p class="text-gray-600">
          Aquí se mostrarán las previsiones de demanda y los análisis
          predictivos.
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
export class DemandForecastComponent {}
