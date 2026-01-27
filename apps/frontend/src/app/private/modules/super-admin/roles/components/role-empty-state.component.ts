import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-role-empty-state',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  template: `
    <div class="text-center py-12">
      <!-- Icon -->
      <div class="mx-auto h-12 w-12 text-text-muted mb-4">
        <app-icon name="shield" size="48" class="text-text-muted"></app-icon>
      </div>

      <!-- Title -->
      <h3 class="mt-2 text-sm font-medium text-text-primary">
        {{ title() }}
      </h3>

      <!-- Description -->
      <p class="mt-1 text-sm text-text-secondary">
        {{ description() }}
      </p>

      <!-- Action Button -->
      <div class="mt-6" *ngIf="showAction()">
        <app-button
          variant="primary"
          iconName="plus"
          (clicked)="actionClick.emit()"
        >
          {{ actionText() }}
        </app-button>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class RoleEmptyStateComponent {
  readonly title = input('No se encontraron roles');
  readonly description = input('Comienza creando tu primer rol.');
  readonly showAction = input(true);
  readonly actionText = input('Crear Rol');

  readonly actionClick = output<void>();
}
