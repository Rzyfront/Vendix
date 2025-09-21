import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

interface SubmenuItem {
  id: string;
  label: string;
  icon: string;
  route: string;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="flex h-screen bg-gray-50">
      <!-- Main Content -->
      <div class="flex-1 flex flex-col overflow-hidden">
        <!-- Header -->
        <div class="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
          <div class="flex items-center justify-between">
            <div>
              <h1 class="text-2xl font-bold text-gray-900">Configuración</h1>
              <p class="text-sm text-gray-600 mt-1">Administra la configuración del sistema</p>
            </div>
          </div>
        </div>

        <!-- Content Area -->
        <div class="flex-1 overflow-y-auto p-6">
          <router-outlet></router-outlet>
        </div>
      </div>

      <!-- Right Sidebar Submenu -->
      <aside class="w-80 bg-white border-l border-gray-200 p-6">
        <!-- Submenu Header -->
        <div class="mb-6">
          <h3 class="text-lg font-semibold text-gray-900 mb-2">Opciones</h3>
          <p class="text-sm text-gray-600">Configuraciones disponibles</p>
        </div>

        <!-- Submenu Items -->
        <nav class="space-y-2 mb-8">
          <button
            *ngFor="let item of submenuItems"
            [routerLink]="[item.route]"
            routerLinkActive="active"
            class="submenu-item w-full flex items-center space-x-3 p-3 rounded-lg cursor-pointer transition-all duration-200"
          >
            <i [class]="'fas fa-' + item.icon + ' w-4 text-gray-600'"></i>
            <span class="font-medium text-sm">{{ item.label }}</span>
          </button>
        </nav>

        <!-- Quick Actions -->
        <div class="p-4 bg-gradient-to-br from-primary/5 to-secondary/5 rounded-xl">
          <h4 class="font-semibold text-text-primary mb-3">Acciones Rápidas</h4>
          <div class="space-y-2">
            <button class="w-full text-left p-2 text-sm text-text-secondary hover:bg-white hover:shadow-sm rounded-lg transition-all duration-200">
              <i class="fas fa-save w-4 mr-2"></i>
              Guardar configuración
            </button>
            <button class="w-full text-left p-2 text-sm text-text-secondary hover:bg-white hover:shadow-sm rounded-lg transition-all duration-200">
              <i class="fas fa-undo w-4 mr-2"></i>
              Restaurar por defecto
            </button>
            <button class="w-full text-left p-2 text-sm text-text-secondary hover:bg-white hover:shadow-sm rounded-lg transition-all duration-200">
              <i class="fas fa-file-export w-4 mr-2"></i>
              Exportar configuración
            </button>
          </div>
        </div>
      </aside>
    </div>
  `,
  styles: [`
    :host {
      @apply h-screen;
    }

    .submenu-item:hover {
      background-color: #f1f5f9;
      padding-left: 1rem;
    }

    .submenu-item.active {
      background-color: var(--color-secondary);
      color: white;
      border-radius: 6px;
      margin-left: 0.25rem;
      margin-right: 0.25rem;
    }

    .submenu-item.active i {
      color: white;
    }
  `]
})
export class SettingsComponent {
  submenuItems: SubmenuItem[] = [
    {
      id: 'general',
      label: 'Configuración General',
      icon: 'cog',
      route: './general'
    },
    {
      id: 'roles',
      label: 'Roles y Permisos',
      icon: 'user-shield',
      route: './roles'
    }
  ];
}
