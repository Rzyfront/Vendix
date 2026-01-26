import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [CommonModule],
  styleUrl: './modal.component.scss',
  template: `
    <!-- Modal backdrop -->
    <div
      *ngIf="isOpen"
      class="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      (click)="onWrapperClick($event)"
    >
      <!-- Backdrop overlay con blur y oscuridad mejorada -->
      <div
        class="absolute inset-0 backdrop-blur-md bg-black/40 transition-all duration-300 ease-out"
        [class.opacity-100]="isOpen"
        [class.opacity-0]="!isOpen"
      ></div>

      <!-- Modal container con animación mejorada -->
      <div
        #modalContainer
        class="relative transform transition-all duration-300 ease-out"
        [class]="modalClasses"
        [class.scale-100]="isOpen"
        [class.scale-95]="!isOpen"
        [class.opacity-100]="isOpen"
        [class.opacity-0]="!isOpen"
      >
        <!-- Modal content con diseño mejorado -->
        <div
          class="bg-[var(--color-surface)] rounded-[var(--radius-lg)] shadow-[var(--shadow-xl)] overflow-hidden flex flex-col max-h-[90vh] border border-[var(--color-border)] backdrop-blur-sm"
        >
          <!-- Header con gradiente sutil -->
          <div
            *ngIf="hasHeader"
            class="px-4 py-3 md:px-5 md:py-4 border-b border-[var(--color-border)] flex items-center justify-between flex-shrink-0 bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-surface)]/95"
          >
            <div class="flex items-center gap-3 overflow-hidden flex-1">
              <ng-content select="[slot=header]"></ng-content>
              <div class="min-w-0 flex-1">
                <h3
                  *ngIf="title"
                  class="text-[var(--fs-xl)] font-[var(--fw-semibold)] text-[var(--color-text-primary)] truncate"
                >
                  {{ title }}
                </h3>
                <p
                  *ngIf="subtitle"
                  class="text-[var(--fs-sm)] text-[var(--color-text-secondary)] mt-0.5 truncate"
                >
                  {{ subtitle }}
                </p>
              </div>
            </div>

            <!-- Close button mejorado -->
            <button
              *ngIf="showCloseButton"
              type="button"
              class="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all duration-200 p-2 rounded-[var(--radius-md)] hover:bg-[var(--color-text-muted)]/20 focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
              [class.absolute]="overlayCloseButton"
              [class.top-4]="overlayCloseButton"
              [class.right-4]="overlayCloseButton"
              [class.z-10]="overlayCloseButton"
              (click)="close()"
              aria-label="Cerrar modal"
            >
              <svg
                class="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <!-- Body con scroll mejorado y padding consistente -->
          <div
            class="px-4 py-3 md:px-5 md:py-4 overflow-y-auto overflow-x-auto flex-1 bg-[var(--color-surface)]"
            style="scroll-behavior: smooth;"
          >
            <ng-content></ng-content>
          </div>

          <!-- Footer con diseño mejorado -->
          <div
            *ngIf="hasFooter"
            class="px-4 py-3 md:px-5 md:py-3 border-t border-[var(--color-border)] bg-gradient-to-t from-[var(--color-background)]/50 to-[var(--color-surface)] flex-shrink-0"
          >
            <ng-content select="[slot=footer]"></ng-content>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class ModalComponent implements OnInit, OnDestroy {
  private _isOpen = false;
  private _isInternalChange = false;

  @ViewChild('modalContainer') modalContainer!: ElementRef;

  @Input()
  set isOpen(value: boolean) {
    if (this._isOpen !== value) {
      this._isOpen = value;
      // Only emit isOpenChange if this is not an internal change (from X, Escape, backdrop)
      if (!this._isInternalChange) {
        this.isOpenChange.emit(value);
      }
      this._isInternalChange = false;

      if (value) {
        this.opened.emit();
      } else {
        this.closed.emit();
      }

      // Manage body scroll based on modal state
      if (value) {
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = '';
      }
    }
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  @Input() title?: string;
  @Input() subtitle?: string;
  @Input() size: ModalSize = 'md';
  @Input() centered = true;
  @Input() closeOnBackdrop = true;
  @Input() closeOnEscape = true;
  @Input() showCloseButton = true;
  @Input() overlayCloseButton = false;
  @Input() customClasses = '';

  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() closed = new EventEmitter<void>();
  @Output() opened = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

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
  }

  ngOnDestroy(): void {
    if (this.escapeListener) {
      document.removeEventListener('keydown', this.escapeListener);
    }

    // Restore body scroll when component is destroyed
    if (this.isOpen) {
      document.body.style.overflow = '';
    }
  }

  get modalClasses(): string {
    const baseClasses = ['w-full', 'flex', 'flex-col'];

    const sizeClasses = {
      sm: ['max-w-sm'],
      md: ['max-w-2xl'],
      lg: ['max-w-5xl', 'w-full', 'max-h-[90vh]'],
      xl: ['max-w-[95vw]', 'w-full', 'max-h-[90vh]'],
    };

    const classes = [...baseClasses, ...sizeClasses[this.size]];

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
    this._isInternalChange = true;
    this.isOpen = true;
  }

  close(): void {
    this._isInternalChange = true;
    this.isOpen = false;
    // Also emit the cancel event for parent components to handle
    this.cancel.emit();
  }

  onWrapperClick(event: MouseEvent): void {
    if (!this.closeOnBackdrop) return;

    // Check if the click target is the modal container or one of its descendants
    if (this.modalContainer && this.modalContainer.nativeElement.contains(event.target)) {
      return; // Click inside modal, ignore
    }

    // Click outside modal (wrapper or backdrop overlay)
    this.close();
  }
}
