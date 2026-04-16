import {
  Component,
  OnInit,
  OnDestroy,
  ElementRef,
  PLATFORM_ID,
  Inject,
  model,
  input,
  output,
  viewChild,
  computed,
  effect,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl-mid' | 'xl';

@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [],
  styleUrl: './modal.component.scss',
  template: `
    <!-- Modal backdrop -->
    @if (isOpen()) {
      <div
        class="fixed inset-0 z-[9999] flex items-center justify-center p-4"
        (dblclick)="onWrapperClick($event)"
        >
        <!-- Backdrop overlay con blur y oscuridad mejorada -->
        <div
          class="absolute inset-0 backdrop-blur-md bg-black/40 transition-all duration-300 ease-out"
          [class.opacity-100]="isOpen()"
          [class.opacity-0]="!isOpen()"
        ></div>
        <!-- Modal container con animación mejorada -->
        <div
          #modalContainer
          class="relative transform transition-all duration-300 ease-out"
          [class]="modalClasses()"
          [class.scale-100]="isOpen()"
          [class.scale-95]="!isOpen()"
          [class.opacity-100]="isOpen()"
          [class.opacity-0]="!isOpen()"
          >
          <!-- Modal content con diseño mejorado -->
          <div
            class="bg-[var(--color-surface)] rounded-[var(--radius-lg)] shadow-xl overflow-hidden flex flex-col max-h-[90vh] border border-[var(--color-border)] backdrop-blur-sm"
            >
            <!-- Header con gradiente sutil -->
            @if (hasHeader()) {
              <div
                class="px-4 py-3 md:px-5 md:py-4 border-b border-[var(--color-border)] flex items-center justify-between flex-shrink-0 bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-surface)]/95"
                >
                <div class="flex items-center gap-3 overflow-hidden flex-1">
                  <ng-content select="[slot=header]"></ng-content>
                  <div class="min-w-0 flex-1">
                    @if (title()) {
                      <h3
                        class="text-[var(--fs-xl)] font-[var(--fw-semibold)] text-[var(--color-text-primary)] truncate"
                        >
                        {{ title() }}
                      </h3>
                    }
                    @if (subtitle()) {
                      <p
                        class="text-[var(--fs-sm)] text-[var(--color-text-secondary)] mt-0.5 truncate"
                        >
                        {{ subtitle() }}
                      </p>
                    }
                  </div>
                  <ng-content select="[slot=header-end]"></ng-content>
                </div>
                <!-- Close button mejorado -->
                @if (showCloseButton()) {
                  <button
                    type="button"
                    class="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all duration-200 p-2 rounded-[var(--radius-md)] hover:bg-[var(--color-text-muted)]/20 focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
                    [class.absolute]="overlayCloseButton()"
                    [class.top-4]="overlayCloseButton()"
                    [class.right-4]="overlayCloseButton()"
                    [class.z-10]="overlayCloseButton()"
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
                }
              </div>
            }
            <!-- Body con scroll mejorado y padding consistente -->
            <div
              class="px-4 py-3 md:px-5 md:py-4 overflow-y-auto overflow-x-auto flex-1 bg-[var(--color-surface)]"
              style="scroll-behavior: smooth;"
              >
              <ng-content></ng-content>
            </div>
            <!-- Footer con diseño mejorado -->
            @if (hasFooter()) {
              <div
                class="px-4 py-3 md:px-5 md:py-3 border-t border-[var(--color-border)] bg-gradient-to-t from-[var(--color-background)]/50 to-[var(--color-surface)] flex-shrink-0"
                >
                <ng-content select="[slot=footer]"></ng-content>
              </div>
            }
          </div>
        </div>
      </div>
    }
    `,
})
export class ModalComponent implements OnInit, OnDestroy {
  private isBrowser: boolean;

  readonly modalContainer = viewChild<ElementRef>('modalContainer');

  readonly isOpen = model<boolean>(false);

  readonly title = input<string>();
  readonly subtitle = input<string>();
  readonly size = input<ModalSize>('md');
  readonly centered = input<boolean>(true);
  readonly closeOnBackdrop = input<boolean>(true);
  readonly closeOnEscape = input<boolean>(true);
  readonly showCloseButton = input<boolean>(true);
  readonly overlayCloseButton = input<boolean>(false);
  readonly customClasses = input<string>('');

  readonly closed = output<void>();
  readonly opened = output<void>();
  readonly cancel = output<void>();

  private escapeListener?: (event: KeyboardEvent) => void;

  readonly modalClasses = computed(() => {
    const baseClasses = ['w-full', 'flex', 'flex-col'];

    const sizeClasses: Record<ModalSize, string[]> = {
      sm: ['max-w-sm'],
      md: ['max-w-2xl'],
      lg: ['max-w-5xl', 'w-full', 'max-h-[90vh]'],
      'xl-mid': ['max-w-[85vw]', 'w-full', 'max-h-[90vh]'],
      xl: ['max-w-[95vw]', 'w-full', 'max-h-[90vh]'],
    };

    const classes = [...baseClasses, ...sizeClasses[this.size()]];

    if (this.customClasses()) {
      classes.push(this.customClasses());
    }

    return classes.join(' ');
  });

  readonly hasHeader = computed(() => !!(this.title() || this.subtitle()));

  readonly hasFooter = computed(() => true); // Siempre mostramos el footer para permitir botones

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);

    effect(() => {
      const open = this.isOpen();
      if (this.isBrowser) {
        document.body.style.overflow = open ? 'hidden' : '';
      }
    });
  }

  ngOnInit(): void {
    if (this.isBrowser && this.closeOnEscape()) {
      this.escapeListener = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && this.isOpen()) {
          this.close();
        }
      };
      document.addEventListener('keydown', this.escapeListener);
    }
  }

  ngOnDestroy(): void {
    if (this.isBrowser) {
      if (this.escapeListener) {
        document.removeEventListener('keydown', this.escapeListener);
      }

      // Restore body scroll when component is destroyed
      if (this.isOpen()) {
        document.body.style.overflow = '';
      }
    }
  }

  open(): void {
    if (this.isOpen()) return;
    this.isOpen.set(true);
    this.opened.emit();
  }

  close(): void {
    if (!this.isOpen()) return;
    this.isOpen.set(false);
    this.closed.emit();
    this.cancel.emit();
  }

  onWrapperClick(event: MouseEvent): void {
    if (!this.closeOnBackdrop()) return;

    // Check if the click target is the modal container or one of its descendants
    const container = this.modalContainer();
    if (container && container.nativeElement.contains(event.target)) {
      return; // Click inside modal, ignore
    }

    // Click outside modal (wrapper or backdrop overlay)
    this.close();
  }
}
