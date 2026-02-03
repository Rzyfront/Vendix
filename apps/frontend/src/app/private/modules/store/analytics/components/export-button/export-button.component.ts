import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';

@Component({
  selector: 'vendix-export-button',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  template: `
    <app-button
      variant="outline"
      size="sm"
      iconName="download"
      [loading]="loading()"
      (clicked)="export.emit()"
    >
      <span class="hidden sm:inline">Exportar</span>
    </app-button>
  `,
})
export class ExportButtonComponent {
  loading = input<boolean>(false);
  export = output<void>();
}
