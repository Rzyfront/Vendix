import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';

import {
  IconComponent,
  InputsearchComponent,
} from '../../../../../../shared/components/index';
import {
  TransferPickerRow,
  TransferProductSearchFn,
  pickerRowKey,
} from './transfer-draft';

/**
 * Buscador de productos para mover entre bodegas, compartido por el modal
 * rápido y la vista avanzada (tienda y organización).
 *
 * - La búsqueda NO se limpia al agregar: el comerciante sigue agregando sin
 *   volver a teclear.
 * - Selección múltiple con casillas y "Agregar seleccionados".
 * - Cada variante es una fila propia (producto + variante).
 */
@Component({
  selector: 'app-transfer-product-picker',
  standalone: true,
  imports: [IconComponent, InputsearchComponent],
  template: `
    <div class="space-y-2">
      <app-inputsearch
        size="sm"
        placeholder="Buscar por nombre, SKU o variante..."
        ariaLabel="Buscar productos para mover"
        [debounceTime]="300"
        [disabled]="!ready()"
        (searchChange)="onSearch($event)"
      ></app-inputsearch>

      @if (!ready()) {
        <p class="text-xs text-text-secondary">
          {{ requireDestination()
            ? 'Elige primero la bodega de origen y la de destino para buscar productos.'
            : 'Elige primero la bodega de origen para buscar productos.' }}
        </p>
      } @else if (searching()) {
        <p class="text-xs text-text-secondary py-2" data-testid="picker-searching">
          Buscando productos...
        </p>
      } @else if (error()) {
        <p class="text-xs text-error py-2">{{ error() }}</p>
      } @else if (term().length >= minChars && results().length === 0) {
        <p class="text-sm text-text-secondary text-center py-3">
          No hay productos con existencias en la bodega de origen para "{{ term() }}".
        </p>
      }

      @if (results().length > 0) {
        <div class="border border-border rounded-xl overflow-hidden">
          <div
            class="flex items-center justify-between gap-3 px-3 py-2 bg-surface-secondary border-b border-border"
          >
            <label class="flex items-center gap-2 text-xs font-medium text-text-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                class="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                data-testid="picker-select-all"
                [checked]="allSelectableChecked()"
                [disabled]="selectableRows().length === 0"
                (change)="toggleAll($any($event.target).checked)"
              />
              Seleccionar todos ({{ selectableRows().length }})
            </label>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/15 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="picker-add-selected"
              [disabled]="selectedCount() === 0"
              (click)="addSelected()"
            >
              <app-icon name="plus" [size]="14"></app-icon>
              Agregar seleccionados ({{ selectedCount() }})
            </button>
          </div>

          <ul class="max-h-60 overflow-y-auto divide-y divide-border">
            @for (row of results(); track rowKey(row)) {
              @let key = rowKey(row);
              @let added = isAdded(key);
              @let noStock = row.stock_at_origin.quantity_available <= 0;
              <li>
                <label
                  class="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-primary/5"
                  [class.cursor-pointer]="!added && !noStock"
                  [class.opacity-50]="added || noStock"
                  [attr.data-testid]="'picker-row-' + key"
                >
                  <input
                    type="checkbox"
                    class="w-4 h-4 rounded border-border text-primary focus:ring-primary shrink-0"
                    [checked]="added || isSelected(key)"
                    [disabled]="added || noStock"
                    (change)="toggle(key, $any($event.target).checked)"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium text-text-primary truncate">
                      {{ row.name }}
                      @if (row.variant_name) {
                        <span class="text-text-secondary">· {{ row.variant_name }}</span>
                      }
                    </p>
                    <p class="text-xs text-text-secondary truncate">
                      SKU: {{ row.sku || 'Sin SKU' }}
                      @if (added) {
                        <span class="ml-1 text-primary font-medium">· Ya agregado</span>
                      } @else if (noStock) {
                        <span class="ml-1 text-error">· Sin disponible en origen</span>
                      }
                    </p>
                  </div>
                  <div class="text-right shrink-0">
                    <p class="text-xs font-semibold" [class.text-error]="noStock" [class.text-text-primary]="!noStock">
                      Origen: {{ row.stock_at_origin.quantity_available }}
                    </p>
                    @if (requireDestination()) {
                      <p class="text-xs text-text-secondary">
                        Destino: {{ row.stock_at_destination.quantity_available }}
                      </p>
                    }
                  </div>
                </label>
              </li>
            }
          </ul>
        </div>
      }
    </div>
  `,
})
export class TransferProductPickerComponent {
  private readonly destroyRef = inject(DestroyRef);

  readonly fromLocationId = input<number | null>(null);
  readonly toLocationId = input<number | null>(null);
  readonly searchFn = input.required<TransferProductSearchFn>();
  /** Claves producto+variante ya presentes en la orden. */
  readonly addedKeys = input<string[]>([]);
  /**
   * D8 — en una salida a destino externo no hay bodega de destino: la vista
   * avanzada apaga este requisito y busca solo con el origen.
   */
  readonly requireDestination = input(true);

  readonly add = output<TransferPickerRow[]>();

  readonly minChars = 2;
  readonly term = signal('');
  readonly results = signal<TransferPickerRow[]>([]);
  readonly searching = signal(false);
  readonly error = signal<string | null>(null);
  readonly selectedKeys = signal<ReadonlySet<string>>(new Set());

  private searchSub: Subscription | null = null;

  readonly ready = computed(() => {
    const from = this.fromLocationId();
    if (!this.requireDestination()) return !!from;
    const to = this.toLocationId();
    return !!from && !!to && from !== to;
  });

  private readonly addedSet = computed(() => new Set(this.addedKeys()));

  readonly selectableRows = computed(() =>
    this.results().filter(
      (row) =>
        row.stock_at_origin.quantity_available > 0 &&
        !this.addedSet().has(pickerRowKey(row)),
    ),
  );

  readonly selectedCount = computed(() => {
    const selected = this.selectedKeys();
    return this.selectableRows().filter((row) => selected.has(pickerRowKey(row)))
      .length;
  });

  readonly allSelectableChecked = computed(() => {
    const rows = this.selectableRows();
    return rows.length > 0 && this.selectedCount() === rows.length;
  });

  constructor() {
    // Cambiar de bodega invalida los resultados: el disponible es otro.
    effect(() => {
      this.fromLocationId();
      this.toLocationId();
      untracked(() => {
        this.searchSub?.unsubscribe();
        this.results.set([]);
        this.selectedKeys.set(new Set());
        this.searching.set(false);
        this.error.set(null);
        const term = this.term();
        if (this.ready() && term.length >= this.minChars) {
          this.runSearch(term);
        }
      });
    });
    this.destroyRef.onDestroy(() => this.searchSub?.unsubscribe());
  }

  rowKey(row: TransferPickerRow): string {
    return pickerRowKey(row);
  }

  isAdded(key: string): boolean {
    return this.addedSet().has(key);
  }

  isSelected(key: string): boolean {
    return this.selectedKeys().has(key);
  }

  onSearch(raw: string): void {
    const term = (raw ?? '').trim();
    this.term.set(term);
    this.searchSub?.unsubscribe();
    this.error.set(null);
    if (!this.ready() || term.length < this.minChars) {
      this.results.set([]);
      this.selectedKeys.set(new Set());
      this.searching.set(false);
      return;
    }
    this.runSearch(term);
  }

  toggle(key: string, checked: boolean): void {
    this.selectedKeys.update((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  toggleAll(checked: boolean): void {
    this.selectedKeys.set(
      checked
        ? new Set(this.selectableRows().map((row) => pickerRowKey(row)))
        : new Set(),
    );
  }

  /**
   * Emite las filas marcadas y limpia SOLO la selección: el término y los
   * resultados se quedan para seguir agregando.
   */
  addSelected(): void {
    const selected = this.selectedKeys();
    const rows = this.selectableRows().filter((row) =>
      selected.has(pickerRowKey(row)),
    );
    if (rows.length === 0) return;
    this.add.emit(rows);
    this.selectedKeys.set(new Set());
  }

  private runSearch(term: string): void {
    const from = this.fromLocationId();
    // Sin destino (salida externa) el endpoint igual pide uno: se consulta
    // con el origen y el disponible en destino no se muestra.
    const to =
      this.toLocationId() ?? (this.requireDestination() ? null : from);
    if (!from || !to) return;
    this.searching.set(true);
    this.searchSub = this.searchFn()(term, from, to)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.searching.set(false);
          this.results.set(Array.isArray(rows) ? rows : []);
          // Conserva solo la selección que sigue visible.
          const visible = new Set(this.results().map((r) => pickerRowKey(r)));
          this.selectedKeys.update(
            (current) => new Set([...current].filter((k) => visible.has(k))),
          );
        },
        error: () => {
          this.searching.set(false);
          this.results.set([]);
          this.error.set('No se pudo buscar productos. Intenta de nuevo.');
        },
      });
  }
}
