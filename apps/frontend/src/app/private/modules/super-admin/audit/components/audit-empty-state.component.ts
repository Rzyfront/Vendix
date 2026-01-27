import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent, ButtonComponent } from '../../../../../shared/components/index';

@Component({
  selector: 'app-audit-empty-state',
  standalone: true,
  imports: [CommonModule, IconComponent, ButtonComponent],
  template: `
    <div class="flex flex-col items-center justify-center py-12 px-4 text-center animate-in fade-in zoom-in duration-300">
      <div class="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
        <app-icon name="file-text" [size]="40" class="text-primary"></app-icon>
      </div>

      <h3 class="text-xl font-semibold text-text-primary mb-2">
        {{ title() }}
      </h3>
      <p class="text-text-secondary max-w-md mb-8">
        {{ description() }}
      </p>

      @if (showActionButton()) {
        <app-button variant="primary" (clicked)="actionClick.emit()">
          <app-icon name="refresh-cw" [size]="18" slot="icon"></app-icon>
          {{ actionText() }}
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
export class AuditEmptyStateComponent {
  title = input<string>('No se encontraron registros');
  description = input<string>('Los logs de auditoría aparecerán aquí cuando se realicen acciones en el sistema.');
  showActionButton = input<boolean>(true);
  actionText = input<string>('Actualizar');

  actionClick = output<void>();
}
