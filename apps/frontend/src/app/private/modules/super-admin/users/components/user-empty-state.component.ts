import { Component, Input, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../shared/components/index';

@Component({
  selector: 'app-user-empty-state',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="flex flex-col items-center justify-center py-16 px-4">
      <!-- Icon -->
      <div class="w-20 h-20 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
        <app-icon name="users" class="w-10 h-10 text-gray-400"></app-icon>
      </div>

      <!-- Title -->
      <h3 class="text-xl font-semibold text-text mb-2">
        {{ title }}
      </h3>

      <!-- Description -->
      <p class="text-text-muted text-center max-w-md mb-6">
        {{ description }}
      </p>

      <!-- Action Button (optional) -->
      <button
        *ngIf="showActionButton"
        (click)="onActionClick.emit()"
        class="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors duration-200 flex items-center gap-2"
      >
        <app-icon name="plus" class="w-4 h-4"></app-icon>
        {{ actionText }}
      </button>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class UserEmptyStateComponent {
  @Input() title: string = 'No se encontraron usuarios';
  @Input() description: string = 'No hay usuarios que coincidan con los criterios de búsqueda. Intenta ajustar los filtros.';
  @Input() showActionButton: boolean = true;
  @Input() actionText: string = 'Crear Primer Usuario';

  @Output() onActionClick = new EventEmitter<void>();

  constructor() {}
}