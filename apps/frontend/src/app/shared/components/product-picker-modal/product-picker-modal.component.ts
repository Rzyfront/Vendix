import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ModalComponent } from '../modal/modal.component';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';

/**
 * QUI-690 — Contrato compartido de una opción de producto seleccionable en
 * `app-product-picker-modal`. Desacoplado del dominio (mismo patrón que
 * `MenuProductOption` antes de la extracción): el picker NO conoce el shape
 * completo de `Product`, sólo este envelope plano. El padre mapea desde el
 * modelo real.
 */
export interface ProductPickerOption {
  id: number;
  /** Nombre visible del producto. */
  name: string;
  /** Categoría o etiqueta auxiliar, mostrada como subtítulo. */
  category?: string;
  /** Miniatura; si falta o falla al cargar, cae al placeholder con ícono. */
  imageUrl?: string;
  /** Marca el badge "Combo" (restaurante). Reservado para futuro. */
  isCombo?: boolean;
  /** Si es `false`, marca el badge "No vendible". */
  isSellable?: boolean;
}

/**
 * QUI-690 — Extraído de `app-menu-product-picker-modal`
 * (`restaurant-ops/menus/...`) para hacerlo shared y soportar
 * selección single (invoice-create) además de multi-select (cartas).
 *
 * Cambios respecto al original:
 * - Selector renombrado a `app-product-picker-modal`.
 * - Contrato `MenuProductOption` renombrado a `ProductPickerOption`.
 * - Nuevo input `mode: 'single' | 'multiple' = 'multiple'`. En `single`
 *   el picker solo permite elegir un producto (toggle reemplaza la
 *   selección previa) y emite `confirmed` con `number | null` (null si
 *   cancela).
 * - Nuevo output `productCreateRequested` (botón "Crear nuevo" opcional
 *   que el padre inyecta vía `slot="empty-action"`).
 * - Inputs legacy `excludeIds` e `inMenuIds` se conservan con su
 *   semántica original para que `menu-builder-page` siga funcionando
 *   idéntico.
 */
@Component({
  selector: 'app-product-picker-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ModalComponent, ButtonComponent, IconComponent],
  templateUrl: './product-picker-modal.component.html',
  styleUrl: './product-picker-modal.component.scss',
})
export class ProductPickerModalComponent {
  /** Visibilidad; se enlaza a `isOpen` del `app-modal` interno. */
  readonly open = input<boolean>(false);
  /** Universo de productos elegibles. */
  readonly products = input<ProductPickerOption[]>([]);
  /** Ids a OCULTAR del listado. */
  readonly excludeIds = input<number[]>([]);
  /**
   * Ids a mostrar pero DESHABILITAR (no seleccionables). Semántica
   * original de `inMenuIds` para cartas: "ya está, no duplicar".
   */
  readonly disabledIds = input<number[]>([]);
  /** Estado de carga opcional. */
  readonly loading = input<boolean>(false);
  /**
   * Modo de selección. `'multiple'` (default) emite `confirmed` con
   * `number[]`. `'single'` emite `confirmed` con `number | null` y
   * cierra el modal al confirmar; un segundo click en el mismo
   * producto lo deselecciona y al confirmar emite `null`.
   */
  readonly mode = input<'single' | 'multiple'>('multiple');

  /** Emite los ids seleccionados al confirmar (shape depende de `mode`). */
  readonly confirmed = output<number[] | number | null>();
  /** Emite al cancelar/cerrar sin confirmar. */
  readonly closed = output<void>();
  /**
   * Emite cuando el usuario hace click en el botón "Crear nuevo producto"
   * inyectado por el padre vía `slot="empty-action"`. El padre abre
   * `product-create-modal` (o similar) y, tras creación exitosa, lo
   * agrega al input `products` y vuelve a abrir este picker.
   */
  readonly productCreateRequested = output<void>();

  readonly searchTerm = signal<string>('');
  readonly selectedIds = signal<Set<number>>(new Set<number>());
  /** Ids cuyas miniaturas fallaron al cargar: caen al placeholder. */
  private readonly failedImageIds = signal<Set<number>>(new Set<number>());

  readonly selectedCount = computed<number>(() => this.selectedIds().size);

  /** Set memoizado de ids deshabilitados (lookup O(1) en la plantilla). */
  private readonly disabledIdSet = computed<Set<number>>(
    () => new Set(this.disabledIds()),
  );

  /** True si el producto debe mostrarse deshabilitado. */
  isDisabled(id: number): boolean {
    return this.disabledIdSet().has(id);
  }

  /**
   * Productos visibles: quita los excluidos y aplica el filtro por
   * nombre y categoría (case-insensitive). Reactivo a `products`,
   * `excludeIds` y `searchTerm`.
   */
  readonly visibleProducts = computed<ProductPickerOption[]>(() => {
    const excluded = new Set(this.excludeIds());
    const term = this.searchTerm().trim().toLowerCase();
    return this.products()
      .filter((p) => !excluded.has(p.id))
      .filter((p) => {
        if (!term) return true;
        const name = p.name?.toLowerCase() ?? '';
        const category = p.category?.toLowerCase() ?? '';
        return name.includes(term) || category.includes(term);
      });
  });

  isSelected(id: number): boolean {
    return this.selectedIds().has(id);
  }

  toggle(id: number): void {
    if (this.isDisabled(id)) return;
    const next = new Set(this.selectedIds());
    if (this.mode() === 'single') {
      // En single, click sobre el mismo producto lo deselecciona; click
      // sobre otro reemplaza la selección.
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.clear();
        next.add(id);
      }
    } else {
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
    }
    this.selectedIds.set(next);
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
  }

  onImageError(id: number): void {
    this.failedImageIds.update((set) => {
      if (set.has(id)) return set;
      const next = new Set(set);
      next.add(id);
      return next;
    });
  }

  hasImageFailed(id: number): boolean {
    return this.failedImageIds().has(id);
  }

  handleConfirm(): void {
    if (this.mode() === 'single') {
      const ids = Array.from(this.selectedIds());
      this.confirmed.emit(ids[0] ?? null);
    } else {
      const ids = Array.from(this.selectedIds());
      if (ids.length === 0) return;
      this.confirmed.emit(ids);
    }
    this.reset();
  }

  handleClose(): void {
    this.reset();
    this.closed.emit();
  }

  /** Limpia selección, búsqueda y errores de imagen para el próximo uso. */
  private reset(): void {
    this.selectedIds.set(new Set<number>());
    this.searchTerm.set('');
    this.failedImageIds.set(new Set<number>());
  }
}
