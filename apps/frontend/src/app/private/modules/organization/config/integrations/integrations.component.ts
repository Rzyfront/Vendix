import { Component } from '@angular/core';


@Component({
  selector: 'app-integrations',
  standalone: true,
  imports: [],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Integraciones</h1>

      <div class="bg-white rounded-lg shadow p-6">
        <p class="text-gray-600">
          La gestión de integración de terceros se mostrará aquí
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
export class IntegrationsComponent {}
