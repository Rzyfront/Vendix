import {
  Component,
  ElementRef,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { IconComponent } from '../../../../../../shared/components';

/** Pill mínima: forma que expone `categories()` del POS (`id ''` = Todos). */
export interface PosCategoryPill {
  id: string;
  name: string;
}

/**
 * PSVERSION0001 paso 2 — barra táctil de categorías del POS.
 *
 * Replica el bloque `#categories-scroll-container` de
 * `docs/plans/stitch-reference/d25526af.html`: pills horizontales con
 * scroll suave, flechas circulares que aparecen/desaparecen en los bordes,
 * máscaras de gradiente y rueda vertical→horizontal. Escribe al filtro
 * `category_id` existente vía `categorySelected` (el padre sincroniza la
 * misma señal que el dropdown Filtros).
 *
 * Reglas de negocio (decisión del plan): sin conteos por categoría — solo
 * "Todos (N)" usa el total existente (`totalCount`).
 */
@Component({
  selector: 'app-pos-category-pills',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="relative mt-3 flex items-center" role="group" aria-label="Categorías">
      <!-- Flecha izquierda -->
      <button
        type="button"
        title="Anterior"
        aria-label="Desplazar categorías a la izquierda"
        (click)="scrollBy(-220)"
        [class.opacity-0]="!canScrollLeft()"
        [class.pointer-events-none]="!canScrollLeft()"
        [class.opacity-100]="canScrollLeft()"
        class="absolute left-0 z-10 w-7 h-7 flex items-center justify-center bg-white/95 hover:bg-white text-slate-600 hover:text-slate-900 border border-slate-200 rounded-full shadow-sm hover:shadow transition-all focus:outline-none"
      >
        <app-icon name="chevron-left" [size]="16"></app-icon>
      </button>
      <!-- Máscara gradiente izquierda -->
      <div
        aria-hidden="true"
        [class.opacity-0]="!canScrollLeft()"
        class="pointer-events-none absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-white via-white/80 to-transparent z-[5] transition-opacity duration-200"
      ></div>
      <!-- Contenedor scrollable -->
      <div
        #scrollContainer
        role="tablist"
        aria-label="Filtrar por categoría"
        (scroll)="onScroll()"
        class="flex-1 flex items-center gap-2 overflow-x-auto no-scrollbar scroll-smooth py-1 px-0.5"
      >
        @for (cat of categories(); track cat.id) {
          <button
            type="button"
            role="tab"
            [attr.aria-selected]="isSelected(cat)"
            [attr.aria-label]="pillLabel(cat)"
            (click)="selectCategory(cat.id)"
            [class]="
              isSelected(cat) ? selectedPillClass : unselectedPillClass
            "
          >
            {{ cat.name }}
            @if (cat.id === '') {
              <span class="font-normal" [class.text-white/80]="isSelected(cat)" [class.text-slate-400]="!isSelected(cat)">({{ totalCount() }})</span>
            }
          </button>
        }
      </div>
      <!-- Máscara gradiente derecha -->
      <div
        aria-hidden="true"
        [class.opacity-0]="!canScrollRight()"
        class="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white via-white/80 to-transparent z-[5] transition-opacity duration-200"
      ></div>
      <!-- Flecha derecha -->
      <button
        type="button"
        title="Siguiente"
        aria-label="Desplazar categorías a la derecha"
        (click)="scrollBy(220)"
        [class.opacity-0]="!canScrollRight()"
        [class.pointer-events-none]="!canScrollRight()"
        [class.opacity-100]="canScrollRight()"
        class="absolute right-0 z-10 w-7 h-7 flex items-center justify-center bg-white/95 hover:bg-white text-slate-600 hover:text-slate-900 border border-slate-200 rounded-full shadow-sm hover:shadow transition-all focus:outline-none"
      >
        <app-icon name="chevron-right" [size]="16"></app-icon>
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      :host.hidden {
        display: none !important;
      }
      .no-scrollbar {
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      .no-scrollbar::-webkit-scrollbar {
        display: none;
      }
    `,
  ],
})
export class PosCategoryPillsComponent {
  /** Categorías del POS; el primer ítem (`id ''`) es "Todos". */
  readonly categories = input.required<PosCategoryPill[]>();
  /** Id seleccionado (`''` = Todos); misma señal que el dropdown Filtros. */
  readonly selectedId = input<string>('');
  /** Total existente del backend para "Todos (N)". Sin conteos por categoría. */
  readonly totalCount = input<number>(0);
  /** Emite el id elegido; el padre escribe al filtro `category_id` existente. */
  readonly categorySelected = output<string>();

  private readonly scrollContainer =
    viewChild<ElementRef<HTMLDivElement>>('scrollContainer');

  /** Hay contenido oculto a la izquierda → flecha/máscara izquierda visibles. */
  readonly canScrollLeft = signal(false);
  /** Hay contenido oculto a la derecha → flecha/máscara derecha visibles. */
  readonly canScrollRight = signal(false);

  readonly selectedPillClass =
    'px-3.5 py-1.5 rounded-lg text-xs font-bold bg-primary text-white shrink-0 shadow-xs whitespace-nowrap';
  readonly unselectedPillClass =
    'px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 shrink-0 transition-colors whitespace-nowrap';

  constructor() {
    // Estado de bordes SIEMPRE fresco: el scroll/resize no cubre cambios de
    // contenido que no mueven scrollLeft ni el box (conteo "Todos (N)",
    // bold↔semibold al seleccionar, carga async de pills). El
    // MutationObserver cierra esa brecha; las flechas son hermanas del
    // contenedor observado, así que el callback nunca se re-dispara a sí
    // mismo. Wheel con { passive: false } porque el preventDefault es lo
    // que convierte la rueda vertical en horizontal.
    effect((onCleanup) => {
      const el = this.scrollContainer()?.nativeElement;
      if (!el) return;
      const raf = requestAnimationFrame(() => this.updateScrollState());
      const onWheel = (event: WheelEvent): void => {
        if (event.deltaY !== 0) {
          event.preventDefault();
          el.scrollLeft += event.deltaY;
        }
      };
      const resizeObserver = new ResizeObserver(() => this.updateScrollState());
      const contentObserver = new MutationObserver(() =>
        this.updateScrollState(),
      );
      el.addEventListener('wheel', onWheel, { passive: false });
      resizeObserver.observe(el);
      contentObserver.observe(el, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
      // Las fuentes (emoji/texto) pueden ensanchar las pills tras el primer
      // paint sin mutar el DOM: re-medir cuando estén listas. Si el
      // componente ya se destruyó, el set es no-op (misma señal, sin vista).
      let destroyed = false;
      document.fonts?.ready.then(() => {
        if (!destroyed) this.updateScrollState();
      });
      onCleanup(() => {
        destroyed = true;
        cancelAnimationFrame(raf);
        el.removeEventListener('wheel', onWheel);
        resizeObserver.disconnect();
        contentObserver.disconnect();
      });
    });
  }

  isSelected(cat: PosCategoryPill): boolean {
    return cat.id === (this.selectedId() ?? '');
  }

  pillLabel(cat: PosCategoryPill): string {
    return cat.id === ''
      ? `Todos, ${this.totalCount()} productos`
      : `Filtrar por ${cat.name}`;
  }

  selectCategory(id: string): void {
    if (id !== (this.selectedId() ?? '')) {
      this.categorySelected.emit(id);
    }
  }

  onScroll(): void {
    this.updateScrollState();
  }

  scrollBy(deltaX: number): void {
    this.scrollContainer()?.nativeElement.scrollBy({
      left: deltaX,
      behavior: 'smooth',
    });
  }

  /** Lógica de bordes espejo del script de `d25526af.html` (tolerancia 5px). */
  private updateScrollState(): void {
    const el = this.scrollContainer()?.nativeElement;
    if (!el) return;
    const maxScrollLeft = el.scrollWidth - el.clientWidth;
    this.canScrollLeft.set(el.scrollLeft > 5);
    this.canScrollRight.set(el.scrollLeft < maxScrollLeft - 5);
  }
}
