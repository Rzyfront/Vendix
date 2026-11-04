import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterModule } from '@angular/router';
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
import { CurrencyPipe } from '../../shared/pipes/currency';
import {
  effectiveMode,
  modeBooks,
  modeSells,
} from '../../private/modules/store/apps/templates/app-page.types';
import { AppPageViewComponent } from '../app-page/app-page-view.component';
import { withPageSeo } from '../app-page/app-page-seo';
import { ProductComplementsComponent } from '../product-page/components/product-complements.component';
import { ServicePageService } from './service-page.service';
import {
  ServiceCategoryChip,
  bookingTarget,
  formatDuration,
  serviceCategories,
  servicesInCategory,
} from './service-page.util';

/**
 * `/` of a service page domain (Apps · STORE_SERVICE_PAGE): the store's
 * services first — category filter, photo, duration, price and what the
 * service includes — and, below and lighter, the products the owner picked.
 *
 * Cards, prices and categories come from the ecommerce catalog; "Reservar"
 * opens the ecommerce booking (`/book/:id`: day, slot, hold, checkout), so
 * availability, stations and holds stay in the existing engine.
 */
@Component({
  selector: 'app-service-page-home',
  standalone: true,
  imports: [
    RouterModule,
    IconComponent,
    CurrencyPipe,
    ProductComplementsComponent,
    AppPageViewComponent,
  ],
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
      @if (page()) {
        <app-app-page-view kind="service_page" [page]="page()" part="hero" />
      }
      @if (showServices()) {
      <section class="mx-auto w-full max-w-6xl px-4 pb-4 pt-8" [attr.id]="page() ? 'app-page-main' : null">
        @if (page()?.hero?.title) {
          <h2 class="text-2xl font-bold text-text-primary md:text-3xl">{{ heading() }}</h2>
        } @else {
          <h1 class="text-2xl font-bold text-text-primary md:text-3xl">{{ heading() }}</h1>
        }
        <p class="mt-1 text-sm text-text-secondary">{{ subheading() }}</p>

        @if (categories().length > 1) {
          <div class="mt-5 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Categorías">
            <button
              type="button"
              role="tab"
              class="shrink-0 rounded-full border px-4 py-1.5 text-sm"
              [class]="activeCategory() === null ? activeChip : idleChip"
              [attr.aria-selected]="activeCategory() === null"
              (click)="activeCategory.set(null)"
            >
              Todos
            </button>
            @for (chip of categories(); track chip.id) {
              <button
                type="button"
                role="tab"
                class="shrink-0 rounded-full border px-4 py-1.5 text-sm"
                [class]="activeCategory() === chip.id ? activeChip : idleChip"
                [attr.aria-selected]="activeCategory() === chip.id"
                [attr.data-category]="chip.slug"
                (click)="activeCategory.set(chip.id)"
              >
                {{ chip.name }} <span class="text-xs opacity-70">({{ chip.count }})</span>
              </button>
            }
          </div>
        }
      </section>

      <section class="mx-auto grid w-full max-w-6xl gap-4 px-4 pb-10 md:grid-cols-2" aria-label="Servicios" data-testid="service-list">
        @for (service of visibleServices(); track service.id) {
          <article class="flex overflow-hidden rounded-2xl border border-border bg-surface" [attr.data-service]="service.slug">
            <a [routerLink]="['/products', service.slug]" class="block w-28 shrink-0 bg-surface-secondary sm:w-40">
              @if (service.image_url) {
                <img [src]="service.image_url" [alt]="service.name" loading="lazy" class="h-full w-full object-cover" />
              } @else {
                <span class="flex h-full w-full items-center justify-center text-text-secondary">
                  <app-icon name="calendar" [size]="28" />
                </span>
              }
            </a>
            <div class="flex min-w-0 flex-1 flex-col gap-2 p-4">
              <div class="flex items-start justify-between gap-2">
                <a [routerLink]="['/products', service.slug]" class="min-w-0">
                  <h2 class="truncate text-base font-semibold text-text-primary">{{ service.name }}</h2>
                </a>
                @if (featured().has(service.id)) {
                  <span class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">Destacado</span>
                }
              </div>
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
                @if (showDuration() && duration(service); as d) {
                  <span class="inline-flex items-center gap-1" data-testid="service-duration"><app-icon name="clock" [size]="12" /> {{ d }}</span>
                }
                @if (service.service_modality) {
                  <span class="inline-flex items-center gap-1"><app-icon name="map-pin" [size]="12" /> {{ modality(service) }}</span>
                }
              </div>
              @if (includes(service); as text) {
                <p class="line-clamp-2 text-sm text-text-secondary"><span class="font-medium text-text-primary">Incluye:</span> {{ text }}</p>
              }
              <div class="mt-auto flex items-center justify-between gap-2 pt-1">
                @if (showPrice()) {
                  <span class="text-base font-bold text-text-primary">{{ service.final_price | currency }}</span>
                } @else {
                  <span></span>
                }
                <button
                  type="button"
                  class="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white"
                  [attr.data-book]="service.id"
                  (click)="book(service)"
                >
                  {{ service.requires_booking && books() ? 'Reservar' : 'Ver servicio' }}
                </button>
              </div>
            </div>
          </article>
        } @empty {
          <p class="text-sm text-text-secondary md:col-span-2">No hay servicios en esta categoría.</p>
        }
      </section>
      }

      @if (page()) {
        <app-app-page-view kind="service_page" [page]="page()" part="blocks" />
      }

      @if (showProducts()) {
        <div class="border-t border-border bg-surface-secondary/40" data-testid="service-page-products">
          <app-product-complements [productIds]="productIds()" [title]="productsTitle()" [compact]="true" />
        </div>
      }
    }
  `,
})
export class ServicePageHomeComponent {
  private readonly servicePage = inject(ServicePageService);
  private readonly catalog = inject(CatalogService);
  private readonly storeSeo = inject(StoreSeoService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly activeChip = 'border-primary bg-primary text-white';
  readonly idleChip = 'border-border bg-surface text-text-primary';

  readonly services = signal<EcommerceProduct[]>([]);
  readonly state = signal<'loading' | 'ready' | 'unavailable'>('loading');
  readonly activeCategory = signal<number | null>(null);

  readonly featured = computed(
    () => new Set(this.servicePage.config()?.featured_service_ids ?? []),
  );
  readonly productIds = computed(() => this.servicePage.config()?.product_ids ?? []);

  /** The owner's own page; `null` keeps the page exactly as it was (apps-f2 S5). */
  readonly page = computed(() => this.servicePage.config()?.page ?? null);
  private readonly mode = computed(() => effectiveMode('service_page', this.page()));
  /** Booking buttons only when the mode books (always, with no saved page). */
  readonly books = computed(() => !this.page() || modeBooks(this.mode()));
  private blockProps(type: string): { enabled: boolean; props: Record<string, unknown> } | null {
    const block = this.page()?.blocks.find((b) => b.type === type);
    return block ? { enabled: block.enabled, props: block.props } : null;
  }
  private text(type: string, key: string): string | null {
    const v = this.blockProps(type)?.props[key];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }
  readonly showServices = computed(() => this.blockProps('services')?.enabled !== false);
  readonly showDuration = computed(() => this.blockProps('services')?.props['show_duration'] !== false);
  readonly showPrice = computed(() => this.blockProps('services')?.props['show_price'] !== false);
  readonly subheading = computed(
    () => this.text('services', 'subtitle') ?? 'Elige un servicio, el día y la hora que prefieras.',
  );
  readonly showProducts = computed(() => {
    if (this.productIds().length === 0) return false;
    if (!this.page()) return true;
    return modeSells(this.mode()) && this.blockProps('products')?.enabled !== false;
  });
  readonly productsTitle = computed(
    () => this.text('products', 'title') ?? 'También puedes comprar',
  );
  readonly categories = computed<ServiceCategoryChip[]>(() => serviceCategories(this.services()));
  readonly visibleServices = computed(() =>
    servicesInCategory(this.services(), this.activeCategory()),
  );
  readonly heading = computed(() => {
    const custom = this.text('services', 'title');
    if (custom) return custom;
    const name = this.storeSeo.storeName();
    return name ? `Servicios de ${name}` : 'Nuestros servicios';
  });

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

  duration(service: EcommerceProduct): string | null {
    return formatDuration(service.service_duration_minutes);
  }

  modality(service: EcommerceProduct): string {
    switch (service.service_modality) {
      case 'virtual':
        return 'Virtual';
      case 'hybrid':
        return 'Presencial o virtual';
      default:
        return 'Presencial';
    }
  }

  /** "Qué incluye": the service description as plain text. */
  includes(service: EcommerceProduct): string | null {
    const text = plainDescription(service.description, '');
    return text || null;
  }

  book(service: EcommerceProduct): void {
    // A page that does not book sends the visitor to the service detail.
    this.router.navigate(this.books() ? bookingTarget(service) : ['/products', service.slug]);
  }
}
