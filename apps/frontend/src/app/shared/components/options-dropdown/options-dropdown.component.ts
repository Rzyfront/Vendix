import {
  Component,
  DestroyRef,
  HostListener,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';
import { Subject, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icons.registry';
import { SelectorComponent } from '../selector/selector.component';
import { MultiSelectorComponent } from '../multi-selector/multi-selector.component';
import { DateRangeFilterComponent } from '../date-range-filter/date-range-filter.component';
import { DateRangeFilter } from '../../interfaces/date-range-filter.interface';

import {
  FilterConfig,
  DropdownAction,
  FilterValues,
} from './options-dropdown.interfaces';

@Component({
  selector: 'app-options-dropdown',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    SelectorComponent,
    MultiSelectorComponent,
    DateRangeFilterComponent,
],
  templateUrl: './options-dropdown.component.html',
  styleUrls: ['./options-dropdown.component.scss'],
})
export class OptionsDropdownComponent {
  /** Configuration for each filter in the dropdown */
  readonly filters = input<FilterConfig[]>([]);

  /** Actions to display in the dropdown */
  readonly actions = input<DropdownAction[]>([]);

  /** Whether to show the actions trigger button */
  readonly showActions = input<boolean>(true);

  /** Current filter values */
  readonly filterValues = input<FilterValues>({});

  /** Title shown in the dropdown header */
  readonly title = input<string>('Opciones');

  /** Label for the trigger button */
  readonly triggerLabel = input<string>('Opciones');

  /** Icon for the trigger button */
  readonly triggerIcon = input<IconName>('plus');

  /** Debounce time in milliseconds for filter changes */
  readonly debounceMs = input<number>(350);

  /** Whether the component is in a loading state */
  readonly isLoading = input<boolean>(false);

  /** Emits when filter values change (after debounce) */
  readonly filterChange = output<FilterValues>();

  /** Emits when an action is clicked */
  readonly actionClick = output<string>();

  /** Emits when "clear all" is clicked */
  readonly clearAllFilters = output<void>();

  readonly dropdownContainer = viewChild.required<ElementRef<HTMLElement>>('dropdownContainer');
  readonly actionsTriggerButton = viewChild.required<ElementRef<HTMLButtonElement>>('actionsTriggerButton');
  readonly filtersTriggerButton = viewChild.required<ElementRef<HTMLButtonElement>>('filtersTriggerButton');

  private readonly destroyRef = inject(DestroyRef);

  readonly isActionsOpen = signal(false);
  readonly isFiltersOpen = signal(false);
  readonly activeFiltersCount = signal(0);

  /** Position for mobile dropdown */
  readonly dropdownTop = signal<number | null>(null);
  readonly dropdownRight = signal<number | null>(null);

  /** Check if we're on mobile/tablet */
  get isMobileOrTablet(): boolean {
    return typeof window !== 'undefined' && window.innerWidth < 1024;
  }

  /** Local state for filter values */
  readonly localFilterValues = signal<FilterValues>({});

  /** Emits debounce trigger — value is the debounce time to apply */
  private readonly debounceTrigger$ = new Subject<number>(); // LEGÍTIMO — debounce pipeline para filterChange

  constructor() {
    // Sync filterValues input → local state.
    //
    // BUG FIX admin-orders-filters: antes leíamos `this.localFilterValues()`
    // directamente dentro del effect (vía `shallowEqual` y vía
    // `calculateActiveFiltersCount`), lo que creaba una dependencia
    // reactiva entre el effect y `localFilterValues`. Resultado: cuando el
    // usuario seleccionaba un filtro, `onFilterChange()` escribía en
    // `localFilterValues` con el valor nuevo, el effect se re-disparaba
    // antes de que el debounce emitiera, leía el `filterValues` del
    // padre (que aún estaba vacío), lo copiaba sobre `localFilterValues`
    // y CANCELABA la selección del usuario antes de que llegara al
    // backend. Síntomas: filtrar por "Entregada" mostraba órdenes en
    // "Procesando"; filtrar por "Tienda Online" devolvía órdenes POS;
    // el usuario percibía "click afuera del modal pierde los filtros"
    // porque la cancelación ocurre en el mismo frame que la selección.
    //
    // La guarda de igualdad superficial importa: varios padres reconstruyen
    // el objeto `filterValues` en cada emisión (`this.filterValues = {...}`),
    // así que sin ella el effect corría en cada ciclo y podía pisar una
    // edición local todavía en debounce. Con `'date-range'` esto se agrava,
    // porque un solo filtro escribe TRES keys y el padre las devuelve
    // reconstruidas.
    //
    // El `untracked()` evita que el effect se suscriba a `localFilterValues`
    // y, por tanto, que se re-dispare cada vez que el usuario edita el
    // dropdown. La sincronía padre→local sigue siendo reactiva (sólo
    // depende de `this.filterValues()`).
    effect(() => {
      const incoming = this.filterValues();
      untracked(() => {
        const local = this.localFilterValues();
        if (this.shallowEqual(incoming, local)) {
          return;
        }
        this.localFilterValues.set({ ...incoming });
        this.calculateActiveFiltersCount();
      });
    });

    // Single pipeline: switchMap re-crea la espera cuando llega un nuevo cambio,
    // así que sólo el último sobrevive.
    //
    // Antes esto era `of(null).pipe(debounceTime(ms))`, que NO esperaba nada:
    // `debounceTime` descarga su valor pendiente en cuanto la fuente completa, y
    // `of(null)` completa de inmediato. El resultado era una emisión síncrona
    // por cada tecla/selección — cuatro cambios de preset en 32 ms disparaban
    // cuatro peticiones. `timer(ms)` sí emite recién cumplido el plazo.
    this.debounceTrigger$
      .pipe(
        switchMap((ms) => timer(ms)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.emitFilterChange());
  }

  private shallowEqual(a: FilterValues, b: FilterValues): boolean {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => {
      const av = a[key];
      const bv = b[key];
      if (Array.isArray(av) || Array.isArray(bv)) {
        if (!Array.isArray(av) || !Array.isArray(bv)) return false;
        return av.length === bv.length && av.every((v, i) => v === bv[i]);
      }
      return av === bv;
    });
  }

  // --- date-range: resolución de las 3 keys --------------------------------

  /**
   * Un filtro `'date-range'` no ocupa `filter.key` sino tres derivadas. Se
   * resuelven aquí en un solo lugar para que la plantilla, el conteo de activos
   * y el "limpiar" hablen exactamente de las mismas keys.
   */
  dateRangeKeys(filter: FilterConfig): {
    startKey: string;
    endKey: string;
    presetKey: string;
  } {
    return {
      startKey: filter.startKey ?? `${filter.key}_start`,
      endKey: filter.endKey ?? `${filter.key}_end`,
      presetKey: filter.presetKey ?? `${filter.key}_preset`,
    };
  }

  /** Reconstruye el `DateRangeFilter` que consume `<vendix-date-range-filter>`. */
  getDateRangeValue(filter: FilterConfig): DateRangeFilter | undefined {
    const { startKey, endKey, presetKey } = this.dateRangeKeys(filter);
    const values = this.localFilterValues();
    const start = values[startKey];
    const end = values[endKey];
    const preset = values[presetKey];

    if (typeof start !== 'string' || typeof end !== 'string' || !start || !end) {
      return undefined;
    }
    return {
      start_date: start,
      end_date: end,
      preset: (typeof preset === 'string' && preset
        ? preset
        : undefined) as DateRangeFilter['preset'],
    };
  }

  onDateRangeChange(filter: FilterConfig, range: DateRangeFilter): void {
    const { startKey, endKey, presetKey } = this.dateRangeKeys(filter);
    this.localFilterValues.update((prev) => ({
      ...prev,
      [startKey]: range.start_date || null,
      [endKey]: range.end_date || null,
      [presetKey]: range.preset || null,
    }));
    this.calculateActiveFiltersCount();
    this.debounceTrigger$.next(this.debounceMs());
  }

  private calculateActiveFiltersCount(): void {
    let count = 0;
    const values = this.localFilterValues();
    for (const filter of this.filters()) {
      if (filter.type === 'multi-select') {
        const value = values[filter.key];
        if (Array.isArray(value) && value.length > 0) {
          count++;
        }
        continue;
      }
      if (filter.type === 'date-range') {
        // El rango cuenta como UN filtro activo aunque ocupe tres keys.
        const { startKey, endKey } = this.dateRangeKeys(filter);
        if (values[startKey] || values[endKey]) {
          count++;
        }
        continue;
      }
      const value = values[filter.key];
      if (value && value !== '') {
        count++;
      }
    }
    this.activeFiltersCount.set(count);
  }

  toggleActionsDropdown(): void {
    this.isActionsOpen.update((v) => !v);
    this.isFiltersOpen.set(false);
  }

  toggleFiltersDropdown(): void {
    this.isFiltersOpen.update((v) => !v);
    this.isActionsOpen.set(false);
  }

  closeAllDropdowns(): void {
    this.isActionsOpen.set(false);
    this.isFiltersOpen.set(false);
  }

  closeDropdown(): void {
    this.closeAllDropdowns();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const dropdownContainer = this.dropdownContainer();
    if (
      dropdownContainer &&
      !dropdownContainer.nativeElement.contains(event.target as Node)
    ) {
      this.closeAllDropdowns();
    }
  }

  @HostListener('keydown.escape')
  onEscapeKey(): void {
    this.closeDropdown();
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    // Position is handled purely by CSS — no action needed
  }

  onFilterChange(key: string, value: string | number | null): void {
    this.localFilterValues.update((prev) => ({ ...prev, [key]: value?.toString() || null }));
    this.calculateActiveFiltersCount();
    this.debounceTrigger$.next(this.debounceMs());
  }

  onMultiFilterChange(key: string, values: (string | number)[]): void {
    this.localFilterValues.update((prev) => ({ ...prev, [key]: values.map((v) => v.toString()) }));
    this.calculateActiveFiltersCount();
    this.debounceTrigger$.next(this.debounceMs());
  }

  private emitFilterChange(): void {
    this.filterChange.emit({ ...this.localFilterValues() });
  }

  onClearAllFilters(): void {
    // Emit clearAllFilters so the parent can reset to its own defaults
    // (e.g. thisMonth date range, default granularity).
    // We intentionally do NOT emit filterChange here to avoid dispatching
    // null/empty values before the parent sets the correct defaults.
    this.clearAllFilters.emit();
  }

  onClearFilter(key: string): void {
    const filter = this.filters().find((f) => f.key === key);
    if (filter) {
      if (filter.type === 'multi-select') {
        this.localFilterValues.update((prev) => ({ ...prev, [key]: [] }));
      } else if (filter.type === 'date-range') {
        const { startKey, endKey, presetKey } = this.dateRangeKeys(filter);
        this.localFilterValues.update((prev) => ({
          ...prev,
          [startKey]: null,
          [endKey]: null,
          [presetKey]: null,
        }));
      } else {
        this.localFilterValues.update((prev) => ({ ...prev, [key]: null }));
      }
      this.calculateActiveFiltersCount();
      // Emit immediately for explicit clear action
      this.emitFilterChange();
    }
  }

  hasActiveFilter(key: string): boolean {
    const filter = this.filters().find((f) => f.key === key);
    if (filter?.type === 'date-range') {
      const { startKey, endKey } = this.dateRangeKeys(filter);
      const values = this.localFilterValues();
      return !!values[startKey] || !!values[endKey];
    }
    const value = this.localFilterValues()[key];
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return !!value && value !== '';
  }

  onActionClick(action: string): void {
    this.actionClick.emit(action);
    this.closeAllDropdowns();
  }

  get hasActions(): boolean {
    return this.showActions() && this.actions().length > 0;
  }

  get hasFilters(): boolean {
    return this.filters().length > 0;
  }

  /**
   * Get the current value for a single-select filter
   */
  getFilterValue(key: string): string {
    const value = this.localFilterValues()[key];
    if (typeof value === 'string') {
      return value;
    }
    return '';
  }

  /**
   * Get the current values for a multi-select filter
   */
  getMultiFilterValues(key: string): string[] {
    const value = this.localFilterValues()[key];
    if (Array.isArray(value)) {
      return value;
    }
    return [];
  }
}
