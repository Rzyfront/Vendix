import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  template: `
    <div class="empty-state-container">
      <!-- Icon -->
      <div class="empty-state-icon">
        <app-icon [name]="icon" [size]="48" class="empty-state-icon-svg"></app-icon>
      </div>

      <!-- Title -->
      <h3 class="empty-state-title">{{ title }}</h3>

      <!-- Description -->
      <p class="empty-state-description">{{ description }}</p>

      <!-- Actions -->
      <div class="empty-state-actions" *ngIf="showActionButton || showRefreshButton || showClearFilters">
        <app-button
          *ngIf="showActionButton"
          variant="primary"
          size="sm"
          (clicked)="actionClick.emit()"
        >
          <app-icon *ngIf="actionButtonIcon" [name]="actionButtonIcon" [size]="16" slot="icon"></app-icon>
          {{ actionButtonText }}
        </app-button>

        <app-button
          *ngIf="showRefreshButton"
          variant="outline"
          size="sm"
          (clicked)="refreshClick.emit()"
        >
          <app-icon name="refresh-cw" [size]="16" slot="icon"></app-icon>
          Actualizar
        </app-button>

        <app-button
          *ngIf="showClearFilters"
          variant="outline"
          size="sm"
          (clicked)="clearFiltersClick.emit()"
        >
          <app-icon name="x" [size]="16" slot="icon"></app-icon>
          Limpiar Filtros
        </app-button>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    .empty-state-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem 1rem;
      text-align: center;
    }

    .empty-state-icon {
      width: 6rem;
      height: 6rem;
      border-radius: 50%;
      background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 1.5rem;
    }

    .empty-state-icon-svg {
      color: #9ca3af;
    }

    .empty-state-title {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--color-text-primary, #111827);
      margin-bottom: 0.5rem;
    }

    .empty-state-description {
      color: var(--color-text-secondary, #6b7280);
      max-width: 28rem;
      margin-bottom: 1.5rem;
      line-height: 1.5;
    }

    .empty-state-actions {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      align-items: center;

      @media (min-width: 640px) {
        flex-direction: row;
      }
    }
  `],
})
export class EmptyStateComponent {
  @Input() icon = 'inbox';
  @Input() title = 'No hay datos';
  @Input() description = 'No se encontraron registros.';
  @Input() actionButtonText = 'Crear Nuevo';
  @Input() actionButtonIcon: string | null = 'plus';
  @Input() showActionButton = true;
  @Input() showRefreshButton = false;
  @Input() showClearFilters = false;

  @Output() actionClick = new EventEmitter<void>();
  @Output() refreshClick = new EventEmitter<void>();
  @Output() clearFiltersClick = new EventEmitter<void>();
}
