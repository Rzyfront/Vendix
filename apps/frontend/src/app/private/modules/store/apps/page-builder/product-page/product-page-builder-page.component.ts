import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import type { Product } from '../../../products/interfaces/product.interface';
import { ProductsService } from '../../../products/services/products.service';
import { StoreAppsService } from '../../services/store-apps.service';
import { APP_PAGE_MODE_OPTIONS, AppPageMode, modeSells } from '../../templates';
import { AppPageBuilderPageComponent } from '../app-page-builder-page.component';
import {
  MAX_PRODUCT_PAGE_COMPLEMENTS,
  PickedProduct,
  ProductPageContext,
  ProductPageSettings,
  productPageBuilderAdapter,
} from './product-page-builder';

/** The two modes a product page has: it sells, or only informs. */
const PRODUCT_PAGE_MODES = APP_PAGE_MODE_OPTIONS.filter((o) => o.value === 'sales' || o.value === 'info');

type SearchTarget = 'featured' | 'complement';

/**
 * F6-B — the product page's own part of General: the featured product, its
 * complements, whether the page sells (and shows the cart) or only informs,
 * and what it does with the variants. The server re-validates every rule
 * (sold online, limits, domain ownership).
 */
@Component({
  selector: 'app-product-page-general',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4" data-testid="product-page-general-product">
      <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Producto destacado</h3>
      @if (settings().product; as product) {
        <div class="mt-2 flex items-center justify-between rounded-lg bg-[var(--color-background)] px-3 py-2 text-sm">
          <span class="truncate" data-testid="product-page-featured">{{ product.name }}</span>
          @if (!locked() && !changing()) {
            <button type="button" class="text-xs font-semibold text-[var(--color-primary)]" data-testid="product-page-change"
                    (click)="changing.set(true)">Cambiar</button>
          }
        </div>
        @if (locked()) {
          <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
            Despublica la página para cambiar el producto destacado: su dirección se crea a partir de él.
          </p>
        }
      }
      @if (!settings().product || changing()) {
        <label class="relative mt-2 block">
          <app-icon name="search" [size]="14" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" />
          <input type="search" placeholder="Busca el producto por nombre o SKU" data-testid="product-page-featured-search"
                 class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-8 pr-2 text-sm"
                 [value]="featuredQuery()" (input)="search('featured', $any($event.target).value)" />
        </label>
        @if (!settings().product) {
          <p class="mt-1 text-xs text-[var(--color-text-secondary)]">Elige el producto para poder publicar la página.</p>
        }
      }
      @if (variants().length) {
        <p class="mt-2 text-xs text-[var(--color-text-secondary)]" data-testid="product-page-variants">
          Sus {{ variants().length }} variantes se muestran en la página con su selector: {{ variants().join(', ') }}.
        </p>
      }
    </section>

    <section class="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4" data-testid="product-page-general-complements">
      <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">
        Complementa tu compra
        <span class="font-normal text-[var(--color-text-secondary)]">({{ settings().complements.length }}/{{ maxComplements }})</span>
      </h3>
      @if (settings().complements.length) {
        <ul class="mt-2 flex flex-wrap gap-2">
          @for (c of settings().complements; track c.id) {
            <li class="inline-flex items-center gap-1 rounded-full bg-[var(--color-background)] px-3 py-1 text-sm" [attr.data-testid]="'product-page-complement-' + c.id">
              {{ c.name }}
              <button type="button" [attr.aria-label]="'Quitar ' + c.name" (click)="removeComplement(c.id)"><app-icon name="x" [size]="12" /></button>
            </li>
          }
        </ul>
      }
      @if (settings().product && settings().complements.length < maxComplements) {
        <label class="relative mt-2 block">
          <app-icon name="search" [size]="14" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" />
          <input type="search" placeholder="Añade productos que se compran junto al destacado" data-testid="product-page-complement-search"
                 class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-8 pr-2 text-sm"
                 [value]="complementQuery()" (input)="search('complement', $any($event.target).value)" />
        </label>
      } @else if (!settings().product) {
        <p class="mt-1 text-xs text-[var(--color-text-secondary)]">Primero elige el producto destacado.</p>
      }
      @if (results().length) {
        <ul class="mt-1 max-h-48 overflow-y-auto rounded-lg border border-[var(--color-border)]" data-testid="product-page-results">
          @for (p of results(); track p.id) {
            <li>
              <button type="button" class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--color-background)] disabled:opacity-50"
                      [disabled]="!p.available_for_ecommerce" (click)="pick(p)">
                <span class="truncate">{{ p.name }}</span>
                @if (!p.available_for_ecommerce) {
                  <span class="shrink-0 text-xs text-[var(--color-text-secondary)]">No se vende en línea</span>
                }
              </button>
            </li>
          }
        </ul>
      }
    </section>

    <section class="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4" data-testid="product-page-general-purchase">
      <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Compra</h3>
      <div class="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Qué hace la página">
        @for (opt of modes; track opt.value) {
          <label class="flex cursor-pointer items-start gap-2 rounded-lg border p-3"
                 [class]="mode() === opt.value ? 'border-[var(--color-primary)]' : 'border-[var(--color-border)]'">
            <input type="radio" name="pp-mode" [checked]="mode() === opt.value" (change)="modeChange.emit(opt.value)"
                   [attr.data-testid]="'product-page-mode-' + opt.value" />
            <span>
              <span class="block text-sm font-medium">{{ opt.value === 'sales' ? 'Con compra' : 'Solo información' }}</span>
              <span class="block text-xs text-[var(--color-text-secondary)]">{{ opt.value === 'sales' ? 'Carrito y checkout de la tienda.' : 'Sin carrito ni checkout: solo muestra el producto.' }}</span>
            </span>
          </label>
        }
      </div>
      @if (sells()) {
        <label class="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" [checked]="showCart()" (change)="showCartChange.emit($any($event.target).checked)" data-testid="product-page-show-cart" />
          Mostrar el carrito en el encabezado
        </label>
      }
    </section>
  `,
})
export class ProductPageGeneralComponent {
  private readonly products = inject(ProductsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly settings = input.required<ProductPageSettings>();
  /** Published on a Vendix address: it is built from the product, so it cannot change. */
  readonly locked = input(false);
  readonly mode = input<AppPageMode>('sales');
  readonly showCart = input(true);
  readonly variants = input<readonly string[]>([]);

  readonly settingsChange = output<ProductPageSettings>();
  readonly modeChange = output<AppPageMode>();
  readonly showCartChange = output<boolean>();

  readonly modes = PRODUCT_PAGE_MODES;
  readonly maxComplements = MAX_PRODUCT_PAGE_COMPLEMENTS;
  readonly sells = computed(() => modeSells(this.mode()));

  readonly changing = signal(false);
  readonly featuredQuery = signal('');
  readonly complementQuery = signal('');
  readonly results = signal<Product[]>([]);
  private readonly target = signal<SearchTarget>('featured');
  private readonly term = signal('');

  constructor() {
    toObservable(this.term)
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) =>
          term.trim().length < 2
            ? of([] as Product[])
            : this.products.getProducts({ search: term.trim(), limit: 10, state: 'active' as Product['state'] }).pipe(
                map((res) => res.data ?? []),
                catchError(() => of([] as Product[])),
              ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((products) => this.results.set(products));
  }

  search(target: SearchTarget, term: string): void {
    this.target.set(target);
    (target === 'featured' ? this.featuredQuery : this.complementQuery).set(term);
    this.term.set(term);
  }

  pick(product: Product): void {
    const picked: PickedProduct = { id: product.id, name: product.name, slug: product.slug };
    const settings = this.settings();
    if (this.target() === 'featured') {
      this.settingsChange.emit({ product: picked, complements: settings.complements.filter((c) => c.id !== picked.id) });
    } else if (
      picked.id !== settings.product?.id &&
      !settings.complements.some((c) => c.id === picked.id) &&
      settings.complements.length < MAX_PRODUCT_PAGE_COMPLEMENTS
    ) {
      this.settingsChange.emit({ ...settings, complements: [...settings.complements, picked] });
    }
    this.changing.set(false);
    this.featuredQuery.set('');
    this.complementQuery.set('');
    this.term.set('');
    this.results.set([]);
  }

  removeComplement(id: number): void {
    const settings = this.settings();
    this.settingsChange.emit({ ...settings, complements: settings.complements.filter((c) => c.id !== id) });
  }
}

/** F6-B — `/admin/apps/product_page`: the product page builder (shared view + product page adapter). */
@Component({
  selector: 'app-product-page-builder-page',
  standalone: true,
  imports: [AppPageBuilderPageComponent, ProductPageGeneralComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-app-page-builder-page #builder [adapter]="adapter">
      @if (builder.settings(); as settings) {
        <app-product-page-general
          [settings]="settings"
          [locked]="isLocked(builder.detail()?.status, builder.detail()?.domain?.id, builder.domains())"
          [mode]="builder.mode()"
          [showCart]="builder.page().sales?.show_cart !== false"
          [variants]="variantNames(builder.context(), settings)"
          (settingsChange)="builder.settings.set($event)"
          (modeChange)="setMode(builder, $event)"
          (showCartChange)="setShowCart(builder, $event)"
        />
      }
    </app-app-page-builder-page>
  `,
})
export class ProductPageBuilderPageComponent {
  readonly adapter = productPageBuilderAdapter(inject(StoreAppsService), inject(ProductsService));

  /** Published on the Vendix subdomain (not on one of the store's own domains): it is named after the product. */
  isLocked(status: string | undefined, domainId: number | undefined, domains: readonly { id: number }[] | null): boolean {
    return status === 'published' && !(domains ?? []).some((d) => d.id === domainId);
  }

  /** Variants of the featured product, when the server data is about that same product. */
  variantNames(context: ProductPageContext | null, settings: ProductPageSettings): string[] {
    return context?.product && context.product.id === settings.product?.id ? context.product.variants.map((v) => v.name) : [];
  }

  setMode(builder: AppPageBuilderPageComponent<ProductPageSettings, ProductPageContext>, mode: AppPageMode): void {
    builder.base.update((page) => ({ ...page, mode }));
  }

  setShowCart(builder: AppPageBuilderPageComponent<ProductPageSettings, ProductPageContext>, showCart: boolean): void {
    builder.base.update((page) => ({ ...page, sales: { ...page.sales, show_cart: showCart } }));
  }
}
