import { Component, input, output } from '@angular/core';
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
    <div class="flex flex-col items-center justify-center py-12 px-4 text-center animate-in fade-in zoom-in duration-300">
      <div class="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
        <app-icon name="credit-card" [size]="40" class="text-primary"></app-icon>
      </div>

      <h3 class="text-xl font-semibold text-text-primary mb-2">
        {{ title() }}
      </h3>
      <p class="text-text-secondary max-w-md mb-8">
        {{ description() }}
      </p>

      <div class="flex flex-wrap items-center justify-center gap-3">
        @if (showAction()) {
          <app-button variant="primary" (clicked)="actionClick.emit()">
            <app-icon name="plus" [size]="18" slot="icon"></app-icon>
            {{ actionText() }}
          </app-button>
        }

        @if (showAdditionalActions()) {
          <app-button variant="outline" (clicked)="clearFiltersClick.emit()">
            <app-icon name="filter-x" [size]="18" slot="icon"></app-icon>
            Limpiar filtros
          </app-button>
          
          <app-button variant="ghost" (clicked)="refreshClick.emit()">
            <app-icon name="refresh" [size]="18" slot="icon"></app-icon>
            Reintentar
          </app-button>
        }
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
export class PaymentMethodEmptyStateComponent {
  title = input<string>('No hay métodos de pago');
  description = input<string>('Comienza creando tu primer método de pago para el sistema.');
  showAction = input<boolean>(true);
  actionText = input<string>('Crear Primer Método');
  showAdditionalActions = input<boolean>(false);

  actionClick = output<void>();
  refreshClick = output<void>();
  clearFiltersClick = output<void>();
}
