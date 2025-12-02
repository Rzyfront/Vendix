import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../shared/components/index';

@Component({
  selector: 'app-user-create-modal-simple',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    >
      <div
        class="bg-surface rounded-lg border border-border w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4"
      >
        <div class="p-6">
          <!-- Header -->
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-semibold text-text">Crear Nuevo Usuario</h2>
            <button
              (click)="onClose.emit()"
              class="text-text-muted hover:text-text"
            >
              <app-icon name="x" class="w-6 h-6"></app-icon>
            </button>
          </div>

          <!-- Content -->
          <div class="space-y-4">
            <p class="text-text">Modal de creación de usuario simplificado</p>
          </div>

          <!-- Actions -->
          <div class="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
            <button
              type="button"
              (click)="onClose.emit()"
              class="px-4 py-2 text-text bg-surface border border-border rounded-md hover:bg-surface-hover"
            >
              Cancelar
            </button>
            <button
              (click)="onCreate.emit()"
              class="px-4 py-2 text-white bg-primary rounded-md hover:bg-primary-hover flex items-center gap-2"
            >
              <app-icon name="plus" class="w-4 h-4"></app-icon>
              Crear Usuario
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class UserCreateModalSimpleComponent {
  @Input() isOpen: boolean = false;
  @Output() onClose = new EventEmitter<void>();
  @Output() onCreate = new EventEmitter<void>();

  constructor() {}

  onCloseClick(): void {
    this.onClose.emit();
  }

  onCreateClick(): void {
    this.onCreate.emit();
    this.onClose.emit();
  }
}
