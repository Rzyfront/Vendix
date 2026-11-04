import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import type { Product } from '../../../products/interfaces/product.interface';
import { ProductsService } from '../../../products/services/products.service';
import { StoreAppsService } from '../../services/store-apps.service';
import { AppPageMode, modeSells } from '../../templates';
import { AppPageBuilderPageComponent } from '../app-page-builder-page.component';
import {
  BookingContext,
  BookingSettings,
  MAX_BOOKING_PRODUCTS,
  PickedItem,
  bookingBuilderAdapter,
} from './booking-builder';

/** The mode a booking page has: it always books, and sells or not. */
export function bookingModeOf(sells: boolean): AppPageMode {
  return sells ? 'both' : 'booking';
}

/**
 * F6-B — the booking page's own part of General: what guests can do (the
 * booking itself, always, and the optional purchase of the «Para tu estadía»
 * products) and those products. Dates, rates, allotments and policies come
 * from Hotelería as they are; the server re-validates every rule (hospitality
 * industry, an active room type, sold-online products, domain ownership).
 */
@Component({
  selector: 'app-booking-general',
  standalone: true,
  imports: [IconComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4" data-testid="booking-general-operation">
      <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Reserva y compra</h3>
      <p class="mt-1 text-xs text-[var(--color-text-secondary)]">Qué pueden hacer tus huéspedes desde esta página.</p>
      <p class="mt-3 text-sm text-[var(--color-text-primary)]" data-testid="booking-general-rooms">
        Reserva con fechas: la página busca disponibilidad entre tus {{ roomCount() }} tipo(s) de habitación activos, con su tarifa y política de cancelación.
      </p>
      <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
        Las fechas disponibles, la duración de la estadía, los cupos y las tarifas se administran en
        <a routerLink="/admin/hospitality/rooms" class="text-[var(--color-primary)] hover:underline" data-testid="booking-general-rooms-link">Habitaciones</a>
        y
        <a routerLink="/admin/hospitality/rates" class="text-[var(--color-primary)] hover:underline" data-testid="booking-general-rates-link">Tarifas</a>.
      </p>
      <label class="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" [checked]="sells()" (change)="sellsChange.emit($any($event.target).checked)" data-testid="booking-sells" />
        <span>
          Venta de productos
          <span class="block text-xs text-[var(--color-text-secondary)]">Muestra «Para tu estadía» y el carrito de la tienda. Apagada, la página solo reserva.</span>
        </span>
      </label>
      @if (sells()) {
        <label class="mt-3 flex items-center gap-2 pl-6 text-sm">
          <input type="checkbox" [checked]="showCart()" (change)="showCartChange.emit($any($event.target).checked)" data-testid="booking-show-cart" />
          Mostrar el carrito en el encabezado
        </label>
      }
    </section>

    <section class="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4" data-testid="booking-general-products">
      <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">
        Para tu estadía
        <span class="font-normal text-[var(--color-text-secondary)]">({{ settings().products.length }}/{{ maxProducts }})</span>
      </h3>
      <p class="text-xs text-[var(--color-text-secondary)]">
        Amenidades y productos debajo de la reserva, con el mismo carrito.
        @if (!sells()) { Con la venta apagada no se muestran. }
      </p>
      @if (settings().products.length) {
        <ul class="mt-2 flex flex-wrap gap-2">
          @for (p of settings().products; track p.id) {
            <li class="inline-flex items-center gap-1 rounded-full bg-[var(--color-background)] px-3 py-1 text-sm" [attr.data-testid]="'booking-product-' + p.id">
              {{ p.name }}
              <button type="button" [attr.aria-label]="'Quitar ' + p.name" (click)="remove(p.id)"><app-icon name="x" [size]="12" /></button>
            </li>
          }
        </ul>
      }
      @if (settings().products.length < maxProducts) {
        <input type="search" class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
               placeholder="Busca un producto por nombre o SKU" data-testid="booking-product-search"
               [value]="query()" (input)="search($any($event.target).value)" />
      }
      @if (results().length) {
        <ul class="mt-1 max-h-48 overflow-y-auto rounded-lg border border-[var(--color-border)]" data-testid="booking-results">
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
export class BookingGeneralComponent {
  private readonly products = inject(ProductsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly settings = input.required<BookingSettings>();
  readonly mode = input<AppPageMode>('both');
  readonly showCart = input(true);
  /** Real room types of the store (what the booking searches). */
  readonly context = input<BookingContext | null>(null);

  readonly settingsChange = output<BookingSettings>();
  readonly sellsChange = output<boolean>();
  readonly showCartChange = output<boolean>();

  readonly maxProducts = MAX_BOOKING_PRODUCTS;
  readonly sells = computed(() => modeSells(this.mode()));
  readonly roomCount = computed(() => this.context()?.room_types.length ?? 0);

  readonly query = signal('');
  readonly results = signal<Product[]>([]);

  constructor() {
    toObservable(this.query)
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) =>
          term.trim().length < 2
            ? of([] as Product[])
            : this.products
                .getProducts({ search: term.trim(), limit: 10, state: 'active' as Product['state'] })
                .pipe(
                  // The secondary block sells products, not services.
                  map((res) => (res.data ?? []).filter((p) => p.product_type !== 'service')),
                  catchError(() => of([] as Product[])),
                ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((found) => this.results.set(found));
  }

  search(term: string): void {
    this.query.set(term);
  }

  pick(product: Product): void {
    const picked: PickedItem = { id: product.id, name: product.name };
    const settings = this.settings();
    if (!settings.products.some((p) => p.id === picked.id) && settings.products.length < MAX_BOOKING_PRODUCTS) {
      this.settingsChange.emit({ ...settings, products: [...settings.products, picked] });
    }
    this.query.set('');
    this.results.set([]);
  }

  remove(id: number): void {
    const settings = this.settings();
    this.settingsChange.emit({ ...settings, products: settings.products.filter((p) => p.id !== id) });
  }
}

/** F6-B — `/admin/apps/booking`: the booking page builder (shared view + booking adapter). */
@Component({
  selector: 'app-booking-builder-page',
  standalone: true,
  imports: [AppPageBuilderPageComponent, BookingGeneralComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-app-page-builder-page #builder [adapter]="adapter">
      @if (builder.settings(); as settings) {
        <app-booking-general
          [settings]="settings"
          [mode]="builder.mode()"
          [showCart]="builder.page().sales?.show_cart !== false"
          [context]="builder.context()"
          (settingsChange)="builder.settings.set($event)"
          (sellsChange)="setSells(builder, $event)"
          (showCartChange)="setShowCart(builder, $event)"
        />
      }
    </app-app-page-builder-page>
  `,
})
export class BookingBuilderPageComponent {
  readonly adapter = bookingBuilderAdapter(inject(StoreAppsService), inject(ProductsService));

  setSells(builder: AppPageBuilderPageComponent<BookingSettings, BookingContext>, sells: boolean): void {
    builder.base.update((page) => ({ ...page, mode: bookingModeOf(sells) }));
  }

  setShowCart(builder: AppPageBuilderPageComponent<BookingSettings, BookingContext>, showCart: boolean): void {
    builder.base.update((page) => ({ ...page, sales: { ...page.sales, show_cart: showCart } }));
  }
}
