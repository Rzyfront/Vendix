import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../shared/components';

export interface FaqItem {
  question: string;
  answer: string;
}

@Component({
  selector: 'app-faq-modal',
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
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
              <app-icon name="help-circle" [size]="20" class="text-primary-600"></app-icon>
            </div>
            <h2 class="text-xl font-semibold text-gray-900">Preguntas Frecuentes</h2>
          </div>
          <button
            type="button"
            (click)="close()"
            class="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <app-icon name="x" [size]="20"></app-icon>
          </button>
        </div>

        <!-- Content -->
        <div class="p-4 md:p-6 overflow-y-auto max-h-[calc(80vh-180px)]">
          @if (items && items.length > 0) {
          <div class="space-y-3">
            @for (item of items; track item.question; let i = $index) {
            <div class="border border-gray-200 rounded-xl overflow-hidden">
              <!-- Question (Accordion Header) -->
              <button
                type="button"
                (click)="toggleItem(i)"
                class="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors">
                <span class="font-medium text-gray-900 pr-4">{{ item.question }}</span>
                <app-icon
                  [name]="expandedIndex === i ? 'chevron-up' : 'chevron-down'"
                  [size]="20"
                  class="text-gray-500 flex-shrink-0 transition-transform duration-200"></app-icon>
              </button>

              <!-- Answer (Accordion Content) -->
              @if (expandedIndex === i) {
              <div class="px-4 pb-4 animate-in fade-in slide-in-from-top-1 duration-150">
                <div class="pt-2 border-t border-gray-100">
                  <p class="text-gray-600 leading-relaxed whitespace-pre-wrap">{{ item.answer }}</p>
                </div>
              </div>
              }
            </div>
            }
          </div>
          } @else {
          <div class="text-center py-12">
            <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
              <app-icon name="help-circle" [size]="32" class="text-gray-400"></app-icon>
            </div>
            <p class="text-gray-500">No hay preguntas frecuentes disponibles.</p>
          </div>
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
export class FaqModalComponent {
  @Input() isOpen = false;
  @Input() items: FaqItem[] = [];
  @Output() closed = new EventEmitter<void>();

  expandedIndex: number | null = 0; // First item expanded by default

  toggleItem(index: number): void {
    this.expandedIndex = this.expandedIndex === index ? null : index;
  }

  close(): void {
    this.closed.emit();
  }
}
