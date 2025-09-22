import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogRef } from './dialog.ref';
import { DIALOG_DATA } from './dialog.tokens';
import { ButtonComponent } from '../button/button.component';

@Component({
  selector: 'app-dialog-demo-content',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  template: `
    <div class="p-4">
      <h2 class="text-lg font-semibold mb-2">{{ data?.title || 'Dialog' }}</h2>
      <p class="text-text-secondary mb-4">{{ data?.message || 'Contenido del diálogo...' }}</p>
      <div class="flex gap-2 justify-end">
        <app-button variant="ghost" (clicked)="close()">Cerrar</app-button>
        <app-button (clicked)="accept()">Aceptar</app-button>
      </div>
    </div>
  `,
})
export class DialogDemoContentComponent {
  constructor(public ref: DialogRef, @Inject(DIALOG_DATA) public data: any) {}

  close() {
    this.ref.close(false);
  }
  accept() {
    this.ref.close(true);
  }
}
