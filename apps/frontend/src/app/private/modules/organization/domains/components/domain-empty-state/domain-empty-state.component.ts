import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  ButtonComponent,
  IconComponent,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'app-domain-empty-state',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  template: `
    <div class="flex flex-col items-center justify-center py-12 px-4">
      <!-- Icon -->
      <div
        class="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center mb-6"
      >
        <app-icon name="globe" [size]="48" class="text-gray-400"></app-icon>
      </div>

      <!-- Title -->
      <h3 class="text-xl font-semibold text-text-primary mb-2 text-center">
        {{ title }}
      </h3>

      <!-- Description -->
      <p class="text-text-secondary text-center max-w-md mb-8">
        {{ description }}
      </p>

      <!-- Action Button -->
      <app-button
        variant="primary"
        (clicked)="actionClick.emit()"
        *ngIf="showActionButton"
      >
        <app-icon name="plus" [size]="16" slot="icon"></app-icon>
        {{ actionButtonText }}
      </app-button>

      <!-- Additional Actions -->
      <div class="flex gap-3 mt-4" *ngIf="showAdditionalActions">
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
export class DomainEmptyStateComponent {
  @Input() title = 'No se encontraron dominios';
  @Input() description = 'Comienza creando tu primer dominio.';
  @Input() showActionButton = true;
  @Input() actionButtonText = 'Crear Dominio';
  @Input() showAdditionalActions = false;

  @Output() actionClick = new EventEmitter<void>();
  @Output() refreshClick = new EventEmitter<void>();
  @Output() clearFiltersClick = new EventEmitter<void>();
}
