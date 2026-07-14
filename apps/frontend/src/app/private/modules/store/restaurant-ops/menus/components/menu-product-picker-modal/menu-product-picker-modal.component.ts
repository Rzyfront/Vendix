import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';

/**
 * Contrato público de una opción de producto seleccionable en el picker de
 * cartas. El picker NO conoce el modelo de dominio: recibe este shape plano y
 * emite solo los `id` elegidos. `category` se muestra como subtítulo; si falta
 * `imageUrl` se cae a un placeholder con ícono.
 */
export interface MenuProductOption {
  id: number;
  /** Nombre visible del producto. */
  name: string;
  /** Categoría, se muestra como subtítulo. */
  category?: string;
  /** Miniatura; si falta se muestra placeholder con ícono. */
  imageUrl?: string;
  /** Marca el badge "Combo". */
  isCombo?: boolean;
  /** Si es `false`, marca el badge "No vendible". */
  isSellable?: boolean;
}

/**
 * Modal multi-select para agregar productos a una sección de carta. Envuelve
 * `app-modal` y expone un contrato desacoplado del dominio (ver
 * `MenuProductOption`). La selección vive en un `signal<Set<number>>`; el
 * filtrado y el conteo son `computed`. Al confirmar emite los ids y limpia la
 * selección; al cerrar emite `closed` sin persistir nada.
 */
@Component({
  selector: 'app-menu-product-picker-modal',
  standalone: true,
  imports: [FormsModule, ModalComponent, ButtonComponent, IconComponent],
  templateUrl: './menu-product-picker-modal.component.html',
  styleUrl: './menu-product-picker-modal.component.scss',
})
export class MenuProductPickerModalComponent {
  /** Visibilidad; se enlaza a `isOpen` del `app-modal` interno. */
  readonly open = input<boolean>(false);
  /** Universo de productos elegibles. */
  readonly products = input<MenuProductOption[]>([]);
  /** Ids ya presentes en la sección: se excluyen del listado. */
  readonly excludeIds = input<number[]>([]);
  /**
   * Ids ya presentes en CUALQUIER sección de la carta. No se ocultan: se
   * muestran marcados como "En la carta" y no son seleccionables (evita
   * duplicar el mismo producto en la carta).
   */
  readonly inMenuIds = input<number[]>([]);
  /** Estado de carga opcional. */
  readonly loading = input<boolean>(false);

  /** Emite los ids seleccionados al confirmar. */
  readonly confirmed = output<number[]>();
  /** Emite al cancelar/cerrar sin confirmar. */
  readonly closed = output<void>();

  readonly searchTerm = signal<string>('');
  readonly selectedIds = signal<Set<number>>(new Set<number>());
  /** Ids cuyas miniaturas fallaron al cargar: caen al placeholder. */
  private readonly failedImageIds = signal<Set<number>>(new Set<number>());

  readonly selectedCount = computed<number>(() => this.selectedIds().size);

  /** Set memoizado de ids ya en la carta (lookup O(1) en la plantilla). */
  private readonly inMenuIdSet = computed<Set<number>>(
    () => new Set(this.inMenuIds()),
  );

  /** True si el producto ya está en alguna sección de la carta. */
  isInMenu(id: number): boolean {
    return this.inMenuIdSet().has(id);
  }

  /**
   * Productos visibles: quita los excluidos y aplica el filtro por nombre y
   * categoría (case-insensitive). Reactivo a `products`, `excludeIds` y
   * `searchTerm`.
   */
  readonly visibleProducts = computed<MenuProductOption[]>(() => {
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
    // Los productos ya en la carta no son seleccionables (evita duplicados).
    if (this.isInMenu(id)) return;
    const next = new Set(this.selectedIds());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
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
    const ids = Array.from(this.selectedIds());
    if (ids.length === 0) return;
    this.confirmed.emit(ids);
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
