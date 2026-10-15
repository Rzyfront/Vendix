import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

let nextPopoverId = 0;

/**
 * Ícono de ayuda que despliega una explicación corta al pulsarlo.
 *
 * Por qué no `app-tooltip`: se abre sólo con hover (no hay clic ni teclado en
 * pantallas táctiles). Por qué no `app-dropdown`: pinta su propio botón con
 * borde y declara `role="menu"`, que promete opciones navegables donde sólo
 * hay un texto.
 *
 * Accesible: botón con `aria-expanded`/`aria-controls`, cierre con Esc (el
 * foco vuelve al botón), clic fuera, desplazamiento o cambio de tamaño. El
 * panel es `position: fixed` calculado contra el viewport: así no lo recorta un
 * contenedor con `overflow` (el resumen lateral desplaza por dentro).
 */
@Component({
  selector: 'vendix-invoice-help-popover',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'inline-flex shrink-0',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'onEscape()',
    '(window:resize)': 'close()',
  },
  template: `
    <button
      #trigger
      type="button"
      class="inline-flex h-7 w-7 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-[var(--color-surface-secondary)] hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] aria-expanded:bg-primary/10 aria-expanded:text-primary"
      [attr.aria-label]="label()"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="panelId"
      aria-haspopup="dialog"
      (click)="toggle()"
    >
      <app-icon name="help-circle" [size]="16" />
    </button>

    @if (open()) {
      <div
        #panel
        [id]="panelId"
        role="dialog"
        [attr.aria-label]="heading() || label()"
        class="fixed z-[var(--z-tooltip)] w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface p-3 text-xs leading-relaxed text-text-secondary shadow-lg"
        [style.top.px]="top()"
        [style.left.px]="left()"
        [style.visibility]="positioned() ? 'visible' : 'hidden'"
      >
        @if (heading()) {
          <p class="mb-1 flex items-center gap-1.5 font-semibold text-text-primary">
            <app-icon name="help-circle" [size]="13" class="text-primary" />
            {{ heading() }}
          </p>
        }
        <ng-content />
      </div>
    }
  `,
})
export class InvoiceHelpPopoverComponent {
  /** Nombre accesible del botón (no hay texto visible). */
  readonly label = input('Más información');
  /** Título opcional del panel. */
  readonly heading = input('');

  readonly panelId = `vendix-help-popover-${++nextPopoverId}`;

  readonly open = signal(false);
  readonly top = signal(0);
  readonly left = signal(0);
  readonly positioned = signal(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  constructor() {
    // El panel es fijo: si algo desplaza por debajo, quedaría flotando lejos de
    // su botón. `scroll` no burbujea, así que se escucha en captura.
    const onScroll = (event: Event): void => {
      if (!this.open()) return;
      const panel = this.panel()?.nativeElement;
      if (panel && event.target instanceof Node && panel.contains(event.target)) {
        return;
      }
      this.close();
    };
    this.document.addEventListener('scroll', onScroll, true);
    inject(DestroyRef).onDestroy(() =>
      this.document.removeEventListener('scroll', onScroll, true),
    );
  }

  toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this.positioned.set(false);
    this.open.set(true);
    afterNextRender(() => this.place(), { injector: this.injector });
  }

  close(): void {
    if (this.open()) this.open.set(false);
  }

  onEscape(): void {
    if (!this.open()) return;
    this.close();
    this.trigger().nativeElement.focus();
  }

  onDocumentClick(event: MouseEvent): void {
    if (!this.open()) return;
    const target = event.target;
    if (target instanceof Node && this.host.nativeElement.contains(target)) return;
    this.close();
  }

  /** Debajo del botón y alineado a su borde derecho; arriba si no cabe. */
  private place(): void {
    const view = this.document.defaultView;
    const panel = this.panel()?.nativeElement;
    if (!view || !panel) return;
    const margin = 16;
    const gap = 6;
    const rect = this.trigger().nativeElement.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const maxLeft = view.innerWidth - width - margin;
    const left = Math.max(margin, Math.min(rect.right - width, maxLeft));
    const below = rect.bottom + gap;
    const fitsBelow = below + height <= view.innerHeight - margin;
    const top = fitsBelow ? below : Math.max(margin, rect.top - gap - height);
    this.left.set(left);
    this.top.set(top);
    this.positioned.set(true);
  }
}
