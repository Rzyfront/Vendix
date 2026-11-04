import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import type { Product } from '../../../products/interfaces/product.interface';
import { ProductsService } from '../../../products/services/products.service';
import { StoreAppsService } from '../../services/store-apps.service';
import { AppPageMode, modeBooks, modeSells } from '../../templates';
import { AppPageBuilderPageComponent } from '../app-page-builder-page.component';
import {
  MAX_FEATURED_SERVICES,
  MAX_SECONDARY_PRODUCTS,
  PickedItem,
  ServicePageContext,
  ServicePageSettings,
  servicePageBuilderAdapter,
} from './service-page-builder';

type SearchTarget = 'service' | 'product';

/** The mode a page has when it books (or not) and sells (or not). */
export function modeOf(books: boolean, sells: boolean): AppPageMode {
  if (books && sells) return 'both';
  if (books) return 'booking';
  return sells ? 'sales' : 'info';
}

/**
 * F6-B — the service page's own part of General: how the services are
 * grouped, whether the page books (agenda) and whether it also sells (the
 * optional purchase), the featured services and the products of «También
 * puedes comprar». The server re-validates every rule (sold online, limits,
 * domain ownership).
 */
@Component({
  selector: 'app-service-page-general',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4" data-testid="service-page-general-agenda">
      <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Agenda y compra</h3>
      <p class="mt-1 text-xs text-[var(--color-text-secondary)]">Qué pueden hacer tus clientes desde esta página.</p>
      <label class="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" [checked]="books()" (change)="booksChange.emit($any($event.target).checked)" data-testid="service-page-books" />
        <span>
          Agenda de reservas
          <span class="block text-xs text-[var(--color-text-secondary)]">Botón «Reservar»: eligen día y hora con tu agenda. Apagada, el botón lleva al detalle del servicio.</span>
        </span>
      </label>
      <label class="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" [checked]="sells()" (change)="sellsChange.emit($any($event.target).checked)" data-testid="service-page-sells" />
        <span>
          Compra de productos
          <span class="block text-xs text-[var(--color-text-secondary)]">Muestra «También puedes comprar» y el carrito de la tienda.</span>
        </span>
      </label>
      @if (sells()) {
        <label class="mt-3 flex items-center gap-2 pl-6 text-sm">
          <input type="checkbox" [checked]="showCart()" (change)="showCartChange.emit($any($event.target).checked)" data-testid="service-page-show-cart" />
          Mostrar el carrito en el encabezado
        </label>
      }
    </section>

    <section class="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4" data-testid="service-page-general-grouping">
      <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Agrupación de servicios</h3>
      @if (categories().length > 1) {
        <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
          La página los agrupa con filtros por categoría. Para cambiar la agrupación, cambia la categoría del servicio en tu catálogo.
        </p>
        <ul class="mt-2 flex flex-wrap gap-2" data-testid="service-page-categories">
          @for (c of categories(); track c.name) {
            <li class="rounded-full bg-[var(--color-background)] px-3 py-1 text-sm">{{ c.name }} <span class="text-xs opacity-70">({{ c.count }})</span></li>
          }
        </ul>
      } @else {
        <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
          Los filtros por categoría aparecen cuando tus servicios están en dos o más categorías.
        </p>
      }
    </section>

    <section class="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4" data-testid="service-page-general-featured">
      <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">
        Servicios destacados
        <span class="font-normal text-[var(--color-text-secondary)]">({{ settings().featured.length }}/{{ maxServices }})</span>
      </h3>
      <p class="text-xs text-[var(--color-text-secondary)]">La página lista todos tus servicios en línea; los destacados van primero, en este orden.</p>
      @if (settings().featured.length) {
        <ul class="mt-2 flex flex-wrap gap-2">
          @for (s of settings().featured; track s.id) {
            <li class="inline-flex items-center gap-1 rounded-full bg-[var(--color-background)] px-3 py-1 text-sm" [attr.data-testid]="'service-page-featured-' + s.id">
              {{ s.name }}
              <button type="button" [attr.aria-label]="'Quitar ' + s.name" (click)="remove('service', s.id)"><app-icon name="x" [size]="12" /></button>
            </li>
          }
        </ul>
      }
      @if (settings().featured.length < maxServices) {
        <input type="search" class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
               placeholder="Busca un servicio por nombre" data-testid="service-page-service-search"
               [value]="serviceQuery()" (input)="search('service', $any($event.target).value)" />
      }
    </section>

    <section class="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4" data-testid="service-page-general-products">
      <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">
        También puedes comprar
        <span class="font-normal text-[var(--color-text-secondary)]">({{ settings().products.length }}/{{ maxProducts }})</span>
      </h3>
      <p class="text-xs text-[var(--color-text-secondary)]">
        Productos debajo de los servicios, con el mismo carrito.
        @if (!sells()) { Con la compra apagada no se muestran. }
      </p>
      @if (settings().products.length) {
        <ul class="mt-2 flex flex-wrap gap-2">
          @for (p of settings().products; track p.id) {
            <li class="inline-flex items-center gap-1 rounded-full bg-[var(--color-background)] px-3 py-1 text-sm" [attr.data-testid]="'service-page-product-' + p.id">
              {{ p.name }}
              <button type="button" [attr.aria-label]="'Quitar ' + p.name" (click)="remove('product', p.id)"><app-icon name="x" [size]="12" /></button>
            </li>
          }
        </ul>
      }
      @if (settings().products.length < maxProducts) {
        <input type="search" class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
               placeholder="Busca un producto por nombre o SKU" data-testid="service-page-product-search"
               [value]="productQuery()" (input)="search('product', $any($event.target).value)" />
      }
      @if (results().length) {
        <ul class="mt-1 max-h-48 overflow-y-auto rounded-lg border border-[var(--color-border)]" data-testid="service-page-results">
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
  `,
})
export class ServicePageGeneralComponent {
  private readonly products = inject(ProductsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly settings = input.required<ServicePageSettings>();
  readonly mode = input<AppPageMode>('both');
  readonly showCart = input(true);
  /** Categories of the services the page lists (the filters the public page shows). */
  readonly context = input<ServicePageContext | null>(null);

  readonly settingsChange = output<ServicePageSettings>();
  readonly booksChange = output<boolean>();
  readonly sellsChange = output<boolean>();
  readonly showCartChange = output<boolean>();

  readonly maxServices = MAX_FEATURED_SERVICES;
  readonly maxProducts = MAX_SECONDARY_PRODUCTS;
  readonly books = computed(() => modeBooks(this.mode()));
  readonly sells = computed(() => modeSells(this.mode()));
  readonly categories = computed(() => {
    const counts = new Map<number, { name: string; count: number }>();
    for (const service of this.context()?.services ?? []) {
      for (const c of service.categories) {
        const entry = counts.get(c.id);
        if (entry) entry.count++;
        else counts.set(c.id, { name: c.name, count: 1 });
      }
    }
    return [...counts.values()];
  });

  readonly serviceQuery = signal('');
  readonly productQuery = signal('');
  readonly results = signal<Product[]>([]);
  private readonly target = signal<SearchTarget>('service');
  private readonly term = signal('');

  constructor() {
    toObservable(computed(() => ({ term: this.term(), target: this.target() })))
      .pipe(
        debounceTime(300),
        distinctUntilChanged((a, b) => a.term === b.term && a.target === b.target),
        switchMap(({ term, target }) =>
          term.trim().length < 2
            ? of([] as Product[])
            : this.products
                .getProducts({
                  search: term.trim(),
                  limit: 10,
                  state: 'active' as Product['state'],
                  ...(target === 'service' ? { product_type: 'service' as const } : {}),
                })
                .pipe(
                  // Services go in their own list; the secondary block sells products.
                  map((res) => (res.data ?? []).filter((p) => (target === 'service') === (p.product_type === 'service'))),
                  catchError(() => of([] as Product[])),
                ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((found) => this.results.set(found));
  }

  search(target: SearchTarget, term: string): void {
    this.target.set(target);
    (target === 'service' ? this.serviceQuery : this.productQuery).set(term);
    this.term.set(term);
  }

  pick(product: Product): void {
    const picked: PickedItem = { id: product.id, name: product.name };
    const settings = this.settings();
    if (this.target() === 'service') {
      if (!settings.featured.some((s) => s.id === picked.id) && settings.featured.length < MAX_FEATURED_SERVICES) {
        this.settingsChange.emit({ ...settings, featured: [...settings.featured, picked] });
      }
    } else if (!settings.products.some((p) => p.id === picked.id) && settings.products.length < MAX_SECONDARY_PRODUCTS) {
      this.settingsChange.emit({ ...settings, products: [...settings.products, picked] });
    }
    this.serviceQuery.set('');
    this.productQuery.set('');
    this.term.set('');
    this.results.set([]);
  }

  remove(target: SearchTarget, id: number): void {
    const settings = this.settings();
    this.settingsChange.emit(
      target === 'service'
        ? { ...settings, featured: settings.featured.filter((s) => s.id !== id) }
        : { ...settings, products: settings.products.filter((p) => p.id !== id) },
    );
  }
}

/** F6-B — `/admin/apps/service_page`: the service page builder (shared view + service page adapter). */
@Component({
  selector: 'app-service-page-builder-page',
  standalone: true,
  imports: [AppPageBuilderPageComponent, ServicePageGeneralComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-app-page-builder-page #builder [adapter]="adapter">
      @if (builder.settings(); as settings) {
        <app-service-page-general
          [settings]="settings"
          [mode]="builder.mode()"
          [showCart]="builder.page().sales?.show_cart !== false"
          [context]="builder.context()"
          (settingsChange)="builder.settings.set($event)"
          (booksChange)="setMode(builder, $event, sells(builder))"
          (sellsChange)="setMode(builder, books(builder), $event)"
          (showCartChange)="setShowCart(builder, $event)"
        />
      }
    </app-app-page-builder-page>
  `,
})
export class ServicePageBuilderPageComponent {
  readonly adapter = servicePageBuilderAdapter(inject(StoreAppsService), inject(ProductsService));

  books(builder: AppPageBuilderPageComponent<ServicePageSettings, ServicePageContext>): boolean {
    return modeBooks(builder.mode());
  }

  sells(builder: AppPageBuilderPageComponent<ServicePageSettings, ServicePageContext>): boolean {
    return modeSells(builder.mode());
  }

  setMode(builder: AppPageBuilderPageComponent<ServicePageSettings, ServicePageContext>, books: boolean, sells: boolean): void {
    builder.base.update((page) => ({ ...page, mode: modeOf(books, sells) }));
  }

  setShowCart(builder: AppPageBuilderPageComponent<ServicePageSettings, ServicePageContext>, showCart: boolean): void {
    builder.base.update((page) => ({ ...page, sales: { ...page.sales, show_cart: showCart } }));
  }
}
