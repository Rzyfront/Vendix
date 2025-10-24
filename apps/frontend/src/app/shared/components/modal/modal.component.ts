import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ModalSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [CommonModule],
  styleUrl: './modal.component.scss',
  template: `
    <!-- Modal backdrop -->
    <div
      *ngIf="isOpen"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      (click)="onBackdropClick($event)"
    >
      <!-- Backdrop overlay con blur y oscuridad -->
      <div
        class="absolute inset-0 backdrop-blur-sm bg-black/50 transition-opacity duration-500 ease-out"
        [class.opacity-100]="isOpen"
        [class.opacity-0]="!isOpen"
      ></div>

      <!-- Modal container -->
      <div
        class="relative transform transition-all duration-500 ease-out"
        [class]="modalClasses"
        [class.scale-100]="isOpen"
        [class.scale-95]="!isOpen"
        [class.opacity-100]="isOpen"
        [class.opacity-0]="!isOpen"
        (click)="$event.stopPropagation()"
      >
        <!-- Modal content -->
        <div class="bg-surface rounded-card shadow-lg overflow-hidden flex flex-col max-h-[90vh] border border-border">
          <!-- Header -->
          <div
            *ngIf="hasHeader"
            class="px-6 py-4 border-b border-border flex items-center justify-between flex-shrink-0 bg-surface"
          >
            <div>
              <h3 *ngIf="title" class="text-lg font-semibold text-text-primary">
                {{ title }}
              </h3>
              <p *ngIf="subtitle" class="text-sm text-text-secondary mt-1">
                {{ subtitle }}
              </p>
              <ng-content select="[slot=header]"></ng-content>
            </div>
            
            <!-- Close button -->
            <button
              *ngIf="showCloseButton"
              type="button"
              class="text-text-secondary hover:text-text-primary transition-colors p-1 rounded-button hover:bg-muted/20"
              (click)="close()"
            >
              <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Body con overflow scroll -->
          <div class="px-6 py-4 overflow-y-auto overflow-x-auto flex-1 bg-surface" style="scroll-behavior: smooth;">
            <ng-content></ng-content>
          </div>

          <!-- Footer con soporte para botones -->
          <div
            *ngIf="hasFooter"
            class="px-6 py-4 border-t border-border bg-muted/20 flex-shrink-0"
          >
            <ng-content select="[slot=footer]"></ng-content>
          </div>
        </div>
      </div>
    </div>
  `
})
export class ModalComponent implements OnInit, OnDestroy {
  @Input() isOpen = false;
  @Input() title?: string;
  @Input() subtitle?: string;
  @Input() size: ModalSize = 'md';
  @Input() centered = true;
  @Input() closeOnBackdrop = true;
  @Input() closeOnEscape = true;
  @Input() showCloseButton = true;
  @Input() customClasses = '';

  @Output() openChange = new EventEmitter<boolean>();
  @Output() closed = new EventEmitter<void>();
  @Output() opened = new EventEmitter<void>();

  private escapeListener?: (event: KeyboardEvent) => void;

  ngOnInit(): void {
    if (this.closeOnEscape) {
      this.escapeListener = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && this.isOpen) {
          this.close();
        }
      };
      document.addEventListener('keydown', this.escapeListener);
    }

    // Prevent body scroll when modal is open
    if (this.isOpen) {
      document.body.style.overflow = 'hidden';
    }
  }

  ngOnDestroy(): void {
    if (this.escapeListener) {
      document.removeEventListener('keydown', this.escapeListener);
    }
    
    // Restore body scroll
    document.body.style.overflow = '';
  }

  get modalClasses(): string {
    const baseClasses = [
      'w-full',
      'flex',
      'flex-col'
    ];

    const sizeClasses = {
      sm: ['max-w-sm'],
      md: ['max-w-2xl'],
      lg: ['max-w-7xl', 'w-full', 'h-full', 'max-h-[90vh]']
    };

    const classes = [
      ...baseClasses,
      ...sizeClasses[this.size]
    ];

    if (this.customClasses) {
      classes.push(this.customClasses);
    }

    return classes.join(' ');
  }

  get hasHeader(): boolean {
    return !!(this.title || this.subtitle);
  }

  get hasFooter(): boolean {
    return true; // Siempre mostramos el footer para permitir botones
  }

  open(): void {
    this.isOpen = true;
    this.openChange.emit(true);
    this.opened.emit();
    document.body.style.overflow = 'hidden';
  }

  close(): void {
    this.isOpen = false;
    this.openChange.emit(false);
    this.closed.emit();
    document.body.style.overflow = '';
  }

  onBackdropClick(event: Event): void {
    if (this.closeOnBackdrop && event.target === event.currentTarget) {
      this.close();
    }
  }
}
