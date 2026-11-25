/**
 * Panel izquierdo de la edición masiva de clientes: buscar, filtrar y
 * seleccionar.
 *
 * ## Quién es dueño de la selección
 *
 * El `Set` de ids NO vive aquí: llega como `model` desde la página. Por eso la
 * selección sobrevive a cambiar de página y de filtro, y el stack de la derecha
 * puede mostrar clientes que ya no están en la página cargada.
 *
 * ## Las cuatro acciones de selección
 *
 * 1. **Seleccionar la página visible** — cliente, tri-estado.
 * 2. **Seleccionar los N del filtro** — la resuelve la PÁGINA con
 *    `GET /bulk-edit/ids`: "todos" no puede significar "los que cargué".
 * 3. **Invertir la página** — cliente.
 * 4. **Limpiar** — cliente.
 *
 * ## Filtros
 *
 * Se combinan con AND y se pintan como chips removibles, así que el operador ve
 * en todo momento qué está acotando la selección. En móvil viven dentro de un
 * desplegable para no empujar la tabla fuera de pantalla; los chips quedan
 * siempre visibles.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

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
import type { RowSelectionState } from '../../../../../shared/components/table/table.component';
import {
  BulkCustomerFilters,
  BulkCustomerRow,
  EMPTY_BULK_CUSTOMER_FILTERS,
} from './bulk-edit-customers.interface';

/** Opción de catálogo que el panel pinta en un selector. */
export interface BulkCustomerFilterOption {
  id: number;
  name: string;
}

/** Etiqueta del valor «sin tarifa» en el selector de tarifa del filtro. */
const NO_TIER_FILTER = 'none';

/** `Ana Díaz` / `Acme S.A.S.` / `Cliente #12`, en ese orden. */
export function displayCustomerName(
  row: Pick<
    BulkCustomerRow,
    'id' | 'first_name' | 'last_name' | 'legal_name' | 'person_type'
  > | null | undefined,
): string {
  if (!row) return '';
  const legal = (row.legal_name ?? '').trim();
  if (row.person_type === 'JURIDICA' && legal) return legal;
  const natural = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim();
  return natural || legal || `Cliente #${row.id}`;
}

@Component({
  selector: 'app-bulk-customer-selection-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    InputsearchComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    SelectorComponent,
  ],
  templateUrl: './bulk-customer-selection-panel.component.html',
})
export class BulkCustomerSelectionPanelComponent {
  /** Página actual de resultados. */
  readonly rows = input<BulkCustomerRow[]>([]);
  readonly fetching = input<boolean>(false);
  readonly pickingAll = input<boolean>(false);
  /** Total de clientes que cumplen el filtro (`meta.total`). */
  readonly total = input<number>(0);
  readonly page = input<number>(1);
  readonly limit = input<number>(20);
  readonly totalPages = input<number>(0);
  /** `true` si `GET /ids` recortó la selección por su tope. */
  readonly capped = input<boolean>(false);
  readonly cappedLimit = input<number>(0);

  /** Catálogos de filtro, resueltos por la página. */
  readonly segments = input<readonly BulkCustomerFilterOption[]>([]);
  readonly tags = input<readonly BulkCustomerFilterOption[]>([]);
  readonly priceTiers = input<readonly BulkCustomerFilterOption[]>([]);

  /** Selección compartida. La página es la dueña. */
  readonly selectedIds = model<Set<string | number>>(
    new Set<string | number>(),
  );
  /** Filtros compartidos. */
  readonly filters = model<BulkCustomerFilters>({
    ...EMPTY_BULK_CUSTOMER_FILTERS,
  });

  readonly selectAllFiltered = output<void>();
  readonly pageChanged = output<number>();
  readonly refreshRequested = output<void>();
  readonly filtersChange = output<BulkCustomerFilters>();

  /** Desplegable de filtros (en escritorio arranca abierto). */
  readonly filtersOpen = signal<boolean>(false);

  /**
   * Clases del contenedor de filtros.
   *
   * Móvil: `hidden` hasta que se abre el desplegable. Escritorio: `md:grid`
   * pisa el `hidden` (las utilidades de variante van después en la hoja, así
   * que ganan con la misma especificidad), y así el panel no esconde filtros
   * donde hay sitio para ellos.
   */
  readonly filtersContainerClass = computed<string>(() => {
    const base = 'grid grid-cols-1 gap-2 sm:grid-cols-2';
    return this.filtersOpen() ? base : `${base} hidden md:grid`;
  });

  readonly stateOptions: SelectorOption[] = [
    { value: '', label: 'Todos los estados' },
    { value: 'active', label: 'Activos' },
    { value: 'inactive', label: 'Inactivos' },
  ];

  readonly segmentOptions = computed<SelectorOption[]>(() => [
    { value: '', label: 'Todos los segmentos' },
    ...this.segments().map((segment) => ({
      value: segment.id,
      label: segment.name,
    })),
  ]);

  readonly tagOptions = computed<SelectorOption[]>(() => [
    { value: '', label: 'Todas las etiquetas' },
    ...this.tags().map((tag) => ({ value: tag.id, label: tag.name })),
  ]);

  readonly priceTierOptions = computed<SelectorOption[]>(() => [
    { value: '', label: 'Todas las tarifas' },
    ...this.priceTiers().map((tier) => ({
      value: tier.id,
      label: tier.name,
    })),
    { value: NO_TIER_FILTER, label: 'Sin tarifa' },
  ]);

  /** Ids de la página visible. Base de las acciones resueltas en cliente. */
  readonly pageIds = computed<number[]>(() => this.rows().map((row) => row.id));

  readonly pageSelectionState = computed<RowSelectionState>(() => {
    const ids = this.pageIds();
    if (ids.length === 0) {
      return 'none';
    }
    const selected = this.selectedIds();
    let hits = 0;
    for (const id of ids) {
      if (selected.has(id)) hits += 1;
    }
    if (hits === 0) return 'none';
    return hits === ids.length ? 'all' : 'some';
  });

  readonly selectedCount = computed<number>(() => this.selectedIds().size);

  readonly activeChips = computed<
    Array<{ key: string; label: string; value: string }>
  >(() => {
    const filters = this.filters();
    const chips: Array<{ key: string; label: string; value: string }> = [];

    if (filters.state) {
      chips.push({
        key: 'state',
        label: 'Estado',
        value: filters.state === 'active' ? 'Activos' : 'Inactivos',
      });
    }
    const segmentId = filters.segment_ids?.[0];
    if (segmentId) {
      chips.push({
        key: 'segment',
        label: 'Segmento',
        value:
          this.segments().find((segment) => segment.id === segmentId)?.name ??
          `#${segmentId}`,
      });
    }
    const tagId = filters.tag_ids?.[0];
    if (tagId) {
      chips.push({
        key: 'tag',
        label: 'Etiqueta',
        value: this.tags().find((tag) => tag.id === tagId)?.name ?? `#${tagId}`,
      });
    }
    if (filters.price_tier_id) {
      chips.push({
        key: 'price_tier',
        label: 'Tarifa',
        value:
          this.priceTiers().find((tier) => tier.id === filters.price_tier_id)
            ?.name ?? `#${filters.price_tier_id}`,
      });
    }
    if (filters.without_price_tier) {
      chips.push({ key: 'without_price_tier', label: 'Tarifa', value: 'Sin tarifa' });
    }
    if (filters.state_province?.trim()) {
      chips.push({
        key: 'state_province',
        label: 'Departamento',
        value: filters.state_province.trim(),
      });
    }
    if (filters.city?.trim()) {
      chips.push({
        key: 'city',
        label: 'Ciudad',
        value: filters.city.trim(),
      });
    }
    if (filters.created_from) {
      chips.push({
        key: 'created_from',
        label: 'Alta desde',
        value: formatDate(filters.created_from),
      });
    }
    if (filters.created_to) {
      chips.push({
        key: 'created_to',
        label: 'Alta hasta',
        value: formatDate(filters.created_to),
      });
    }
    return chips;
  });

  readonly hasActiveFilters = computed<boolean>(
    () => this.activeChips().length > 0 || !!this.filters().search?.trim(),
  );

  readonly columns: TableColumn[] = [
    {
      // `id` y no `first_name`: la tabla compartida no aplica `transform`
      // cuando el valor de la columna está vacío, y una persona jurídica tiene
      // `first_name = ''` → se vería «—» en vez de su razón social.
      key: 'id',
      label: 'Cliente',
      priority: 1,
      transform: (_value: unknown, row?: BulkCustomerRow) =>
        displayCustomerName(row),
    },
    {
      key: 'document_number',
      label: 'Documento',
      priority: 2,
      transform: (_value: unknown, row?: BulkCustomerRow) =>
        row?.document_number || 'Sin documento',
    },
    {
      key: 'price_tier_name',
      label: 'Tarifa',
      priority: 2,
      defaultValue: 'Sin tarifa',
      transform: (value: unknown) => (value ? String(value) : 'Sin tarifa'),
    },
    {
      key: 'city',
      label: 'Ciudad',
      priority: 3,
      defaultValue: '—',
      transform: (value: unknown) => (value ? String(value) : '—'),
    },
    {
      key: 'state',
      label: 'Estado',
      priority: 3,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          active: '#16a34a',
          inactive: '#a1a1aa',
        },
      },
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'id',
    titleTransform: (item: BulkCustomerRow) => displayCustomerName(item),
    subtitleKey: 'document_number',
    subtitleTransform: (item: BulkCustomerRow) =>
      item?.document_number || 'Sin documento',
    avatarFallbackIcon: 'user',
    avatarShape: 'circle',
    badgeKey: 'state',
    badgeConfig: { type: 'status', size: 'sm' },
    detailKeys: [
      {
        key: 'price_tier_name',
        label: 'Tarifa',
        icon: 'tag',
        transform: (value: unknown) => (value ? String(value) : 'Sin tarifa'),
      },
      {
        key: 'city',
        label: 'Ciudad',
        icon: 'map-pin',
        transform: (value: unknown) => (value ? String(value) : '—'),
      },
    ],
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Selección
  // ───────────────────────────────────────────────────────────────────────────

  onTogglePage(): void {
    const ids = this.pageIds();
    if (ids.length === 0) return;
    const next = new Set(this.selectedIds());
    if (this.pageSelectionState() === 'all') {
      ids.forEach((id) => next.delete(id));
    } else {
      ids.forEach((id) => next.add(id));
    }
    this.selectedIds.set(next);
  }

  onInvertPage(): void {
    const ids = this.pageIds();
    if (ids.length === 0) return;
    const next = new Set(this.selectedIds());
    for (const id of ids) {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    }
    this.selectedIds.set(next);
  }

  onClearSelection(): void {
    this.selectedIds.set(new Set<string | number>());
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Filtros
  // ───────────────────────────────────────────────────────────────────────────

  onSearch(term: string): void {
    this.applyFilters({ ...this.filters(), search: term ?? '' });
  }

  onStateChange(value: string | number | null): void {
    const state = value === 'active' || value === 'inactive' ? value : '';
    this.applyFilters({ ...this.filters(), state });
  }

  onSegmentChange(value: string | number | null): void {
    const id = Number(value);
    this.applyFilters({
      ...this.filters(),
      segment_ids: Number.isInteger(id) && id > 0 ? [id] : [],
    });
  }

  onTagChange(value: string | number | null): void {
    const id = Number(value);
    this.applyFilters({
      ...this.filters(),
      tag_ids: Number.isInteger(id) && id > 0 ? [id] : [],
    });
  }

  onPriceTierChange(value: string | number | null): void {
    if (value === NO_TIER_FILTER) {
      this.applyFilters({
        ...this.filters(),
        price_tier_id: null,
        without_price_tier: true,
      });
      return;
    }
    const id = Number(value);
    this.applyFilters({
      ...this.filters(),
      price_tier_id: Number.isInteger(id) && id > 0 ? id : null,
      without_price_tier: false,
    });
  }

  onTextFilter(
    key: 'city' | 'state_province',
    value: string | number | null,
  ): void {
    this.applyFilters({ ...this.filters(), [key]: String(value ?? '') });
  }

  onDateFilter(key: 'created_from' | 'created_to', event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.applyFilters({ ...this.filters(), [key]: target?.value ?? '' });
  }

  /** Quita UN filtro desde su chip y recarga. */
  onRemoveChip(key: string): void {
    const filters = { ...this.filters() };
    switch (key) {
      case 'state':
        filters.state = '';
        break;
      case 'segment':
        filters.segment_ids = [];
        break;
      case 'tag':
        filters.tag_ids = [];
        break;
      case 'price_tier':
        filters.price_tier_id = null;
        break;
      case 'without_price_tier':
        filters.without_price_tier = false;
        break;
      case 'city':
        filters.city = '';
        break;
      case 'state_province':
        filters.state_province = '';
        break;
      case 'created_from':
        filters.created_from = '';
        break;
      case 'created_to':
        filters.created_to = '';
        break;
      default:
        break;
    }
    this.applyFilters(filters);
  }

  onClearFilters(): void {
    this.applyFilters({ ...EMPTY_BULK_CUSTOMER_FILTERS });
  }

  toggleFilters(): void {
    this.filtersOpen.update((open) => !open);
  }

  /** Tipo de un selector: `app-selector` entrega `string | number | null`. */
  protected readonly NO_TIER_FILTER = NO_TIER_FILTER;

  private applyFilters(filters: BulkCustomerFilters): void {
    this.filters.set(filters);
    this.filtersChange.emit(filters);
  }
}

/** `2026-11-25` → `25/11/2026`. La fecha llega como ISO corto del input date. */
function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}
