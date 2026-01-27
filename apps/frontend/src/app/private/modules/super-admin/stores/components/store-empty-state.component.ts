import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

// Import shared components
import {
  ButtonComponent,
  IconComponent,
} from '../../../../../shared/components';

@Component({
  selector: 'app-store-empty-state',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  template: `
    <div class="flex flex-col items-center justify-center py-12 px-4">
      <!-- Icon -->
      <div
        class="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center mb-6"
      >
        <app-icon name="store" [size]="48" class="text-gray-400"></app-icon>
      </div>

      <!-- Title -->
      <h3 class="text-xl font-semibold text-text-primary mb-2 text-center">
        {{ title() }}
      </h3>

      <!-- Description -->
      <p class="text-text-secondary text-center max-w-md mb-8">
        {{ description() }}
      </p>

      <!-- Action Button -->
      <app-button
        variant="primary"
        (clicked)="actionClick.emit()"
        *ngIf="showActionButton()"
      >
        <app-icon name="plus" [size]="16" slot="icon"></app-icon>
        {{ actionButtonText() }}
      </app-button>

      <!-- Additional Actions -->
      <div class="flex gap-3 mt-4" *ngIf="showAdditionalActions()">
        <app-button variant="outline" (clicked)="refreshClick.emit()">
          <app-icon name="refresh" [size]="16" slot="icon"></app-icon>
          Actualizar
        </app-button>

        <app-button variant="outline" (clicked)="clearFiltersClick.emit()">
          <app-icon name="x" [size]="16" slot="icon"></app-icon>
          Limpiar Filtros
        </app-button>
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
export class StoreEmptyStateComponent {
  title = input<string>('No stores found');
  description = input<string>('Get started by creating your first store.');
  showActionButton = input<boolean>(true);
  actionButtonText = input<string>('Crear Tienda');
  showAdditionalActions = input<boolean>(false);

  actionClick = output<void>();
  refreshClick = output<void>();
  clearFiltersClick = output<void>();
}
