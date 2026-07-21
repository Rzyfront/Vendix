import {
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  Inject,
  model,
  input,
  output,
  viewChild,
  computed,
  effect,
  inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl-mid' | 'xl' | 'full';

@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [],
  styleUrl: './modal.component.scss',
  template: `
    <!-- Modal backdrop -->
    @if (isOpen()) {
        <div
          [class]="wrapperClasses()"
          (click)="onWrapperClick($event)"
        >
        <!-- Backdrop overlay: bg-only, sin backdrop-filter -->
        <div
          class="absolute inset-0 bg-black/50 transition-opacity duration-300 ease-out"
          [class.opacity-100]="isOpen()"
          [class.opacity-0]="!isOpen()"
        ></div>
        <!-- Modal container: animación restringida a transform+opacity -->
        <div
          #modalContainer
          class="relative transform transition-[transform,opacity] duration-300 ease-out"
          [class]="modalClasses()"
          [class.scale-100]="isOpen()"
          [class.scale-95]="!isOpen()"
          [class.opacity-100]="isOpen()"
          [class.opacity-0]="!isOpen()"
        >
          <!-- Modal content con diseño mejorado -->
          <div [class]="contentClasses()">
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
export class ModalComponent {
  private isBrowser: boolean;
  private destroyRef = inject(DestroyRef);

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
  /**
   * Opt-in, backwards-compatible: when `true`, the modal renders as an
   * edge-to-edge full-screen sheet below the `md:` breakpoint and keeps the
   * exact `size()` look from `md:` onward. Default `false` means every
   * existing `<app-modal>` consumer keeps byte-identical classes.
   */
  readonly fullScreenOnMobile = input<boolean>(false);

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
      // Takeover full-screen (estilo reporte semanal): ocupa todo el viewport.
      full: ['max-w-full', 'w-full', 'h-full', 'max-h-full'],
    };

    const size = this.size();
    const classes = [...baseClasses];

    // `size='full'` is an unconditional takeover at every breakpoint — keep
    // it untouched and independent from `fullScreenOnMobile`.
    if (this.fullScreenOnMobile() && size !== 'full') {
      // Mobile-first full-screen sheet: no width/height caps below `md:`;
      // reproduce the current `size()` look from `md:` onward.
      classes.push('h-full', 'max-h-full');
      classes.push(...sizeClasses[size].map((c) => `md:${c}`));
      classes.push('md:h-auto');
    } else {
      classes.push(...sizeClasses[size]);
    }

    if (this.customClasses()) {
      classes.push(this.customClasses());
    }

    return classes.join(' ');
  });

  /** True when the modal renders as a full-screen takeover. */
  readonly isFull = computed(() => this.size() === 'full');

  /**
   * Inner content shell classes. Full-screen fills the viewport edge-to-edge
   * (no rounding / no outer border / no 90vh cap); other sizes keep the
   * rounded, bordered, height-capped card look — unless `fullScreenOnMobile`
   * is on, in which case that card look only applies from `md:` onward and
   * the mobile base is an edge-to-edge sheet.
   */
  readonly contentClasses = computed(() => {
    const base =
      'bg-[var(--color-surface)] shadow-xl overflow-hidden flex flex-col';

    if (this.isFull()) {
      return `${base} h-full w-full max-h-full`;
    }

    if (this.fullScreenOnMobile()) {
      return `${base} rounded-none border-0 h-full max-h-full md:rounded-[var(--radius-lg)] md:max-h-[90vh] md:border md:border-[var(--color-border)] md:h-auto`;
    }

    return `${base} rounded-[var(--radius-lg)] max-h-[90vh] border border-[var(--color-border)]`;
  });

  /**
   * Backdrop wrapper classes. Default keeps `p-4` unless full-screen;
   * `fullScreenOnMobile` swaps that to `p-0` below `md:` (edge-to-edge sheet)
   * and `p-4` from `md:` onward (unchanged desktop look).
   */
  readonly wrapperClasses = computed(() => {
    const base = 'fixed inset-0 z-[9999] flex items-center justify-center';

    if (this.isFull()) {
      return base;
    }

    if (this.fullScreenOnMobile()) {
      return `${base} p-0 md:p-4`;
    }

    return `${base} p-4`;
  });

  readonly hasHeader = computed(() => !!(this.title() || this.subtitle()));

  readonly hasFooter = computed(() => true);

  private previousIsOpen = false;

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);

    effect(() => {
      const open = this.isOpen();
      if (open !== this.previousIsOpen) {
        if (open) {
          this.opened.emit();
        } else {
          this.closed.emit();
        }
        this.previousIsOpen = open;
      }
      if (this.isBrowser) {
        document.body.style.overflow = open ? 'hidden' : '';
      }
    });

    if (this.isBrowser && this.closeOnEscape()) {
      this.escapeListener = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && this.isOpen()) {
          this.close();
        }
      };
      document.addEventListener('keydown', this.escapeListener);
    }

    this.destroyRef.onDestroy(() => {
      if (this.isBrowser) {
        if (this.escapeListener) {
          document.removeEventListener('keydown', this.escapeListener);
        }
        if (this.isOpen()) {
          document.body.style.overflow = '';
        }
      }
    });
  }

  open(): void {
    if (this.isOpen()) return;
    this.isOpen.set(true);
  }

  close(): void {
    if (!this.isOpen()) return;
    this.isOpen.set(false);
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
