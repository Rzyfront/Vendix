import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ButtonComponent,
  IconComponent,
} from '../../../../../shared/components/index';

@Component({
  selector: 'app-payment-method-empty-state',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  template: `
    <div class="text-center py-12">
      <!-- Icon -->
      <div
        class="mx-auto flex items-center justify-center h-24 w-24 rounded-full bg-gray-100 mb-4"
      >
        <app-icon
          name="credit-card"
          [size]="48"
          class="text-gray-400"
        ></app-icon>
      </div>

      <!-- Title -->
      <h3 class="text-lg font-medium text-gray-900 mb-2">
        {{ title }}
      </h3>

      <!-- Description -->
      <p class="text-sm text-gray-500 mb-6 max-w-sm mx-auto">
        {{ description }}
      </p>

      <!-- Action Button -->
      <app-button
        variant="primary"
        (clicked)="actionClick.emit()"
        *ngIf="showAction"
      >
        <app-icon name="plus" [size]="16" slot="icon"></app-icon>
        {{ actionText }}
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
export class PaymentMethodEmptyStateComponent {
  @Input() title: string = 'No hay métodos de pago';
  @Input() description: string =
    'Comienza creando tu primer método de pago para el sistema.';
  @Input() showAction: boolean = true;
  @Input() actionText: string = 'Crear Primer Método';
  @Output() actionClick = new EventEmitter<void>();
}
