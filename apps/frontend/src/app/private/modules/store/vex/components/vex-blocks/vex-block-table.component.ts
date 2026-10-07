import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import {
  VexBlockInteraction,
  VexBlockTabularData,
  VexTableSpec,
  VexUiBlock,
} from '../../models/vex.models';

type SortDir = 'asc' | 'desc';

interface IndexedRow {
  index: number;
  row: Record<string, unknown>;
}

// Pagination exception: a block payload is already in memory and bounded
// server-side (5000 rows cap), so paging, sorting and filtering run locally.
// This is an embedded AI artifact, not a module list over a queryable store.
@Component({
  selector: 'vendix-vex-block-table',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden"
      [attr.aria-label]="spec().title || 'Tabla de Vex'"
    >
      @if (spec().title) {
        <header class="px-4 pt-3 pb-1">
          <h4 class="text-sm font-semibold text-[var(--color-text-primary)]">
            {{ spec().title }}
          </h4>
        </header>
      }

      <div class="px-4 py-2 flex items-center gap-2">
        <div
          class="flex-1 flex items-center gap-2 min-h-10 px-3 rounded-xl border border-[var(--color-border)] text-[var(--color-text-secondary)]"
        >
          <app-icon name="search" [size]="16"></app-icon>
          <input
            type="text"
            class="flex-1 min-w-0 bg-transparent outline-none text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
            placeholder="Filtrar filas"
            aria-label="Filtrar filas de la tabla"
            [value]="filter()"
            (input)="onFilter($event)"
          />
          @if (filter()) {
            <button
              type="button"
              class="w-8 h-8 flex items-center justify-center rounded-lg hover:text-[var(--color-text-primary)]"
              aria-label="Limpiar filtro"
              (click)="clearFilter()"
            >
              <app-icon name="x" [size]="16"></app-icon>
            </button>
          }
        </div>
      </div>

      @if (selected_count() > 0) {
        <p class="px-4 pb-1 text-xs text-[var(--color-text-secondary)]" role="status">
          {{ selected_count() }} fila(s) seleccionada(s) — se enviarán a Vex con tu próximo mensaje.
          <button
            type="button"
            class="underline underline-offset-2 hover:text-[var(--color-text-primary)]"
            (click)="clearSelection()"
          >
            Limpiar
          </button>
        </p>
      }

      <div class="overflow-x-auto">
        <table class="w-full text-sm border-collapse min-w-[480px]">
          <thead>
            <tr class="border-y border-[var(--color-border)] bg-[rgba(var(--color-text-primary-rgb,0,0,0),0.04)]">
              @if (selectable()) {
                <th class="w-10 px-3 py-2" scope="col">
                  <input
                    type="checkbox"
                    class="w-4 h-4 accent-[var(--color-primary)]"
                    aria-label="Seleccionar filas visibles"
                    [checked]="all_visible_selected()"
                    [indeterminate]="some_visible_selected()"
                    (change)="toggleAllVisible()"
                  />
                </th>
              }
              @for (column of spec().columns; track column.key) {
                <th
                  scope="col"
                  class="px-3 py-2 font-semibold text-[var(--color-text-primary)] whitespace-nowrap"
                  [class.text-left]="(column.align ?? 'left') === 'left'"
                  [class.text-right]="column.align === 'right'"
                  [class.text-center]="column.align === 'center'"
                >
                  @if (column.sortable !== false) {
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 min-h-10 hover:text-[var(--color-primary)]"
                      [attr.aria-label]="'Ordenar por ' + column.label"
                      (click)="toggleSort(column.key)"
                    >
                      {{ column.label }}
                      @if (sort_key() === column.key) {
                        <app-icon
                          [name]="sort_dir() === 'asc' ? 'arrow-up' : 'arrow-down'"
                          [size]="14"
                        ></app-icon>
                      }
                    </button>
                  } @else {
                    {{ column.label }}
                  }
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @for (item of page_rows(); track item.index) {
              <tr
                class="border-b border-[var(--color-border)] last:border-0 hover:bg-[rgba(var(--color-primary-rgb,46,204,113),0.05)]"
                [class.bg-[rgba(var(--color-primary-rgb,46,204,113),0.08)]]="isSelected(item.index)"
              >
                @if (selectable()) {
                  <td class="px-3 py-2">
                    <input
                      type="checkbox"
                      class="w-4 h-4 accent-[var(--color-primary)]"
                      [attr.aria-label]="'Seleccionar fila ' + (item.index + 1)"
                      [checked]="isSelected(item.index)"
                      (change)="toggleRow(item.index)"
                    />
                  </td>
                }
                @for (column of spec().columns; track column.key) {
                  <td
                    class="px-3 py-2 text-[var(--color-text-primary)] whitespace-nowrap"
                    [class.text-left]="(column.align ?? 'left') === 'left'"
                    [class.text-right]="column.align === 'right'"
                    [class.text-center]="column.align === 'center'"
                  >
                    {{ formatCell(column.type ?? 'text', item.row[column.key]) }}
                  </td>
                }
              </tr>
            } @empty {
              <tr>
                <td
                  class="px-3 py-6 text-center text-[var(--color-text-secondary)]"
                  [attr.colspan]="spec().columns.length + (selectable() ? 1 : 0)"
                >
                  Sin filas para mostrar
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="px-4 py-2 flex items-center justify-between gap-2 text-xs text-[var(--color-text-secondary)]">
        <span>{{ total_rows() }} fila(s)</span>
        @if (total_pages() > 1) {
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="min-w-10 min-h-10 px-2 rounded-lg border border-[var(--color-border)] disabled:opacity-40"
              aria-label="Página anterior"
              [disabled]="page() <= 1"
              (click)="goTo(page() - 1)"
            >
              ‹
            </button>
            <span class="px-2" aria-live="polite">
              {{ page() }} / {{ total_pages() }}
            </span>
            <button
              type="button"
              class="min-w-10 min-h-10 px-2 rounded-lg border border-[var(--color-border)] disabled:opacity-40"
              aria-label="Página siguiente"
              [disabled]="page() >= total_pages()"
              (click)="goTo(page() + 1)"
            >
              ›
            </button>
          </div>
        }
      </div>
    </section>
  `,
})
export class VexBlockTableComponent {
  private readonly currencyFormat = inject(CurrencyFormatService);
  private readonly auth = inject(AuthFacade);

  readonly block = input.required<VexUiBlock>();
  readonly interaction = output<VexBlockInteraction>();

  readonly filter = signal('');
  readonly sort_key = signal<string | null>(null);
  readonly sort_dir = signal<SortDir>('asc');
  readonly page = signal(1);
  private readonly selected = signal<ReadonlySet<number>>(new Set());

  readonly spec = computed(() => this.block().spec as VexTableSpec);
  readonly selectable = computed(() => this.spec().selectable !== false);
  readonly selected_count = computed(() => this.selected().size);

  private readonly rows = computed<IndexedRow[]>(() => {
    const data = this.block().data as Partial<VexBlockTabularData>;
    const raw = Array.isArray(data.rows) ? data.rows : [];
    return raw.map((row, index) => ({ index, row }));
  });

  private readonly filtered = computed<IndexedRow[]>(() => {
    const term = this.filter().trim().toLowerCase();
    const all = this.rows();
    if (!term) return all;
    return all.filter(({ row }) =>
      Object.values(row).some((value) =>
        String(value ?? '').toLowerCase().includes(term),
      ),
    );
  });

  private readonly sorted = computed<IndexedRow[]>(() => {
    const key = this.sort_key();
    const items = [...this.filtered()];
    if (!key) return items;
    const dir = this.sort_dir() === 'asc' ? 1 : -1;
    const locale = this.date_locale();
    return items.sort((a, b) => compareValues(a.row[key], b.row[key], locale) * dir);
  });

  readonly total_rows = computed(() => this.sorted().length);

  private readonly page_size = computed(() => {
    const raw = this.spec().page_size ?? 10;
    return Math.min(50, Math.max(5, raw));
  });

  readonly total_pages = computed(() =>
    Math.max(1, Math.ceil(this.total_rows() / this.page_size())),
  );

  readonly page_rows = computed<IndexedRow[]>(() => {
    const size = this.page_size();
    const start = (Math.min(this.page(), this.total_pages()) - 1) * size;
    return this.sorted().slice(start, start + size);
  });

  readonly all_visible_selected = computed(() => {
    const visible = this.page_rows();
    return visible.length > 0 && visible.every((item) => this.selected().has(item.index));
  });

  readonly some_visible_selected = computed(() => {
    const visible = this.page_rows();
    const count = visible.filter((item) => this.selected().has(item.index)).length;
    return count > 0 && count < visible.length;
  });

  private readonly timezone = computed(() => {
    const settings = this.auth.storeSettings() as {
      general?: { timezone?: string };
    } | null;
    return settings?.general?.timezone || 'America/Bogota';
  });

  /**
   * Number/date locale from the STORE, never a hardcoded `es-CO`: once the
   * currency resolves, grouping follows the store's `format_style` (same
   * mapping `CurrencyFormatService` uses); before that, `general.language`.
   */
  private readonly number_locale = computed(() => {
    const settings = this.auth.storeSettings() as {
      general?: { language?: string };
    } | null;
    return storeNumberLocale(
      settings?.general?.language,
      this.currencyFormat.currencyFormatStyle(),
      this.currencyFormat.resolution() === 'resolved',
    );
  });

  /**
   * Linguistic locale (month names, collation) from `general.language` only:
   * the grouping locales above (`de-DE`/`fr-FR`) would render month
   * abbreviations in the wrong language.
   */
  private readonly date_locale = computed(() => {
    const settings = this.auth.storeSettings() as {
      general?: { language?: string };
    } | null;
    return settings?.general?.language === 'en' ? 'en-US' : 'es-CO';
  });

  constructor() {
    void this.currencyFormat.loadCurrency();
    // A new block version resets local view state; the selection belongs to
    // the old rows and must not leak into the new ones.
    effect(() => {
      this.block();
      this.page.set(1);
      this.selected.set(new Set());
    });
  }

  isSelected(index: number): boolean {
    return this.selected().has(index);
  }

  onFilter(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
    this.page.set(1);
  }

  clearFilter(): void {
    this.filter.set('');
    this.page.set(1);
  }

  toggleSort(key: string): void {
    if (this.sort_key() !== key) {
      this.sort_key.set(key);
      this.sort_dir.set('asc');
    } else {
      this.sort_dir.update((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    }
    this.page.set(1);
  }

  goTo(page: number): void {
    this.page.set(Math.min(this.total_pages(), Math.max(1, page)));
  }

  toggleRow(index: number): void {
    this.selected.update((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
    this.emitSelection();
  }

  toggleAllVisible(): void {
    const visible = this.page_rows().map((item) => item.index);
    this.selected.update((previous) => {
      const next = new Set(previous);
      if (visible.every((index) => next.has(index))) {
        visible.forEach((index) => next.delete(index));
      } else {
        visible.forEach((index) => next.add(index));
      }
      return next;
    });
    this.emitSelection();
  }

  clearSelection(): void {
    this.selected.set(new Set());
    this.emitSelection();
  }

  formatCell(type: string, value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value))
          ? Number(value)
          : null;
    switch (type) {
      case 'currency':
        return numeric !== null
          ? this.currencyFormat.format(numeric)
          : String(value);
      case 'number':
        return numeric !== null
          ? numeric.toLocaleString(this.number_locale(), { maximumFractionDigits: 4 })
          : String(value);
      case 'date':
        return typeof value === 'string' ? formatDateOnlyUTC(value) : String(value);
      case 'datetime': {
        const parsed = value instanceof Date ? value : new Date(String(value));
        if (isNaN(parsed.getTime())) return String(value);
        return parsed.toLocaleString(this.date_locale(), {
          timeZone: this.timezone(),
          hourCycle: 'h23',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      }
      default:
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
  }

  private emitSelection(): void {
    const selected = this.selected();
    const selection = this.rows()
      .filter(({ index }) => selected.has(index))
      .map(({ row }) => row);
    this.interaction.emit({ type: 'row_select', selection });
  }
}

function compareValues(a: unknown, b: unknown, locale: string): number {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return 1;
  if (b === null || b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), locale, { numeric: true });
}

/**
 * Store-driven `Intl` locale for plain numbers. Mirrors the service-private
 * `getLocaleForStyle` mapping so grouping matches the store's money; the
 * language fallback keeps pre-resolution renders stable (`es-CO` groups like
 * `de-DE`, so the default COP tenant sees no flip when it resolves).
 */
function storeNumberLocale(
  language: string | undefined,
  format_style: string,
  resolved: boolean,
): string {
  if (resolved) {
    switch (format_style) {
      case 'dot_comma':
        return 'de-DE';
      case 'space_comma':
        return 'fr-FR';
      default:
        return 'en-US';
    }
  }
  return language === 'en' ? 'en-US' : 'es-CO';
}
