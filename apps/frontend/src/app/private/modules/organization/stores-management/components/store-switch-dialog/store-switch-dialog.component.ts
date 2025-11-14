import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface StoreSwitchDialogData {
  storeName: string;
  storeSlug: string;
}

@Component({
  selector: 'app-store-switch-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      *ngIf="isVisible"
    >
      <div class="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h2 class="text-xl font-semibold mb-4">
          Cambiar al entorno de la tienda
        </h2>

        <div class="mb-6">
          <p class="text-gray-700 mb-2">
            ¿Deseas cambiar al entorno de administración de la tienda
            <strong>{{ data.storeName }}</strong
            >?
          </p>
          <p class="text-sm text-gray-500">
            Serás redirigido al panel de administración de STORE_ADMIN para esta
            tienda específica.
          </p>
        </div>

        <div class="flex justify-end gap-3">
          <button
            (click)="onCancel()"
            class="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            (click)="onConfirm()"
            class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            [disabled]="isLoading"
          >
            {{ isLoading ? 'Cambiando...' : 'Cambiar de entorno' }}
          </button>
        </div>
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
export class StoreSwitchDialogComponent {
  @Input() isVisible = false;
  @Input() data: StoreSwitchDialogData = { storeName: '', storeSlug: '' };
  @Input() isLoading = false;
  @Output() close = new EventEmitter<boolean>();

  onConfirm(): void {
    this.close.emit(true);
  }

  onCancel(): void {
    this.close.emit(false);
  }
}
