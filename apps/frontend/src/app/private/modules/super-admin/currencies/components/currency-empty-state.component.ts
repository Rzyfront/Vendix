import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent, ButtonComponent } from '../../../../../shared/components/index';

@Component({
  selector: 'app-currency-empty-state',
  standalone: true,
  imports: [CommonModule, IconComponent, ButtonComponent],
  template: `
    <div class="flex flex-col items-center justify-center py-12 px-4 text-center">
      <!-- Icon Container -->
      <div class="w-16 h-16 bg-muted/30 rounded-full flex items-center justify-center mb-4 transition-transform hover:scale-105">
        <app-icon name="dollar-sign" class="w-8 h-8 text-text-secondary"></app-icon>
      </div>

      <!-- Content -->
      <h3 class="text-lg font-semibold text-text-primary mb-1">
        {{ title() }}
      </h3>
      <p class="text-sm text-text-secondary max-w-xs mb-6 px-4">
        {{ description() }}
      </p>

      <!-- Action -->
      <app-button
        *ngIf="showAction()"
        variant="primary"
        size="md"
        iconName="plus"
        (clicked)="actionClick.emit()"
      >
        {{ actionText() }}
      </app-button>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class CurrencyEmptyStateComponent {
  title = input<string>('No se encontraron monedas');
  description = input<string>('Comienza agregando una nueva moneda al sistema para habilitar transacciones.');
  showAction = input<boolean>(true);
  actionText = input<string>('Nueva Moneda');

  actionClick = output<void>();
}
