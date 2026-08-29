import { Component, model } from '@angular/core';

/**
 * Estados del filtro tri-estado del listado de productos (QUI-729).
 *
 * - `'products'`    → el listado admin SOLO muestra productos (`is_ingredient=false`)
 * - `'ingredients'` → SOLO insumos (`is_ingredient=true`)
 * - `'all'`         → productos E insumos (el parámetro se OMITE)
 *
 * El default es `'products'` y vive en el CLIENTE (ADR-6): Pollo Árabe no
 * quiere ver insumos en el listado general.
 */
export type ProductTypeFilterValue = 'products' | 'ingredients' | 'all';

/**
 * Chip tri-estado "Productos / Insumos / Todos".
 *
 * Es un componente NUEVO y no una extensión de `app-options-dropdown`: el
 * contrato `FilterType` de ese shared solo admite `'select' | 'multi-select' |
 * 'date' | 'date-range'` y el chip debe estar SIEMPRE visible (no dentro de un
 * menú), así que extender el dropdown lo habría metido en un popover.
 *
 * Semántica: `role="radiogroup"` + `role="radio"` + `aria-checked` +
 * `tabindex` por opción (roving: 0 para la seleccionada, -1 para el resto),
 * con navegación por flechas. Es la misma decisión ya tomada en B.4
 * (`pos-consumo-step`). Un chip tri-estado sin semántica de radio se anuncia
 * como tres controles independientes y el lector no sabe cuál está activo.
 */
@Component({
  selector: 'app-product-type-chip-filter',
  standalone: true,
  templateUrl: './product-type-chip-filter.component.html',
  styleUrls: ['./product-type-chip-filter.component.scss'],
})
export class ProductTypeChipFilterComponent {
  /** Selección actual. Two-way: `[value]` + `(valueChange)`. */
  readonly value = model<ProductTypeFilterValue>('products');

  readonly options: ReadonlyArray<{
    value: ProductTypeFilterValue;
    label: string;
  }> = [
    { value: 'products', label: 'Productos' },
    { value: 'ingredients', label: 'Insumos' },
    { value: 'all', label: 'Todos' },
  ];

  select(value: ProductTypeFilterValue): void {
    this.value.set(value);
  }

  /**
   * Navegación por teclado de radiogroup (flechas Izq/Der). Sin esto el grupo
   * tiene tres tab stops independientes y no se comporta como un grupo: el
   * modelo de roving tabindex exige UN tab stop y moverse con flechas.
   */
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
      return;
    }
    event.preventDefault();
    const count = this.options.length;
    const current = this.options.findIndex((o) => o.value === this.value());
    const next =
      event.key === 'ArrowRight'
        ? (current + 1) % count
        : (current - 1 + count) % count;
    this.value.set(this.options[next].value);
  }
}
