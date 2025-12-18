import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-config',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Configuración de la organización</h1>

      <!-- Navigation Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <a
          routerLink="/organization/config/application"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">
            Configuración de la aplicación
          </h3>
          <p class="text-gray-600">Configuración general de la aplicación</p>
        </a>

        <a
          routerLink="/organization/config/policies"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Políticas</h3>
          <p class="text-gray-600">Políticas y reglas organizacionales</p>
        </a>

        <a
          routerLink="/organization/config/integrations"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Integraciones</h3>
          <p class="text-gray-600">Integraciones de terceros</p>
        </a>

        <a
          routerLink="/organization/config/taxes"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Impuestos</h3>
          <p class="text-gray-600">Configuración y tasas de impuestos</p>
        </a>

        <a
          routerLink="/organization/config/Dominios"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Dominios</h3>
          <p class="text-gray-600">Domain management</p>
        </a>
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
export class ConfigComponent {}
