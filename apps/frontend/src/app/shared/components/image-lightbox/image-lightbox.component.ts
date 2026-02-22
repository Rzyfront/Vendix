import { Component, Input, Output, EventEmitter, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-image-lightbox',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div
      *ngIf="isOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in"
      (click)="closeOnBackdrop($event)"
    >
      <!-- Close Button -->
      <button
        (click)="close.emit()"
        class="absolute top-4 right-4 md:top-6 md:right-6 text-white hover:text-gray-300 transition-colors z-10 p-2"
        [attr.aria-label]="'Cerrar'"
      >
        <app-icon name="x" [size]="28"></app-icon>
      </button>

      <!-- Navigation Arrows (for multiple images) -->
      <button
        *ngIf="hasPrevious()"
        (click)="previous.emit(); $event.stopPropagation()"
        class="absolute left-4 md:left-6 text-white hover:text-gray-300 transition-colors p-2 hover:bg-white/10 rounded-full"
        [attr.aria-label]="'Imagen anterior'"
      >
        <app-icon name="chevron-left" [size]="32"></app-icon>
      </button>

      <button
        *ngIf="hasNext()"
        (click)="next.emit(); $event.stopPropagation()"
        class="absolute right-4 md:right-6 text-white hover:text-gray-300 transition-colors p-2 hover:bg-white/10 rounded-full"
        [attr.aria-label]="'Imagen siguiente'"
      >
        <app-icon name="chevron-right" [size]="32"></app-icon>
      </button>

      <!-- Image Container -->
      <div class="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center" (click)="$event.stopPropagation()">
        <img
          [src]="currentImage"
          [alt]="alt"
          class="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl animate-scale-in"
          (load)="onImageLoad()"
        >

        <!-- Loading Spinner -->
        <div
          *ngIf="!imageLoaded"
          class="absolute inset-0 flex items-center justify-center"
        >
          <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
        </div>
      </div>

      <!-- Image Info Footer -->
      <div
        *ngIf="showInfo && (title || description)"
        class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6 text-white"
      >
        <h3 *ngIf="title" class="text-lg font-semibold mb-1">{{ title }}</h3>
        <p *ngIf="description" class="text-sm text-gray-300">{{ description }}</p>
      </div>

      <!-- Image Counter (for multiple images) -->
      <div
        *ngIf="currentIndex !== undefined && totalImages !== undefined && totalImages > 1"
        class="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white px-4 py-2 rounded-full text-sm font-medium"
      >
        {{ currentIndex + 1 }} / {{ totalImages }}
      </div>
    </div>
  `,
  styles: [`
    @keyframes fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes scale-in {
      from {
        opacity: 0;
        transform: scale(0.95);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }

    .animate-fade-in {
      animation: fade-in 0.2s ease-out;
    }

    .animate-scale-in {
      animation: scale-in 0.3s ease-out;
    }

    :host {
      display: contents;
    }
  `],
})
export class ImageLightboxComponent {
  @Input() isOpen = false;
  @Input() currentImage: string | SafeUrl = '';
  @Input() alt = 'Imagen';
  @Input() title?: string;
  @Input() description?: string;
  @Input() showInfo = true;
  @Input() currentIndex?: number;
  @Input() totalImages?: number;

  @Output() close = new EventEmitter<void>();
  @Output() previous = new EventEmitter<void>();
  @Output() next = new EventEmitter<void>();

  imageLoaded = false;

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    if (!this.isOpen) return;

    switch (event.key) {
      case 'Escape':
        this.close.emit();
        break;
      case 'ArrowLeft':
        if (this.hasPrevious()) {
          this.previous.emit();
        }
        break;
      case 'ArrowRight':
        if (this.hasNext()) {
          this.next.emit();
        }
        break;
    }
  }

  closeOnBackdrop(event: MouseEvent) {
    // Close if clicking directly on the backdrop (not on child elements)
    if (event.target === event.currentTarget) {
      this.close.emit();
    }
  }

  hasPrevious(): boolean {
    return this.currentIndex !== undefined && this.currentIndex > 0;
  }

  hasNext(): boolean {
    return this.currentIndex !== undefined &&
           this.totalImages !== undefined &&
           this.currentIndex < this.totalImages - 1;
  }

  onImageLoad() {
    this.imageLoaded = true;
  }

  resetImageLoaded() {
    this.imageLoaded = false;
  }
}
