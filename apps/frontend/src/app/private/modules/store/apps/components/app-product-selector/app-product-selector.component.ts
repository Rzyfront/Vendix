import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, forkJoin, merge, of } from 'rxjs';
import { catchError, debounceTime, map, switchMap, tap } from 'rxjs/operators';

import { IconComponent, ModalComponent, SpinnerComponent } from '../../../../../../shared/components';
import { CurrencyFormatService, CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { AppPageProductItem, mapAdminProductToItem } from '../../../../../../public/app-page/app-page-products.util';
import { Product, ProductState } from '../../../products/interfaces/product.interface';
import { ProductsService } from '../../../products/services/products.service';
import { MAX_BLOCK_PRODUCT_IDS } from '../../templates/app-page.types';

interface SelectedChipView {
  id: number;
  name: string;
  sku: string | null;
  imageUrl: string | null;
}

const STATE_LABELS: Record<string, { label: string; tone: string }> = {
  [ProductState.ACTIVE]: {
    label: 'Activo',
    tone: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
  },
  [ProductState.INACTIVE]: {
    label: 'Inactivo',
    tone: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
  },
  [ProductState.ARCHIVED]: {
    label: 'Archivado',
    tone: 'bg-slate-500/10 text-slate-600 border-slate-500/20',
  },
};

/**
 * Selector avanzado de productos para bloques `products` del editor de apps.
 *
 * Muestra chips removibles y reordenables en el inspector, y abre un modal
 * accesible (`app-modal`) con búsqueda por nombre o SKU, miniatura, precio,
 * estado y multiselección respetando el orden y el tope máximo (50).
 */
@Component({
  selector: 'app-product-selector',
  standalone: true,
  imports: [IconComponent, ModalComponent, SpinnerComponent, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-2.5" [attr.data-currency]="currencyCode()" data-testid="app-product-selector">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs font-semibold text-[var(--color-text-primary)]">{{ label() }}</span>
        <span class="text-[11px] text-[var(--color-text-secondary)]" data-testid="product-selector-count">
          {{ selectedIds().length }} / {{ max() }}
        </span>
      </div>

      @if (chips().length > 0) {
        <ul class="space-y-1.5" role="list" [attr.aria-label]="label()" data-testid="product-selector-chips">
          @for (chip of chips(); track chip.id; let i = $index; let first = $first; let last = $last) {
            <li
              class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs"
              [attr.data-testid]="'product-selector-chip-' + chip.id"
            >
              <span class="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded bg-[var(--color-background)] text-[var(--color-text-secondary)]">
                @if (chip.imageUrl) {
                  <img [src]="chip.imageUrl" alt="" class="h-full w-full object-cover" loading="lazy" />
                } @else {
                  <app-icon name="package" [size]="14" />
                }
              </span>
              <span class="min-w-0 flex-1 truncate font-medium text-[var(--color-text-primary)]">
                {{ chip.name }}
              </span>
              <div class="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  class="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] disabled:opacity-30"
                  [disabled]="first"
                  [attr.aria-label]="'Subir ' + chip.name"
                  [attr.data-testid]="'product-selector-up-' + chip.id"
                  (click)="moveChip(i, i - 1)"
                >
                  <app-icon name="chevron-up" [size]="12" />
                </button>
                <button
                  type="button"
                  class="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] disabled:opacity-30"
                  [disabled]="last"
                  [attr.aria-label]="'Bajar ' + chip.name"
                  [attr.data-testid]="'product-selector-down-' + chip.id"
                  (click)="moveChip(i, i + 1)"
                >
                  <app-icon name="chevron-down" [size]="12" />
                </button>
                <button
                  type="button"
                  class="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] hover:text-[var(--color-error,#dc2626)]"
                  [attr.aria-label]="'Quitar ' + chip.name"
                  [attr.data-testid]="'product-selector-remove-' + chip.id"
                  (click)="removeChip(chip.id)"
                >
                  <app-icon name="x" [size]="12" />
                </button>
              </div>
            </li>
          }
        </ul>
      } @else {
        <p class="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-secondary)]" data-testid="product-selector-empty">
          Aún no has elegido productos para esta sección.
        </p>
      }

      <button
        #openBtn
        type="button"
        class="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-primary)] hover:bg-[var(--color-background)]"
        aria-haspopup="dialog"
        data-testid="product-selector-open"
        (click)="openModal()"
      >
        <app-icon name="search" [size]="14" />
        {{ selectedIds().length > 0 ? 'Editar selección de productos' : 'Elegir productos' }}
      </button>
    </div>

    @if (modalOpen()) {
      <app-modal
        [isOpen]="true"
        title="Seleccionar productos"
        subtitle="Busca por nombre o SKU y elige los productos en el orden que prefieras."
        size="lg"
        [dialog]="true"
        [closeOnEscape]="true"
        (opened)="onModalOpened()"
        (cancel)="closeModal()"
        (isOpenChange)="onModalOpenChange($event)"
      >
        <div class="space-y-3" data-testid="product-selector-modal">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <label class="relative block min-w-0 flex-1">
              <app-icon
                name="search"
                [size]="14"
                class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]"
              />
              <input
                #searchInput
                type="search"
                class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm text-[var(--color-text-primary)]"
                placeholder="Buscar por nombre o SKU…"
                aria-label="Buscar productos por nombre o SKU"
                data-testid="product-selector-search"
                [value]="search()"
                (input)="onSearch($any($event.target).value)"
              />
            </label>
            <span class="shrink-0 text-xs font-medium text-[var(--color-text-secondary)]" data-testid="product-selector-modal-count">
              {{ draftIds().length }} / {{ max() }} seleccionados
            </span>
          </div>

          @if (isLimitReached()) {
            <p class="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800" role="status" data-testid="product-selector-limit-notice">
              Alcanzaste el máximo de {{ max() }} productos para esta sección. Quita alguno para elegir otro.
            </p>
          }

          @if (loading() && results().length === 0) {
            <div class="flex items-center justify-center py-10">
              <app-spinner size="md" color="primary" />
            </div>
          } @else if (results().length === 0) {
            <div class="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-[var(--color-text-secondary)]" data-testid="product-selector-no-results">
              <app-icon name="package" [size]="24" />
              <p>No encontramos productos que coincidan con tu búsqueda.</p>
            </div>
          } @else {
            <ul
              class="max-h-96 divide-y divide-[var(--color-border)] overflow-y-auto rounded-xl border border-[var(--color-border)]"
              role="listbox"
              aria-multiselectable="true"
              aria-label="Resultados de productos"
              data-testid="product-selector-results"
            >
              @for (product of results(); track product.id) {
                @let selected = isDraftSelected(product.id);
                @let disabled = !selected && isLimitReached();
                @let order = draftOrderOf(product.id);
                @let status = statusOf(product);
                <li>
                  <button
                    type="button"
                    role="option"
                    class="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-background)] disabled:cursor-not-allowed disabled:opacity-50"
                    [class.bg-[var(--color-primary)]/5]="selected"
                    [attr.aria-selected]="selected"
                    [disabled]="disabled"
                    [attr.data-testid]="'product-selector-option-' + product.id"
                    (click)="toggleDraft(product)"
                  >
                    <span
                      class="flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] font-bold"
                      [class]="selected
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)] text-transparent'"
                      aria-hidden="true"
                    >
                      @if (order !== null) {
                        {{ order }}
                      }
                    </span>

                    <span class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-text-secondary)]">
                      @if (thumbOf(product); as src) {
                        <img [src]="src" alt="" class="h-full w-full object-cover" loading="lazy" />
                      } @else {
                        <app-icon name="package" [size]="16" />
                      }
                    </span>

                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium text-[var(--color-text-primary)]">
                        {{ product.name }}
                      </span>
                      <span class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--color-text-secondary)]">
                        @if (product.sku) {
                          <span data-testid="product-selector-sku">SKU: {{ product.sku }}</span>
                        }
                        @if (variantCountOf(product) > 0) {
                          <span>{{ variantCountOf(product) }} variantes</span>
                        }
                        @if (product.available_for_ecommerce === false) {
                          <span>No publicado en línea</span>
                        }
                      </span>
                    </span>

                    <span class="flex shrink-0 flex-col items-end gap-1">
                      <span class="text-sm font-semibold text-[var(--color-text-primary)]" data-testid="product-selector-price">
                        {{ priceOf(product) | currency }}
                      </span>
                      <span
                        class="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                        [class]="status.tone"
                        data-testid="product-selector-status"
                      >
                        {{ status.label }}
                      </span>
                    </span>
                  </button>
                </li>
              }
            </ul>
          }
        </div>

        <div slot="footer" class="flex w-full items-center justify-between gap-2">
          <span class="text-xs text-[var(--color-text-secondary)]">
            {{ draftIds().length }} producto(s) en orden
          </span>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="h-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)]"
              data-testid="product-selector-cancel"
              (click)="closeModal()"
            >
              Cancelar
            </button>
            <button
              type="button"
              class="h-10 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-white hover:opacity-95"
              data-testid="product-selector-apply"
              (click)="applySelection()"
            >
              Aplicar selección
            </button>
          </div>
        </div>
      </app-modal>
    }
  `,
})
export class AppProductSelectorComponent {
  private readonly productsService = inject(ProductsService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly selectedIds = input<readonly number[]>([]);
  readonly max = input(MAX_BLOCK_PRODUCT_IDS);
  readonly label = input('Productos elegidos');
  readonly excludeServices = input(false);

  /** Emite la lista ordenada de IDs elegidos (máximo `max()`). */
  readonly selectedIdsChange = output<number[]>();
  /** Emite los datos hidratados de productos conocidos para refrescar la vista previa al instante. */
  readonly productsResolved = output<AppPageProductItem[]>();

  protected readonly currencyCode = this.currencyService.currencyCode;

  readonly modalOpen = signal(false);
  readonly search = signal('');
  readonly loading = signal(false);
  readonly results = signal<Product[]>([]);
  readonly draftIds = signal<number[]>([]);
  readonly catalogById = signal<ReadonlyMap<number, Product>>(new Map());

  private readonly openButton = viewChild<ElementRef<HTMLButtonElement>>('openBtn');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  private readonly debouncedSearch$ = new Subject<string>();
  private readonly immediateSearch$ = new Subject<string>();
  private readonly inFlightHydrate = new Set<number>();
  private focusTimer: ReturnType<typeof setTimeout> | null = null;

  readonly isLimitReached = computed(() => this.draftIds().length >= this.max());

  readonly chips = computed<SelectedChipView[]>(() => {
    const cache = this.catalogById();
    return this.selectedIds().map((id) => {
      const found = cache.get(id);
      return {
        id,
        name: found?.name ?? `Producto #${id}`,
        sku: found?.sku ?? null,
        imageUrl: found ? this.thumbOf(found) : null,
      };
    });
  });

  constructor() {
    this.currencyService.loadCurrency();

    // Una sola tubería reactiva para búsqueda (carga inicial inmediata + escritura con debounce).
    merge(this.immediateSearch$, this.debouncedSearch$.pipe(debounceTime(200)))
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap((term) =>
          this.productsService
            .getProducts({
              search: term.trim() || undefined,
              limit: 25,
              include_variants: true,
            })
            .pipe(
              map((res) => {
                const list = res?.data ?? [];
                return this.excludeServices()
                  ? list.filter((p) => p.product_type !== 'service')
                  : list;
              }),
              catchError(() => of([] as Product[])),
            ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((products) => {
        this.results.set(products);
        this.rememberProducts(products);
        this.loading.set(false);
      });

    // Hidrata los nombres, miniaturas y variantes de IDs ya guardados en el bloque.
    effect(() => {
      const ids = this.selectedIds();
      const cache = untracked(() => this.catalogById());
      const missing = ids.filter((id) => !cache.has(id) && !this.inFlightHydrate.has(id));
      if (missing.length === 0) return;

      for (const id of missing) this.inFlightHydrate.add(id);
      forkJoin(
        missing.map((id) =>
          this.productsService.getProductById(id).pipe(catchError(() => of(null))),
        ),
      )
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((rows) => {
          for (const id of missing) this.inFlightHydrate.delete(id);
          const valid = rows.filter((p): p is Product => !!p);
          if (valid.length > 0) this.rememberProducts(valid);
        });
    });

    this.destroyRef.onDestroy(() => this.clearFocusTimer());
  }

  openModal(): void {
    this.draftIds.set(this.sanitizeIds(this.selectedIds()));
    this.modalOpen.set(true);
    this.immediateSearch$.next(this.search());
  }

  /** Mueve el foco al buscador tras el enfoque inicial del diálogo en `app-modal`. */
  onModalOpened(): void {
    this.clearFocusTimer();
    this.focusTimer = setTimeout(() => {
      this.focusTimer = null;
      if (this.modalOpen()) {
        this.searchInput()?.nativeElement.focus();
      }
    }, 0);
  }

  closeModal(): void {
    if (!this.modalOpen()) return;
    this.clearFocusTimer();
    this.modalOpen.set(false);
    this.restoreFocus();
  }

  onModalOpenChange(open: boolean): void {
    if (!open) {
      this.closeModal();
    }
  }

  onSearch(term: string): void {
    this.search.set(term);
    this.debouncedSearch$.next(term);
  }

  isDraftSelected(id: number): boolean {
    return this.draftIds().includes(id);
  }

  draftOrderOf(id: number): number | null {
    const idx = this.draftIds().indexOf(id);
    return idx >= 0 ? idx + 1 : null;
  }

  toggleDraft(product: Product): void {
    const current = this.draftIds();
    if (current.includes(product.id)) {
      this.draftIds.set(current.filter((id) => id !== product.id));
      return;
    }
    if (current.length >= this.max()) return;
    this.rememberProducts([product]);
    this.draftIds.set([...current, product.id]);
  }

  applySelection(): void {
    const next = this.sanitizeIds(this.draftIds());
    this.modalOpen.set(false);
    this.selectedIdsChange.emit(next);
    this.emitResolved();
    this.restoreFocus();
  }

  removeChip(id: number): void {
    const next = this.selectedIds().filter((item) => item !== id);
    this.selectedIdsChange.emit(next);
  }

  moveChip(from: number, to: number): void {
    const list = [...this.selectedIds()];
    if (to < 0 || to >= list.length || from === to) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    this.selectedIdsChange.emit(list);
  }

  thumbOf(product: Product): string | null {
    return (
      product.image_url ??
      product.product_images?.[0]?.image_url ??
      product.images?.[0]?.image_url ??
      null
    );
  }

  priceOf(product: Product): number {
    if (typeof product.final_price === 'number' && Number.isFinite(product.final_price)) {
      return product.final_price;
    }
    if (product.is_on_sale && typeof product.sale_price === 'number' && product.sale_price > 0) {
      return product.sale_price;
    }
    return Number(product.base_price ?? 0);
  }

  variantCountOf(product: Product): number {
    return (product.variants ?? product.product_variants ?? []).length;
  }

  statusOf(product: Product): { label: string; tone: string } {
    return (
      STATE_LABELS[product.state] ?? {
        label: String(product.state ?? 'Activo'),
        tone: 'bg-slate-500/10 text-slate-600 border-slate-500/20',
      }
    );
  }

  private rememberProducts(list: Product[]): void {
    if (list.length === 0) return;
    const next = new Map(this.catalogById());
    for (const p of list) {
      if (p && typeof p.id === 'number') next.set(p.id, p);
    }
    this.catalogById.set(next);
    this.emitResolved();
  }

  private emitResolved(): void {
    const items = Array.from(this.catalogById().values()).map(mapAdminProductToItem);
    if (items.length > 0) {
      this.productsResolved.emit(items);
    }
  }

  private sanitizeIds(ids: readonly number[]): number[] {
    const seen = new Set<number>();
    const out: number[] = [];
    const cap = this.max();
    for (const id of ids) {
      if (out.length >= cap) break;
      if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  private clearFocusTimer(): void {
    if (this.focusTimer !== null) {
      clearTimeout(this.focusTimer);
      this.focusTimer = null;
    }
  }

  private restoreFocus(): void {
    this.openButton()?.nativeElement.focus();
  }
}
