import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../shared/components';

@Component({
  selector: 'app-info-modal',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    @if (isOpen) {
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <!-- Backdrop -->
      <div
        class="absolute inset-0 bg-black/50 backdrop-blur-sm"
        (click)="close()"></div>

      <!-- Modal -->
      <div
        class="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <!-- Header -->
        <div class="flex items-center justify-between p-4 md:p-6 border-b border-gray-200">
          <h2 class="text-xl font-semibold text-gray-900">{{ title }}</h2>
          <button
            type="button"
            (click)="close()"
            class="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <app-icon name="x" [size]="20"></app-icon>
          </button>
        </div>

        <!-- Content -->
        <div class="p-4 md:p-6 overflow-y-auto max-h-[calc(80vh-120px)]">
          @if (content) {
          <div class="prose prose-gray max-w-none">
            <p class="text-gray-700 whitespace-pre-wrap leading-relaxed">{{ content }}</p>
          </div>
          } @else {
          <p class="text-gray-500 text-center py-8">No hay información disponible.</p>
          }
        </div>

        <!-- Footer -->
        <div class="p-4 md:p-6 border-t border-gray-200 bg-gray-50">
          <button
            type="button"
            (click)="close()"
            class="w-full py-2.5 px-4 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors">
            Cerrar
          </button>
        </div>
      </div>
    </div>
    }
  `,
})
export class InfoModalComponent {
  @Input() isOpen = false;
  @Input() title = '';
  @Input() content = '';
  @Output() closed = new EventEmitter<void>();

  close(): void {
    this.closed.emit();
  }
}
