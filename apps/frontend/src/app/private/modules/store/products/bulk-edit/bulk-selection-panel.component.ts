/**
 * Panel izquierdo de la edición masiva: buscar, filtrar y seleccionar (QUI-567).
 *
 * ## Quién es dueño de la selección
 *
 * El `Set` de ids seleccionados NO vive aquí: llega como `model` desde la
 * página. Por eso la selección sobrevive a cambiar de página y de filtro — este
 * componente solo pinta la página actual y escribe sobre la señal del padre. Es
 * también lo que permite que el stack de la derecha muestre productos que ya no
 * están en la página cargada.
 *
 * ## Las cuatro acciones de selección múltiple
 *
 * 1. **Seleccionar la página visible** — se resuelve en el cliente contra los
 *    ids de la página. Tri-estado (ninguno / algunos / todos).
 * 2. **Seleccionar los N resultados del filtro** — la resuelve la PÁGINA, porque
 *    requiere `GET /store/products/ids`: seleccionar "todo" no puede significar
 *    "todo lo que cargué", tiene que significar "todo lo que el filtro
 *    devuelve".
 * 3. **Invertir la selección de la página** — cliente.
 * 4. **Limpiar** — cliente.
 *
 * `ResponsiveDataViewComponent` hace pass-through de `selectable`/`rowIdKey`/
 * `selectedIds` a la tabla y a la lista de cards, pero NO duplica los helpers
 * (`headerSelectionState`, `toggleAllVisible`). Se derivan aquí, y además es lo
 * correcto: la lista de cards móvil no tiene fila de cabecera donde colgar un
 * checkbox maestro, así que "seleccionar la página" tiene que ser un botón del
 * panel y no un `<th>`.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  output,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputsearchComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  SelectorComponent,
  type ItemListCardConfig,
  type SelectorOption,
  type TableColumn,
} from '../../../../../shared/components/index';
// `RowSelectionState` no está re-exportado por el barrel de `shared/components`;
// su fuente es `table.component.ts`, que además es donde vive la semántica
// tri-estado que este panel replica para la página visible.
import type { RowSelectionState } from '../../../../../shared/components/table/table.component';
import { Product, ProductState } from '../interfaces';
import { BULK_EDIT_PRODUCT_TYPE_LABELS } from './bulk-editable-fields.constant';

/** Filtros que el panel gobierna. Espejo del subconjunto útil de la query. */
export interface BulkSelectionFilters {
  search: string;
  state: string;
  product_type: string;
}

export const EMPTY_BULK_SELECTION_FILTERS: BulkSelectionFilters = {
  search: '',
  state: '',
  product_type: '',
};

/** Etiqueta humana de un `product_type` crudo. Tolera nulos y valores nuevos. */
function describeProductType(value: unknown): string {
  const key = String(value ?? 'physical') as keyof typeof BULK_EDIT_PRODUCT_TYPE_LABELS;
  return BULK_EDIT_PRODUCT_TYPE_LABELS[key] ?? String(value ?? '—');
}

@Component({
  selector: 'app-bulk-selection-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    InputsearchComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    SelectorComponent,
  ],
  templateUrl: './bulk-selection-panel.component.html',
})
export class BulkSelectionPanelComponent {
  /** Página actual de resultados. */
  readonly products = input<Product[]>([]);
  /** `true` mientras la página se está trayendo del backend. */
  readonly fetching = input<boolean>(false);
  /** `true` mientras se resuelven los ids de "seleccionar todo el filtro". */
  readonly pickingAll = input<boolean>(false);
  /** Total de productos que satisfacen el filtro (viene de `meta.total`). */
  readonly total = input<number>(0);
  readonly page = input<number>(1);
  readonly limit = input<number>(20);
  readonly totalPages = input<number>(0);
  /**
   * `true` cuando `GET /store/products/ids` recortó el resultado por su tope.
   * Se dice en voz alta: truncar en silencio una selección de "todos" es la
   * clase de mentira que hace que el operador crea que editó lo que no editó.
   */
  readonly capped = input<boolean>(false);
  /** Tope de ids del endpoint de ids, para redactar el aviso de recorte. */
  readonly cappedLimit = input<number>(0);

  /** Selección compartida. La página es la dueña. */
  readonly selectedIds = model<Set<string | number>>(new Set<string | number>());
  /** Filtros. La página los usa para recargar. */
  readonly filters = model<BulkSelectionFilters>({
    ...EMPTY_BULK_SELECTION_FILTERS,
  });

  /** Pide a la página que resuelva los ids del filtro completo. */
  readonly selectAllFiltered = output<void>();
  readonly pageChanged = output<number>();
  readonly refreshRequested = output<void>();

  /**
   * `app-inputsearch` y `app-selector` son CVAs sin input `value`: la ÚNICA
   * forma de escribirles desde código es a través de Angular Forms. Este
   * `FormGroup` local existe para eso — para que "Quitar filtros" pueda vaciar
   * de verdad los tres controles en vez de dejarlos mostrando un filtro que ya
   * no se está aplicando. La fuente de verdad para el padre sigue siendo el
   * `model` `filters`, que se actualiza desde los `(…Change)` de cada control.
   */
  readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
    state: new FormControl<string>('', { nonNullable: true }),
    product_type: new FormControl<string>('', { nonNullable: true }),
  });

  readonly stateOptions: SelectorOption[] = [
    { value: '', label: 'Todos los estados' },
    { value: ProductState.ACTIVE, label: 'Activo' },
    { value: ProductState.INACTIVE, label: 'Inactivo' },
    { value: ProductState.ARCHIVED, label: 'Archivado' },
  ];

  readonly typeOptions: SelectorOption[] = [
    { value: '', label: 'Todos los tipos' },
    { value: 'physical', label: BULK_EDIT_PRODUCT_TYPE_LABELS['physical'] },
    { value: 'service', label: BULK_EDIT_PRODUCT_TYPE_LABELS['service'] },
    { value: 'prepared', label: BULK_EDIT_PRODUCT_TYPE_LABELS['prepared'] },
  ];

  /** Ids de la página actual. Base de las tres acciones de cliente. */
  readonly pageIds = computed<number[]>(() =>
    this.products().map((product) => product.id),
  );

  /** Tri-estado de "seleccionar la página visible". */
  readonly pageSelectionState = computed<RowSelectionState>(() => {
    const ids = this.pageIds();
    if (ids.length === 0) {
      return 'none';
    }
    const selected = this.selectedIds();
    let hits = 0;
    for (const id of ids) {
      if (selected.has(id)) {
        hits += 1;
      }
    }
    if (hits === 0) {
      return 'none';
    }
    return hits === ids.length ? 'all' : 'some';
  });

  readonly selectedCount = computed<number>(() => this.selectedIds().size);

  readonly hasActiveFilters = computed<boolean>(() => {
    const filters = this.filters();
    return Boolean(filters.search || filters.state || filters.product_type);
  });

  readonly columns: TableColumn[] = [
    { key: 'name', label: 'Producto', sortable: false, priority: 1 },
    { key: 'sku', label: 'SKU', sortable: false, priority: 2, defaultValue: '—' },
    {
      key: 'product_type',
      label: 'Tipo',
      sortable: false,
      priority: 3,
      // `app-table` solo corre `transform` si `row[key]` no viene vacío, así que
      // `defaultValue` cubre los productos antiguos sin `product_type`.
      defaultValue: 'Producto Físico',
      transform: (value: any) => describeProductType(value),
    },
    {
      key: 'state',
      label: 'Estado',
      sortable: false,
      priority: 3,
      badge: true,
      // `colorMap` exige hex de 7 caracteres: una clase de Tailwind aquí se
      // pinta como texto crudo en el atributo `style` y el badge sale sin color.
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          active: '#16a34a',
          inactive: '#a1a1aa',
          archived: '#dc2626',
        },
      },
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'sku',
    avatarFallbackIcon: 'package',
    avatarShape: 'square',
    badgeKey: 'state',
    badgeConfig: { type: 'status', size: 'sm' },
    detailKeys: [
      { key: 'sku', label: 'SKU', icon: 'barcode' },
      { key: 'product_type', label: 'Tipo', icon: 'layers' },
    ],
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Acciones de selección resueltas en cliente
  // ───────────────────────────────────────────────────────────────────────────

  /** Marca o desmarca la página visible completa (tri-estado). */
  onTogglePage(): void {
    const ids = this.pageIds();
    if (ids.length === 0) {
      return;
    }
    const next = new Set(this.selectedIds());
    if (this.pageSelectionState() === 'all') {
      ids.forEach((id) => next.delete(id));
    } else {
      ids.forEach((id) => next.add(id));
    }
    this.selectedIds.set(next);
  }

  /** Invierte la selección DENTRO de la página visible. */
  onInvertPage(): void {
    const ids = this.pageIds();
    if (ids.length === 0) {
      return;
    }
    const next = new Set(this.selectedIds());
    for (const id of ids) {
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
    }
    this.selectedIds.set(next);
  }

  onClearSelection(): void {
    this.selectedIds.set(new Set<string | number>());
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Filtros
  // ───────────────────────────────────────────────────────────────────────────

  onSearchChange(term: string): void {
    this.filters.set({ ...this.filters(), search: term ?? '' });
  }

  onStateChange(value: string | number | null): void {
    this.filters.set({ ...this.filters(), state: value ? String(value) : '' });
  }

  onTypeChange(value: string | number | null): void {
    this.filters.set({
      ...this.filters(),
      product_type: value ? String(value) : '',
    });
  }

  onClearFilters(): void {
    this.filterForm.reset({ search: '', state: '', product_type: '' });
    this.filters.set({ ...EMPTY_BULK_SELECTION_FILTERS });
  }
}
