import { Component, Input, Output, EventEmitter } from '@angular/core';
import {
  IconComponent,
  ButtonComponent,
} from '../../../../../shared/components/index';

@Component({
  selector: 'app-user-empty-state',
  standalone: true,
  imports: [IconComponent, ButtonComponent],
  template: `
    <div class="text-center py-12">
      <div
        class="mx-auto w-24 h-24 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-6"
      >
        <app-icon
          name="users"
          [size]="48"
          class="text-gray-400 dark:text-gray-500"
        ></app-icon>
      </div>

      <h3 class="text-lg font-medium text-text-primary mb-2">
        {{ title }}
      </h3>

      <p class="text-text-secondary mb-6 max-w-md mx-auto">
        {{ description }}
      </p>

      <app-button
        variant="primary"
        (clicked)="actionClick.emit()"
        *ngIf="showAction"
      >
        <app-icon name="plus" [size]="16" slot="icon"></app-icon>
        Crear Primer Usuario
      </app-button>
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
export class UserEmptyStateComponent {
  @Input() title: string = 'No hay usuarios';
  @Input() description: string =
    'No se encontraron usuarios en esta organización.';
  @Input() showAction: boolean = true;
  @Output() actionClick = new EventEmitter<void>();
}
