import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'vendix-export-button',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  template: `
    <app-button
      variant="outline"
      size="md"
      [loading]="loading()"
      (clicked)="export.emit()"
    >
      <app-icon slot="icon" name="download" [size]="16"></app-icon>
      <span class="hidden sm:inline">Exportar</span>
    </app-button>
  `,
})
export class ExportButtonComponent {
  loading = input<boolean>(false);
  export = output<void>();
}
