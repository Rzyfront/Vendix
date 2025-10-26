import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../shared/components/index';
import { User, UserState } from '../interfaces/user.interface';

@Component({
  selector: 'app-user-card',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div
      class="bg-surface rounded-lg border border-border p-4 shadow-sm hover:shadow-md transition-shadow duration-200"
    >
      <!-- User Info -->
      <div class="flex items-start justify-between mb-3">
        <div class="flex-1">
          <div class="flex items-center gap-3">
            <div
              class="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center"
            >
              <span class="text-primary font-semibold text-lg">
                {{ getInitials(user.first_name, user.last_name) }}
              </span>
            </div>
            <div>
              <h3 class="font-semibold text-text">
                {{ user.first_name }} {{ user.last_name }}
              </h3>
              <p class="text-sm text-text-muted">{{ '@' + user.username }}</p>
            </div>
          </div>
        </div>

        <!-- Status Badge -->
        <div
          class="px-2 py-1 rounded-full text-xs font-medium"
          [class]="getStatusClass(user.state)"
        >
          {{ getStatusText(user.state) }}
        </div>
      </div>

      <!-- Email -->
      <div class="mb-3">
        <p class="text-sm text-text-muted">Email</p>
        <div class="flex items-center gap-2">
          <span class="text-text">{{ user.email }}</span>
          <app-icon
            *ngIf="user.email_verified"
            name="check"
            class="w-4 h-4 text-green-500"
          ></app-icon>
        </div>
      </div>

      <!-- Organization -->
      <div class="mb-3" *ngIf="user.organizations">
        <p class="text-sm text-text-muted">Organización</p>
        <p class="text-text">{{ user.organizations.name }}</p>
      </div>

      <!-- Roles -->
      <div class="mb-3" *ngIf="user.user_roles && user.user_roles.length > 0">
        <p class="text-sm text-text-muted">Roles</p>
        <div class="flex flex-wrap gap-1">
          <span
            *ngFor="let userRole of user.user_roles"
            class="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs rounded"
          >
            {{ userRole.roles.name }}
          </span>
        </div>
      </div>

      <!-- Security Indicators -->
      <div class="flex items-center gap-4 text-sm text-text-muted mb-3">
        <div class="flex items-center gap-1">
          <app-icon name="shield" class="w-4 h-4"></app-icon>
          <span>2FA</span>
          <span
            [class]="
              user.two_factor_enabled ? 'text-green-500' : 'text-gray-400'
            "
          >
            {{ user.two_factor_enabled ? 'Activo' : 'Inactivo' }}
          </span>
        </div>
        <div class="flex items-center gap-1">
          <app-icon name="search" class="w-4 h-4"></app-icon>
          <span>Email</span>
          <span
            [class]="user.email_verified ? 'text-green-500' : 'text-yellow-500'"
          >
            {{ user.email_verified ? 'Verificado' : 'Pendiente' }}
          </span>
        </div>
      </div>

      <!-- Last Login -->
      <div class="text-sm text-text-muted">
        <p>
          Último acceso:
          {{ user.last_login ? formatDate(user.last_login) : 'Nunca' }}
        </p>
      </div>

      <!-- Actions -->
      <div class="flex justify-end gap-2 mt-4 pt-3 border-t border-border">
        <button
          (click)="onEdit.emit(user)"
          class="px-3 py-1 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors duration-200 flex items-center gap-1"
        >
          <app-icon name="edit" class="w-4 h-4"></app-icon>
          Editar
        </button>

        <button
          (click)="onToggleStatus.emit(user)"
          [disabled]="isLoading"
          class="px-3 py-1 text-sm rounded transition-colors duration-200 flex items-center gap-1 disabled:opacity-50"
          [class]="
            user.state === UserState.ACTIVE
              ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
              : 'bg-green-500 hover:bg-green-600 text-white'
          "
        >
          <app-icon name="users" class="w-4 h-4"></app-icon>
          {{ user.state === UserState.ACTIVE ? 'Suspender' : 'Activar' }}
        </button>

        <button
          (click)="onDelete.emit(user)"
          [disabled]="isLoading"
          class="px-3 py-1 text-sm bg-red-500 hover:bg-red-600 text-white rounded transition-colors duration-200 flex items-center gap-1 disabled:opacity-50"
        >
          <app-icon name="delete" class="w-4 h-4"></app-icon>
          Eliminar
        </button>
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
export class UserCardComponent {
  @Input() user!: User;
  @Input() isLoading: boolean = false;
  @Output() onEdit = new EventEmitter<User>();
  @Output() onDelete = new EventEmitter<User>();
  @Output() onToggleStatus = new EventEmitter<User>();

  UserState = UserState;

  constructor() {}

  // Format date helper
  formatDate(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 1) {
      const diffInMinutes = Math.floor(
        (now.getTime() - date.getTime()) / (1000 * 60),
      );
      return `Hace ${diffInMinutes} minuto${diffInMinutes !== 1 ? 's' : ''}`;
    } else if (diffInHours < 24) {
      return `Hace ${Math.floor(diffInHours)} hora${Math.floor(diffInHours) !== 1 ? 's' : ''}`;
    } else if (diffInHours < 48) {
      return 'Ayer';
    } else {
      return date.toLocaleDateString('es-ES');
    }
  }

  getInitials(firstName: string, lastName: string): string {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  }

  getStatusClass(state: UserState): string {
    switch (state) {
      case UserState.ACTIVE:
        return 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300';
      case UserState.INACTIVE:
        return 'bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-300';
      case UserState.PENDING_VERIFICATION:
        return 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300';
      case UserState.SUSPENDED:
        return 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300';
      case UserState.ARCHIVED:
        return 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300';
      default:
        return 'bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-300';
    }
  }

  getStatusText(state: UserState): string {
    switch (state) {
      case UserState.ACTIVE:
        return 'Activo';
      case UserState.INACTIVE:
        return 'Inactivo';
      case UserState.PENDING_VERIFICATION:
        return 'Pendiente';
      case UserState.SUSPENDED:
        return 'Suspendido';
      case UserState.ARCHIVED:
        return 'Archivado';
      default:
        return 'Desconocido';
    }
  }
}
