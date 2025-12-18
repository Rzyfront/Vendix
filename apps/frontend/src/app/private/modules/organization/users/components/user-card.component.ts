import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IconComponent,
  ButtonComponent,
} from '../../../../../shared/components/index';
import { User, UserState } from '../interfaces/user.interface';

@Component({
  selector: 'app-user-card',
  standalone: true,
  imports: [CommonModule, IconComponent, ButtonComponent],
  template: `
    <div
      class="bg-surface rounded-card shadow-card border border-border p-6 hover:shadow-lg transition-shadow"
    >
      <!-- User Header -->
      <div class="flex items-start justify-between mb-4">
        <div class="flex items-center space-x-3">
          <div
            class="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center"
          >
            <app-icon name="user" [size]="24" class="text-primary"></app-icon>
          </div>
          <div>
            <h3 class="font-semibold text-text-primary">
              {{ user.first_name }} {{ user.last_name }}
            </h3>
            <p class="text-sm text-text-secondary">{{ '@' + user.username }}</p>
          </div>
        </div>

        <!-- Status Badge -->
        <span
          class="px-2 py-1 text-xs font-medium rounded-full"
          [class]="getStateDisplay(user.state).class"
        >
          {{ getStateDisplay(user.state).text }}
        </span>
      </div>

      <!-- User Info -->
      <div class="space-y-2 mb-4">
        <div class="flex items-center text-sm">
          <app-icon
            name="mail"
            [size]="16"
            class="text-text-secondary mr-2"
          ></app-icon>
          <span class="text-text-primary">{{ user.email }}</span>
        </div>

        <div class="flex items-center text-sm">
          <app-icon
            name="shield"
            [size]="16"
            class="text-text-secondary mr-2"
          ></app-icon>
          <span class="text-text-primary">{{ user.app || 'N/A' }}</span>
        </div>

        <div class="flex items-center text-sm">
          <app-icon
            name="calendar"
            [size]="16"
            class="text-text-secondary mr-2"
          ></app-icon>
          <span class="text-text-primary"
            >Creado: {{ formatDate(user.created_at) }}</span
          >
        </div>
      </div>

      <!-- Security Indicators -->
      <div class="flex items-center space-x-4 mb-4 text-sm">
        <div class="flex items-center">
          <app-icon
            name="check-circle"
            [size]="16"
            [ngClass]="
              user.email_verified ? 'text-green-500' : 'text-yellow-500'
            "
            class="mr-1"
          ></app-icon>
          <span class="text-text-secondary">Email</span>
        </div>

        <div class="flex items-center">
          <app-icon
            name="shield"
            [size]="16"
            [ngClass]="
              user.two_factor_enabled ? 'text-green-500' : 'text-gray-400'
            "
            class="mr-1"
          ></app-icon>
          <span class="text-text-secondary">2FA</span>
        </div>
      </div>

      <!-- Actions -->
      <div
        class="flex items-center justify-between pt-4 border-t border-border"
      >
        <div class="flex items-center space-x-2">
          <app-button
            variant="outline"
            size="sm"
            (clicked)="edit.emit(user)"
            title="Editar usuario"
          >
            <app-icon name="edit" [size]="16"></app-icon>
          </app-button>

          <app-button
            variant="outline"
            size="sm"
            (clicked)="toggleStatus.emit(user)"
            [ngClass]="
              user.state === UserState.ACTIVE
                ? 'text-yellow-600'
                : 'text-green-600'
            "
            [title]="
              user.state === UserState.ACTIVE
                ? 'Archivar usuario'
                : 'Reactivar usuario'
            "
          >
            <app-icon name="archive" [size]="16"></app-icon>
          </app-button>

          <app-button
            variant="outline"
            size="sm"
            (clicked)="delete.emit(user)"
            class="text-red-600 hover:text-red-700"
            title="Eliminar usuario"
          >
            <app-icon name="trash-2" [size]="16"></app-icon>
          </app-button>
        </div>

        <div class="text-xs text-text-secondary">ID: {{ user.id }}</div>
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
  @Output() edit = new EventEmitter<User>();
  @Output() delete = new EventEmitter<User>();
  @Output() toggleStatus = new EventEmitter<User>();
  UserState = UserState;

  getStateDisplay(state: UserState): { text: string; class: string } {
    switch (state) {
      case UserState.ACTIVE:
        return { text: 'Activo', class: 'bg-green-100 text-green-800' };
      case UserState.INACTIVE:
        return { text: 'Inactivo', class: 'bg-gray-100 text-gray-800' };
      case UserState.PENDING_VERIFICATION:
        return { text: 'Pendiente', class: 'bg-yellow-100 text-yellow-800' };
      case UserState.SUSPENDED:
        return { text: 'Suspendido', class: 'bg-orange-100 text-orange-800' };
      case UserState.ARCHIVED:
        return { text: 'Archivado', class: 'bg-red-100 text-red-800' };
      default:
        return { text: 'Desconocido', class: 'bg-gray-100 text-gray-800' };
    }
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
}
