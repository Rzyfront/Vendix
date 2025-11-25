import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-users-management',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Gestión de usuarios</h1>

      <!-- Navigation Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <a
          routerLink="/organization/users/global-users"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Usuarios globales</h3>
          <p class="text-gray-600">Administrar usuarios de la organización</p>
        </a>

        <a
          routerLink="/organization/users/roles-permissions"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Roles y permisos</h3>
          <p class="text-gray-600">Configurar roles de usuario</p>
        </a>

        <a
          routerLink="/organization/users/store-assignments"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Asignaciones de tienda</h3>
          <p class="text-gray-600">Asignar usuarios a tiendas</p>
        </a>

        <a
          routerLink="/organization/users/access-audit"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Auditoría de acceso</h3>
          <p class="text-gray-600">Ver registros de acceso</p>
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
export class UsersManagementComponent {}
