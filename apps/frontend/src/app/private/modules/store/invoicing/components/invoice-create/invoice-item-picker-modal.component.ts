import {
  ChangeDetectionStrategy,
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
import { Subject, of } from 'rxjs';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  switchMap,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import {
  InvoiceProductLookupService,
  InvoiceProductOption,
} from '../../services/invoice-product-lookup.service';

/** Debounce del buscador. Mismo valor que `app-store-user-select`. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * SELECTOR DE ÍTEM DE FACTURA — INVENTARIO REAL O ÍTEM PERSONALIZADO.
 *
 * ─── POR QUÉ NO ES `app-product-picker-modal` ───────────────────────────────
 *
 * El picker compartido recibe TODO el universo de productos por input y filtra
 * en el navegador. Eso obliga al padre a precargarlo entero, que es justo lo que
 * hacía que el producto 201 de una tienda fuera infacturable. Aquí el buscador
 * es del componente y pega al servidor en cada término, así que el universo es
 * el inventario completo y no una página.
 *
 * Además esa pieza es de otro dueño y la consumen las cartas de restaurante:
 * cambiarle el contrato para esta pantalla arrastraría un módulo que no está en
 * juego.
 *
 * ─── LAS DOS SALIDAS ────────────────────────────────────────────────────────
 *
 * `productPicked` — una fila real de `products`, con su `id` y su precio base.
 * `customRequested` — el usuario declara que lo que va a facturar NO está en el
 * inventario y no quiere crearlo allí. Eso abre la configuración avanzada; el
 * inventario no se toca, que es exactamente lo que pidió el comerciante: «un
 * producto personalizado… y que la factura también se permita emitir con este
 * producto personalizado».
 */
@Component({
  selector: 'vendix-invoice-item-picker-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="open()"
      size="lg"
      title="Agregar ítem a la factura"
      subtitle="Busca en tu inventario (productos y servicios) o crea un ítem personalizado"
      (cancel)="close()"
    >
      <div class="flex flex-col gap-4">
        <div class="relative">
          <span
            class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--color-text-secondary)]"
          >
            <app-icon name="search" [size]="16" />
          </span>
          <input
            #searchInput
            type="text"
            autocomplete="off"
            placeholder="Nombre, SKU o categoría..."
            class="w-full h-11 pl-9 pr-3 rounded-xl border border-border bg-[var(--color-background)] text-text-primary placeholder:text-[var(--color-text-muted)] focus:outline-none focus:bg-[var(--color-surface)] focus:shadow-[0_0_0_2px_var(--color-ring)] transition-colors"
            [value]="query()"
            (input)="onQuery($event)"
          />
        </div>

        @if (loading()) {
          <div
            class="flex items-center justify-center gap-2 py-12 text-[var(--color-text-secondary)]"
          >
            <app-icon name="loader-2" [size]="20" [spin]="true" />
            <span class="text-sm">Buscando en el inventario…</span>
          </div>
        } @else if (results().length === 0) {
          <div
            class="flex flex-col items-center justify-center gap-3 py-10 text-center"
          >
            <app-icon
              name="package-search"
              [size]="28"
              class="text-[var(--color-text-secondary)]"
            />
            <p class="text-sm text-[var(--color-text-secondary)] max-w-sm">
              @if (query().trim()) {
                Ningún producto ni servicio de tu inventario coincide con
                «{{ query().trim() }}».
              } @else {
                Tu inventario no devolvió resultados.
              }
              Puedes facturarlo igual como ítem personalizado: no se crea nada en
              el inventario.
            </p>
            <app-button variant="primary" size="sm" (clicked)="requestCustom()">
              <app-icon slot="icon" name="sparkles" [size]="14" />
              Crear ítem personalizado
            </app-button>
          </div>
        } @else {
          <div
            class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[52vh] overflow-y-auto pr-1"
          >
            @for (product of results(); track product.id) {
              <button
                type="button"
                class="flex items-center gap-3 p-2.5 rounded-xl border text-left transition-colors hover:border-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
                [class.border-border]="!isAlreadyUsed(product.id)"
                [class.border-success]="isAlreadyUsed(product.id)"
                [disabled]="isAlreadyUsed(product.id)"
                (click)="pick(product)"
              >
                <div
                  class="w-11 h-11 rounded-md overflow-hidden shrink-0 flex items-center justify-center bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)]"
                >
                  @if (product.imageUrl && !hasImageFailed(product.id)) {
                    <img
                      [src]="product.imageUrl"
                      [alt]="product.name"
                      class="w-full h-full object-cover"
                      (error)="onImageError(product.id)"
                    />
                  } @else {
                    <app-icon
                      [name]="
                        product.productType === 'service' ? 'briefcase' : 'package'
                      "
                      [size]="18"
                    />
                  }
                </div>

                <div class="min-w-0 flex-1">
                  <span
                    class="block truncate text-sm font-medium text-text-primary"
                  >
                    {{ product.name }}
                  </span>
                  <span
                    class="block truncate text-xs text-[var(--color-text-secondary)]"
                  >
                    {{ subtitleFor(product) }}
                  </span>
                </div>

                <div class="shrink-0 text-right">
                  <span class="block text-sm font-semibold text-text-primary">
                    {{ formatCurrency(product.basePrice) }}
                  </span>
                  @if (isAlreadyUsed(product.id)) {
                    <span class="block text-[10px] font-semibold text-success">
                      Ya está en la factura
                    </span>
                  }
                </div>
              </button>
            }
          </div>
        }
      </div>

      <div slot="footer" class="flex items-center justify-between gap-3 flex-wrap">
        <app-button variant="outline" size="sm" (clicked)="requestCustom()">
          <app-icon slot="icon" name="sparkles" [size]="14" />
          Crear ítem personalizado
        </app-button>
        <app-button variant="ghost" (clicked)="close()">Cancelar</app-button>
      </div>
    </app-modal>
  `,
})
export class InvoiceItemPickerModalComponent {
  private readonly lookup = inject(InvoiceProductLookupService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = input<boolean>(false);
  /** Ids ya usados en otras líneas: se muestran, pero no se pueden repetir. */
  readonly usedProductIds = input<number[]>([]);

  readonly productPicked = output<InvoiceProductOption>();
  readonly customRequested = output<void>();
  readonly closed = output<void>();

  readonly query = signal('');
  readonly results = signal<InvoiceProductOption[]>([]);
  readonly loading = signal(false);
  private readonly failedImageIds = signal<Set<number>>(new Set<number>());

  private readonly search$ = new Subject<string>();

  private readonly usedIdSet = computed(() => new Set(this.usedProductIds()));

  constructor() {
    this.search$
      .pipe(
        debounceTime(SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        tap(() => this.loading.set(true)),
        switchMap((term) =>
          this.lookup
            .search(term)
            .pipe(catchError(() => of([] as InvoiceProductOption[]))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((options) => {
        this.loading.set(false);
        this.results.set(options);
      });

    // Abrir SIEMPRE relanza la búsqueda: el comerciante pudo crear el producto
    // en otra pestaña entre una línea y la siguiente, y una lista cacheada le
    // diría que no existe.
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.query.set('');
        this.failedImageIds.set(new Set<number>());
        this.loading.set(true);
        this.lookup
          .search('')
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((options) => {
            this.loading.set(false);
            this.results.set(options);
          });
      });
    });
  }

  onQuery(event: Event): void {
    const term = (event.target as HTMLInputElement).value;
    this.query.set(term);
    this.search$.next(term);
  }

  isAlreadyUsed(id: number): boolean {
    return this.usedIdSet().has(id);
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

  subtitleFor(product: InvoiceProductOption): string {
    const kind =
      product.productType === 'service'
        ? 'Servicio'
        : product.productType === 'prepared'
          ? 'Preparado'
          : 'Producto';
    return [kind, product.sku, product.category].filter(Boolean).join(' · ');
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0);
  }

  pick(product: InvoiceProductOption): void {
    if (this.isAlreadyUsed(product.id)) return;
    this.productPicked.emit(product);
  }

  requestCustom(): void {
    this.customRequested.emit();
  }

  close(): void {
    this.closed.emit();
  }
}
