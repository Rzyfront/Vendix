import { Component } from '@angular/core';

import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-audit',
  standalone: true,
  imports: [RouterModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Auditoría y Cumplimiento</h1>

      <!-- Navigation Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <a
          routerLink="/organization/audit/logs"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Registros de auditoría</h3>
          <p class="text-gray-600">Ver registros de auditoría del sistema</p>
        </a>

        <a
          routerLink="/organization/audit/login-attempts"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Intentos de Login</h3>
          <p class="text-gray-600">Monitoreo de intentos de inicio de sesión</p>
        </a>

        <a
          routerLink="/organization/audit/sessions"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Sesiones</h3>
          <p class="text-gray-600">Gestión de sesiones de usuarios</p>
        </a>

        <a
          routerLink="/organization/audit/compliance"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Informes de cumplimiento</h3>
          <p class="text-gray-600">Monitoreo de cumplimiento</p>
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
export class AuditComponent {}
