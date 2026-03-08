import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ButtonComponent,
  IconComponent,
} from '../../../../../shared/components/index';

@Component({
  selector: 'app-ai-engine-empty-state',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  template: `
    <div class="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div
        class="w-16 h-16 rounded-full bg-purple-50 flex items-center justify-center mb-4"
      >
        <app-icon name="cpu" [size]="28" class="text-purple-400"></app-icon>
      </div>
      <h3 class="text-lg font-semibold text-text-primary mb-2">
        {{ title() }}
      </h3>
      <p class="text-sm text-text-secondary max-w-md mb-6">
        {{ description() }}
      </p>
      @if (showAction()) {
        <app-button
          variant="primary"
          size="sm"
          iconName="plus"
          (clicked)="actionClick.emit()"
        >
          Nueva Configuracion
        </app-button>
      }
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
export class AIEngineEmptyStateComponent {
  title = input<string>('No hay configuraciones');
  description = input<string>(
    'Configura tu primer proveedor de inteligencia artificial para comenzar',
  );
  showAction = input<boolean>(true);
  actionClick = output<void>();
}
