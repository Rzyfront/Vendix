import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogRef } from './dialog.ref';
import { DIALOG_DATA } from './dialog.tokens';
import { ButtonComponent } from '../button/button.component';
import { FormsModule } from '@angular/forms';

export interface PromptData {
  title?: string;
  message?: string;
  placeholder?: string;
  okText?: string;
  cancelText?: string;
  initialValue?: string;
}

@Component({
  selector: 'app-prompt-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent],
  template: `
    <div class="p-4">
      <h2 class="text-lg font-semibold mb-2">{{ data.title || 'Ingresar dato' }}</h2>
      <p class="text-text-secondary mb-4" *ngIf="data.message">{{ data.message }}</p>
      <input
        class="block w-full border rounded-lg px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary border-border"
        [placeholder]="data.placeholder || 'Escribe aquí'"
        [(ngModel)]="value"
      />
      <div class="flex gap-2 justify-end">
        <app-button variant="ghost" (clicked)="close(undefined)">{{ data.cancelText || 'Cancelar' }}</app-button>
        <app-button (clicked)="close(value)">{{ data.okText || 'Aceptar' }}</app-button>
      </div>
    </div>
  `,
})
export class PromptDialogComponent {
  value = '';
  constructor(public ref: DialogRef<string | undefined>, @Inject(DIALOG_DATA) public data: PromptData) {
    this.value = data.initialValue ?? '';
  }
  close(result: string | undefined) { this.ref.close(result); }
}
