import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { forkJoin, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';

import { parseApiError } from '../../../../../core/utils/parse-api-error';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { ProductsService } from '../../products/services/products.service';
import type { Product } from '../../products/interfaces/product.interface';
import {
  BookingPageConfig,
  ProductPageCustomDomain,
  StoreAppDetail,
  appDomainAliasIds,
} from '../interfaces/store-app.interface';
import { StoreAppsService } from '../services/store-apps.service';
import type { AppSettingsPanel } from './app-settings-panel';

/** Same limit as the backend (`booking-page.reader.ts`). */
export const MAX_BOOKING_PRODUCTS = 8;

interface PickedItem {
  id: number;
  name: string;
}

/**
 * Apps · booking settings (Fase 4): the hotel's booking page on its own
 * domain. Rooms, rates, seasons, allotments and cancellation policies come
 * from Hotelería as they are; here the owner only picks the secondary
 * amenities/products, the domain, and publishes or unpublishes. The server
 * re-validates every rule (hospitality industry, an active room type).
 */
@Component({
  selector: 'app-booking-settings-panel',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-4" data-panel="booking">
      <p class="text-sm text-[var(--color-text-secondary)]">Reservas y check-in en línea de tu hotel, en su propio dominio.</p>

      @if (loading()) {
        <p class="text-sm text-[var(--color-text-secondary)]">Cargando…</p>
      } @else {
        <div class="space-y-5 text-sm" data-testid="booking-settings">
          <div class="rounded-lg border border-[var(--color-border)] p-3">
            <p class="text-[var(--color-text-primary)]">
              Estado: <strong>{{ statusLabel() }}</strong>
            </p>
            @if (detail()?.public_url; as url) {
              <p class="mt-1 text-[var(--color-text-secondary)]">
                Publicada en
                <a [href]="url" target="_blank" rel="noopener noreferrer"
                   class="text-[var(--color-primary)] hover:underline" data-testid="booking-url">{{ url }}</a>
              </p>
            }
            <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
              Los huéspedes ven la disponibilidad por fecha, los tipos de habitación, sus tarifas y políticas de cancelación tal como están en Hotelería, pagan el anticipo en línea y hacen el check-in cuando la reserva está confirmada.
            </p>
          </div>

          <section>
            <h3 class="font-semibold text-[var(--color-text-primary)]">
              Para tu estadía
              <span class="font-normal text-[var(--color-text-secondary)]">({{ products().length }}/{{ maxProducts }})</span>
            </h3>
            <p class="text-xs text-[var(--color-text-secondary)]">Amenidades y productos que se muestran debajo de la reserva, con el carrito de la tienda.</p>
            @if (products().length > 0) {
              <ul class="mt-2 flex flex-wrap gap-2" data-testid="booking-products">
                @for (p of products(); track p.id) {
                  <li class="inline-flex items-center gap-1 rounded-full bg-[var(--color-background)] px-3 py-1">
                    {{ p.name }}
                    <button type="button" [attr.aria-label]="'Quitar ' + p.name" (click)="remove(p.id)">
                      <app-icon name="x" [size]="12" />
                    </button>
                  </li>
                }
              </ul>
            }
            @if (products().length < maxProducts) {
              <input type="search" class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                     placeholder="Busca un producto por nombre o SKU" data-testid="booking-product-search"
                     [value]="query()" (input)="query.set($any($event.target).value)" />
            }
            @if (results().length > 0) {
              <ul class="mt-2 max-h-56 overflow-auto rounded-lg border border-[var(--color-border)]" data-testid="booking-search-results">
                @for (p of results(); track p.id) {
                  <li>
                    <button type="button" class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[var(--color-background)] disabled:opacity-50"
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

          <section>
            <h3 class="font-semibold text-[var(--color-text-primary)]">Dominio</h3>
            <p class="mt-1 text-xs text-[var(--color-text-secondary)]" data-testid="app-domain-hint">
              La dirección de Vendix queda siempre activa. Si eliges uno de tus dominios, se suma como alias.
            </p>
            @if (aliasHostnames().length) {
              <p class="mt-2 text-sm" data-testid="app-domain-aliases">
                También responde en: {{ aliasHostnames().join(', ') }}
              </p>
            }
            <label class="mt-2 flex items-start gap-2">
              <input type="radio" name="bk-domain" [checked]="customDomainId() === null" (change)="customDomainId.set(null)" />
              <span>
                Dirección de Vendix para tus reservas
                <span class="block text-xs text-[var(--color-text-secondary)]">Por ejemplo: tuhotel-booking.vendix.online</span>
              </span>
            </label>
            @for (d of customDomains(); track d.id) {
              <label class="mt-2 flex items-start gap-2">
                <input type="radio" name="bk-domain" [checked]="customDomainId() === d.id" (change)="customDomainId.set(d.id)" />
                <span>{{ d.hostname }} <span class="text-xs text-[var(--color-text-secondary)]">(sumar como alias)</span></span>
              </label>
            }
          </section>

          @if (error()) {
            <p class="rounded-lg bg-[var(--color-background)] p-3 text-[var(--color-error,#b91c1c)]" role="alert">{{ error() }}</p>
          }
        </div>
      }

      <div class="flex flex-wrap justify-end gap-2 border-t border-[var(--color-border)] pt-4">
        <button type="button" class="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
                [disabled]="busy() || loading()" (click)="save(false)">Guardar</button>
      </div>
    </section>
  `,
})
export class BookingSettingsPanelComponent implements AppSettingsPanel {
  private readonly appsService = inject(StoreAppsService);
  private readonly productsService = inject(ProductsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** Emitted after a save, publish or unpublish, so the view header reloads. */
  readonly changed = output<void>();

  readonly maxProducts = MAX_BOOKING_PRODUCTS;

  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly detail = signal<StoreAppDetail | null>(null);
  readonly customDomains = signal<ProductPageCustomDomain[]>([]);
  readonly products = signal<PickedItem[]>([]);
  readonly customDomainId = signal<number | null>(null);
  /** Own domains already serving this app as aliases (Apps F5). */
  readonly aliasHostnames = computed(() => {
    const domains = this.customDomains();
    return appDomainAliasIds(this.detail()?.config).map(
      (id) => domains.find((d) => d.id === id)?.hostname ?? `Dominio #${id}`,
    );
  });
  readonly query = signal('');
  readonly results = signal<Product[]>([]);

  readonly isPublished = computed(() => this.detail()?.status === 'published');

  readonly statusLabel = computed(() => {
    switch (this.detail()?.status) {
      case 'published':
        return 'Publicada';
      case 'draft':
        return 'Borrador';
      case 'disabled':
        return 'Despublicada';
      default:
        return 'Sin configurar';
    }
  });

  /** {@link AppSettingsPanel}: the view header publishes through these. */
  readonly canPublish = computed(() => !this.loading());
  readonly canUnpublish = computed(() => this.isPublished());

  publish(): void {
    this.save(true);
  }

  constructor() {
    this.load();

    toObservable(this.query)
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) =>
          term.trim().length < 2
            ? of([] as Product[])
            : this.productsService
                .getProducts({ search: term.trim(), limit: 10, state: 'active' as Product['state'] })
                .pipe(
                  // Rooms are booked above; services have their own app.
                  map((res) => (res.data ?? []).filter((p) => p.product_type !== 'service')),
                  catchError(() => of([] as Product[])),
                ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((products) => this.results.set(products));
  }

  pick(product: Product): void {
    if (
      !this.products().some((i) => i.id === product.id) &&
      this.products().length < MAX_BOOKING_PRODUCTS
    ) {
      this.products.update((items) => [...items, { id: product.id, name: product.name }]);
    }
    this.query.set('');
    this.results.set([]);
  }

  remove(id: number): void {
    this.products.update((items) => items.filter((i) => i.id !== id));
  }

  save(publish: boolean): void {
    this.busy.set(true);
    this.error.set(null);
    this.appsService
      .saveBookingConfig({ product_ids: this.products().map((p) => p.id) })
      .pipe(
        switchMap(() =>
          publish ? this.appsService.publishBooking(this.customDomainId()) : of(null),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success(publish ? 'Página de reservas publicada' : 'Página de reservas guardada');
          this.busy.set(false);
          this.changed.emit();
          this.load();
        },
        error: (err) => this.fail(err),
      });
  }

  unpublish(): void {
    this.busy.set(true);
    this.error.set(null);
    this.appsService
      .unpublishBooking()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Página de reservas despublicada');
          this.busy.set(false);
          this.changed.emit();
          this.load();
        },
        error: (err) => this.fail(err),
      });
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    forkJoin({
      detail: this.appsService.get('booking').pipe(map((res) => res.data)),
      domains: this.appsService.bookingCustomDomains().pipe(
        map((res) => res.data ?? []),
        catchError(() => of([] as ProductPageCustomDomain[])),
      ),
    })
      .pipe(
        switchMap(({ detail, domains }) => {
          const config = detail.config as Partial<BookingPageConfig>;
          const ids = Array.isArray(config.product_ids) ? config.product_ids : [];
          const items$ = ids.length
            ? forkJoin(
                ids.map((id) =>
                  this.productsService.getProductById(id).pipe(catchError(() => of(null))),
                ),
              )
            : of([] as (Product | null)[]);
          return items$.pipe(map((items) => ({ detail, domains, items })));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ detail, domains, items }) => {
          this.detail.set(detail);
          this.customDomains.set(domains);
          this.products.set(
            items
              .filter((p): p is Product => !!p)
              .map((p) => ({ id: p.id, name: p.name })),
          );
          const current = domains.find((d) => d.id === detail.domain?.id);
          this.customDomainId.set(current ? current.id : null);
          this.loading.set(false);
        },
        error: (err) => {
          this.fail(err);
          this.loading.set(false);
        },
      });
  }

  private fail(err: unknown): void {
    this.busy.set(false);
    this.error.set(parseApiError(err).userMessage ?? 'No se pudo completar la acción.');
  }
}
