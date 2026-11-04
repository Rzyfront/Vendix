import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import {
  CatalogService,
  EcommerceProduct,
} from '../../private/modules/ecommerce/services/catalog.service';
import {
  StoreSeoService,
  plainDescription,
} from '../../private/modules/ecommerce/services/store-seo';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { withPageSeo } from '../app-page/app-page-seo';
import { ServicePageHomeViewComponent } from './service-page-home-view.component';
import { ServicePageService } from './service-page.service';

/**
 * `/` of a service page domain (Apps · STORE_SERVICE_PAGE): the store's
 * services first — category filter, photo, duration, price and what the
 * service includes — and, below and lighter, the products the owner picked.
 *
 * Cards, prices and categories come from the ecommerce catalog; "Reservar"
 * opens the ecommerce booking (`/book/:id`: day, slot, hold, checkout), so
 * availability, stations and holds stay in the existing engine. The page is
 * drawn by `ServicePageHomeViewComponent`, which the editor's preview shares.
 */
@Component({
  selector: 'app-service-page-home',
  standalone: true,
  imports: [IconComponent, ServicePageHomeViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state() === 'loading') {
      <p class="px-6 py-24 text-center text-sm text-text-secondary">Cargando servicios…</p>
    } @else if (state() === 'unavailable') {
      <section class="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center" data-testid="service-page-unavailable">
        <app-icon name="calendar" [size]="40" class="text-text-secondary" />
        <h1 class="text-xl font-semibold text-text-primary">Esta página no está disponible</h1>
        <p class="max-w-md text-sm text-text-secondary">
          Los servicios de esta tienda ya no se publican en esta dirección.
        </p>
      </section>
    } @else {
      <app-service-page-home-view
        [services]="services()"
        [featuredIds]="featuredIds()"
        [productIds]="productIds()"
        [page]="page()"
        [storeName]="storeSeo.storeName()"
      />
    }
  `,
})
export class ServicePageHomeComponent {
  private readonly servicePage = inject(ServicePageService);
  private readonly catalog = inject(CatalogService);
  protected readonly storeSeo = inject(StoreSeoService);
  private readonly destroyRef = inject(DestroyRef);

  readonly services = signal<EcommerceProduct[]>([]);
  readonly state = signal<'loading' | 'ready' | 'unavailable'>('loading');

  readonly featuredIds = computed(() => this.servicePage.config()?.featured_service_ids ?? []);
  readonly productIds = computed(() => this.servicePage.config()?.product_ids ?? []);

  /** The owner's own page; `null` keeps the page exactly as it was (apps-f2 S5). */
  readonly page = computed(() => this.servicePage.config()?.page ?? null);

  constructor() {
    this.servicePage
      .load()
      .pipe(
        switchMap((config) => {
          if (!config || config.service_ids.length === 0) return of(null);
          const ids = config.service_ids;
          return this.catalog.getProducts({ ids: ids.join(','), limit: ids.length }).pipe(
            // Keep the page order (featured first); drop what the catalog no longer sells.
            map((res) => {
              const byId = new Map(res.data.map((p) => [p.id, p]));
              return ids
                .map((id) => byId.get(id))
                .filter((p): p is EcommerceProduct => !!p);
            }),
            catchError(() => of([] as EcommerceProduct[])),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((services) => {
        if (!services || services.length === 0) {
          this.state.set('unavailable');
          return;
        }
        this.services.set(services);
        this.state.set('ready');
      });

    // The list is the domain's indexable home: title, description, canonical
    // and an ItemList of the services. Released to the store defaults on leave.
    effect(() => {
      const name = this.storeSeo.storeName();
      const services = this.services();
      if (!name || services.length === 0) return;
      const origin = this.storeSeo.origin;
      const page = this.page();
      this.storeSeo.apply(this, withPageSeo({
        title: `Servicios | ${name}`,
        description: plainDescription(
          null,
          `Reserva en línea los servicios de ${name}: ${services
            .slice(0, 3)
            .map((s) => s.name)
            .join(', ')}.`,
        ),
        canonicalPath: '/',
        robots: 'index, follow',
        image: services.find((s) => s.image_url)?.image_url ?? null,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          itemListElement: services.map((s, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            url: `${origin}/products/${s.slug}`,
            name: s.name,
          })),
        },
      }, page));
    });
    this.destroyRef.onDestroy(() => this.storeSeo.release(this));
  }
}
