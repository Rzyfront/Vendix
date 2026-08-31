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

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl-mid' | 'xl' | 'xxl' | 'full';

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
        <!-- Backdrop overlay: bg-only, sin backdrop-filter.
             motion-reduce:transition-none respeta prefers-reduced-motion:
             sin animación de entrada/salida, solo aparición instantánea. -->
        <div
          class="absolute inset-0 bg-black/50 transition-opacity duration-300 ease-out motion-reduce:transition-none"
          [class.opacity-100]="isOpen()"
          [class.opacity-0]="!isOpen()"
        ></div>
        <!-- Modal container: animación restringida a transform+opacity.
             ARIA dialog se aplica al contenedor ENFOCABLE (modalContainer),
             no al wrapper, para que screen readers anuncien el diálogo
             desde el nodo que recibe el foco. -->
        <div
          #modalContainer
          class="relative transform transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none"
          [class]="modalClasses()"
          [class.scale-100]="isOpen()"
          [class.scale-95]="!isOpen()"
          [class.opacity-100]="isOpen()"
          [class.opacity-0]="!isOpen()"
          [attr.role]="dialog() ? 'dialog' : null"
          [attr.aria-modal]="dialog() ? 'true' : null"
          [attr.aria-labelledby]="dialog() && titleId() ? titleId() : null"
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
                        [id]="titleId()"
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
  // QUI-438: default `false` para no cerrar al hacer click fuera del modal
  // — solo el botón X, el botón "Cancelar" del consumidor o el setter
  // programático (close()) pueden cerrarlo. Si un modal necesita el
  // comportamiento anterior, debe setear explícitamente
  // `[closeOnBackdrop]="true"`.
  readonly closeOnBackdrop = input<boolean>(false);
  readonly closeOnEscape = input<boolean>(true);
  readonly showCloseButton = input<boolean>(true);
  readonly overlayCloseButton = input<boolean>(false);
  readonly customClasses = input<string>('');
  // QUI-audit-round-1: opt-in, backwards-compatible. Activar `dialog=true`
  // sella el contrato de accesibilidad: role="dialog", aria-modal="true",
  // aria-labelledby al título, focus trap Tab/Shift+Tab, restauración del
  // foco al elemento que abrió el modal al cerrar, y Escape cierra (siempre).
  readonly dialog = input<boolean>(false);
  // QUI-438: el consumidor puede bloquear el cierre (ej. cuando hay form
  // dirty). Default: `() => true` (cierra normal — sin cambio de comportamiento).
  readonly canClose = input<() => boolean | Promise<boolean>>(() => true);
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
  private keydownListener?: (event: KeyboardEvent) => void;
  private previouslyFocusedElement?: HTMLElement | null;
  private static titleCounter = 0;
  // Cada modal que se monta con `dialog=true` recibe un id único para el
  // heading, de modo que aria-labelledby apunte a un nodo del DOM propio.
  private readonly _titleId = `app-modal-title-${++ModalComponent.titleCounter}`;
  readonly titleId = computed(() =>
    this.dialog() && this.title() ? this._titleId : null
  );

  readonly modalClasses = computed(() => {
    const baseClasses = ['w-full', 'flex', 'flex-col'];

    const sizeClasses: Record<ModalSize, string[]> = {
      sm: ['max-w-sm'],
      md: ['max-w-2xl'],
      lg: ['max-w-5xl', 'w-full', 'max-h-[90vh]'],
      'xl-mid': ['max-w-[85vw]', 'w-full', 'max-h-[90vh]'],
      xl: ['max-w-[95vw]', 'w-full', 'max-h-[90vh]'],
      // QUI-690 — modal XXL para creación manual de factura con todos los
      // detalles DIAN. Más ancho que `xl` pero conserva chrome (border,
      // rounded, max-h). Usar con `[fullScreenOnMobile]="true"` para que en
      // móvil pase a takeover sin padding lateral.
      xxl: ['max-w-[98vw]', 'w-full', 'max-h-[94vh]'],
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
          // Captura el foco en el elemento que abrió el modal ANTES de
          // moverlo dentro, para poder restaurarlo al cerrar.
          if (this.isBrowser && this.dialog()) {
            this.previouslyFocusedElement =
              document.activeElement as HTMLElement | null;
          }
          this.opened.emit();
          // Mover el foco al primer elemento focuseable del modal después
          // de que el DOM se haya pintado (microtask, suficiente para el
          // @if wrapper).
          if (this.isBrowser && this.dialog()) {
            queueMicrotask(() => this.focusFirstElement());
          }
        } else {
          this.closed.emit();
          // Restaurar foco al disparador original — sólo si seguimos vivos
          // (el effect puede dispararse durante teardown, en cuyo caso el
          // nodo ya no está en el DOM y el focus() lanzaría).
          if (
            this.isBrowser &&
            this.dialog() &&
            this.previouslyFocusedElement &&
            document.contains(this.previouslyFocusedElement)
          ) {
            this.previouslyFocusedElement.focus();
          }
          this.previouslyFocusedElement = undefined;
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

    if (this.isBrowser) {
      this.keydownListener = (event: KeyboardEvent) => {
        if (!this.isOpen() || !this.dialog()) return;
        if (event.key !== 'Tab') return;
        const container = this.modalContainer();
        if (!container) return;
        // QUI-audit-round-1 — focus trap scope now includes the wrapper too.
        // The wrapper is the parent of `modalContainer` and the ARIA dialog
        // host (role/aria-modal live on it). If the focus ever lands on a
        // link inside the wrapper backdrop (e.g. a banner), we still want
        // to consider it "inside the modal" so the trap doesn't snap focus
        // back to the first content element.
        const wrapperEl = (container.nativeElement.parentElement as HTMLElement) ?? null;
        const focusables = this.getFocusableElements(container.nativeElement);
        if (focusables.length === 0) {
          // Sin elementos focuseables: mantener el foco dentro para que
          // el lector de pantalla no escape al body.
          event.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        const insideModal =
          this.isInsideModal(active, container.nativeElement) ||
          (wrapperEl !== null && this.isInsideModal(active, wrapperEl));
        if (event.shiftKey) {
          if (active === first || !insideModal) {
            event.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !insideModal) {
            event.preventDefault();
            first.focus();
          }
        }
      };
      document.addEventListener('keydown', this.keydownListener);
    }

    this.destroyRef.onDestroy(() => {
      if (this.isBrowser) {
        if (this.escapeListener) {
          document.removeEventListener('keydown', this.escapeListener);
        }
        if (this.keydownListener) {
          document.removeEventListener('keydown', this.keydownListener);
        }
        // Always clear body scroll-lock on destroy, even when isOpen() is
        // already false. Without this, a @defer/@if that removes the modal
        // synchronously (e.g. parent flips its signal to false in response
        // to (closed)) can race the effect's overflow-reset: the effect
        // never runs because the component is gone, and the cleanup's
        // `if (this.isOpen())` short-circuits to false — leaving
        // `body.style.overflow = 'hidden'` pegado y la página sin scroll.
        document.body.style.overflow = '';
      }
    });
  }

  private getFocusableElements(root: HTMLElement): HTMLElement[] {
    const selector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
      (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1
    );
  }

  private isInsideModal(el: HTMLElement | null, root: HTMLElement): boolean {
    if (!el) return false;
    return root.contains(el);
  }

  private focusFirstElement(): void {
    const container = this.modalContainer();
    if (!container) return;
    const focusables = this.getFocusableElements(container.nativeElement);
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      // Si no hay nada focuseable, mover el foco al contenedor del modal
      // para que el lector de pantalla anuncie el diálogo.
      container.nativeElement.setAttribute('tabindex', '-1');
      container.nativeElement.focus();
    }
  }

  open(): void {
    if (this.isOpen()) return;
    this.isOpen.set(true);
  }

  close(): void {
    if (!this.isOpen()) return;
    // QUI-438: respeta canClose antes de cerrar. Soporta sync y async.
    const result = this.canClose()();
    if (result instanceof Promise) {
      result.then((allowed) => {
        if (allowed) {
          this.isOpen.set(false);
          this.cancel.emit();
        }
      });
    } else if (result) {
      this.isOpen.set(false);
      this.cancel.emit();
    }
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
