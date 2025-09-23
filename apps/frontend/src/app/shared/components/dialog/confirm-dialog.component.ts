import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogRef } from './dialog.ref';
import { DIALOG_DATA } from './dialog.tokens';
import { ButtonComponent } from '../button/button.component';

export interface ConfirmData {
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  template: `
    <div class="p-4">
      <h2 class="text-lg font-semibold mb-2">{{ data.title || 'Confirmar' }}</h2>
      <p class="text-text-secondary mb-4">{{ data.message || '¿Estás seguro?' }}</p>
      <div class="flex gap-2 justify-end">
        <app-button variant="ghost" (clicked)="close(false)">{{ data.cancelText || 'Cancelar' }}</app-button>
        <app-button (clicked)="close(true)">{{ data.confirmText || 'Confirmar' }}</app-button>
      </div>
    </div>
  `,
})
export class ConfirmDialogComponent {
  constructor(public ref: DialogRef<boolean>, @Inject(DIALOG_DATA) public data: ConfirmData) {}
  close(result: boolean) { this.ref.close(result); }
}
