import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { forkJoin, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';

import { parseApiError } from '../../../../../core/utils/parse-api-error';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { ProductsService } from '../../products/services/products.service';
import type { Product } from '../../products/interfaces/product.interface';
import {
  ProductPageCustomDomain,
  ServicePageConfig,
  StoreAppDetail,
} from '../interfaces/store-app.interface';
import { StoreAppsService } from '../services/store-apps.service';

/** Same limits as the backend (`service-page.reader.ts`). */
export const MAX_FEATURED_SERVICES = 12;
export const MAX_SECONDARY_PRODUCTS = 8;

interface PickedItem {
  id: number;
  name: string;
}

type SearchTarget = 'service' | 'product';

/**
 * Apps · service page settings (Fase 3): featured services (shown first),
 * the secondary products block, the domain, publish and unpublish.
 * Every online service of the store is listed on the page; featuring only
 * changes the order. The server re-validates every rule; this screen only
 * explains them before the user hits them.
 */
@Component({
  selector: 'app-service-page-settings-modal',
  standalone: true,
  imports: [ModalComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      title="Página de servicios"
      subtitle="Tus servicios con reserva en línea, en su propio dominio."
      size="lg"
    >
      @if (loading()) {
        <p class="text-sm text-[var(--color-text-secondary)]">Cargando…</p>
      } @else {
        <div class="space-y-5 text-sm" data-testid="service-page-settings">
          <div class="rounded-lg border border-[var(--color-border)] p-3">
            <p class="text-[var(--color-text-primary)]">
              Estado: <strong>{{ statusLabel() }}</strong>
            </p>
            @if (detail()?.public_url; as url) {
              <p class="mt-1 text-[var(--color-text-secondary)]">
                Publicada en
                <a [href]="url" target="_blank" rel="noopener noreferrer"
                   class="text-[var(--color-primary)] hover:underline" data-testid="service-page-url">{{ url }}</a>
              </p>
            }
            <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
              La página muestra todos tus servicios que se venden en línea, con sus categorías. Los clientes eligen día y hora con tu agenda actual.
            </p>
          </div>

          <!-- Servicios destacados -->
          <section>
            <h3 class="font-semibold text-[var(--color-text-primary)]">
              Servicios destacados
              <span class="font-normal text-[var(--color-text-secondary)]">({{ services().length }}/{{ maxServices }})</span>
            </h3>
            <p class="text-xs text-[var(--color-text-secondary)]">Aparecen primero, en este orden.</p>
            @if (services().length > 0) {
              <ul class="mt-2 flex flex-wrap gap-2" data-testid="featured-services">
                @for (s of services(); track s.id) {
                  <li class="inline-flex items-center gap-1 rounded-full bg-[var(--color-background)] px-3 py-1">
                    {{ s.name }}
                    <button type="button" [attr.aria-label]="'Quitar ' + s.name" (click)="remove('service', s.id)">
                      <app-icon name="x" [size]="12" />
                    </button>
                  </li>
                }
              </ul>
            }
            @if (services().length < maxServices) {
              <input type="search" class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                     placeholder="Busca un servicio por nombre" data-testid="service-search"
                     [value]="serviceQuery()" (input)="search('service', $any($event.target).value)" />
            }
          </section>

          <!-- Productos secundarios -->
          <section>
            <h3 class="font-semibold text-[var(--color-text-primary)]">
              También puedes comprar
              <span class="font-normal text-[var(--color-text-secondary)]">({{ products().length }}/{{ maxProducts }})</span>
            </h3>
            <p class="text-xs text-[var(--color-text-secondary)]">Productos que se muestran debajo de los servicios, con el mismo carrito.</p>
            @if (products().length > 0) {
              <ul class="mt-2 flex flex-wrap gap-2" data-testid="secondary-products">
                @for (p of products(); track p.id) {
                  <li class="inline-flex items-center gap-1 rounded-full bg-[var(--color-background)] px-3 py-1">
                    {{ p.name }}
                    <button type="button" [attr.aria-label]="'Quitar ' + p.name" (click)="remove('product', p.id)">
                      <app-icon name="x" [size]="12" />
                    </button>
                  </li>
                }
              </ul>
            }
            @if (products().length < maxProducts) {
              <input type="search" class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                     placeholder="Busca un producto por nombre o SKU" data-testid="product-search"
                     [value]="productQuery()" (input)="search('product', $any($event.target).value)" />
            }
          </section>

          @if (results().length > 0) {
            <ul class="max-h-56 overflow-auto rounded-lg border border-[var(--color-border)]" data-testid="search-results">
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

          <!-- Dominio -->
          <section>
            <h3 class="font-semibold text-[var(--color-text-primary)]">Dominio</h3>
            <label class="mt-2 flex items-start gap-2">
              <input type="radio" name="sp-domain" [checked]="customDomainId() === null" (change)="customDomainId.set(null)" />
              <span>
                Dirección de Vendix para tus servicios
                <span class="block text-xs text-[var(--color-text-secondary)]">Por ejemplo: tutienda-service.vendix.online</span>
              </span>
            </label>
            @for (d of customDomains(); track d.id) {
              <label class="mt-2 flex items-start gap-2">
                <input type="radio" name="sp-domain" [checked]="customDomainId() === d.id" (change)="customDomainId.set(d.id)" />
                <span>{{ d.hostname }} <span class="text-xs text-[var(--color-text-secondary)]">(tu dominio)</span></span>
              </label>
            }
          </section>

          @if (error()) {
            <p class="rounded-lg bg-[var(--color-background)] p-3 text-[var(--color-error,#b91c1c)]" role="alert">{{ error() }}</p>
          }
        </div>
      }

      <div slot="footer" class="flex flex-wrap justify-end gap-2">
        @if (isPublished()) {
          <button type="button" class="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
                  [disabled]="busy()" (click)="unpublish()" data-testid="service-page-unpublish">Despublicar</button>
        }
        <button type="button" class="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
                [disabled]="busy() || loading()" (click)="save(false)">Guardar</button>
        <button type="button" class="rounded-lg bg-[var(--color-primary)] px-3 py-2 text-sm font-semibold text-[var(--color-text-on-primary)] disabled:opacity-50"
                [disabled]="busy() || loading()" (click)="save(true)" data-testid="service-page-publish">
          {{ isPublished() ? 'Guardar y volver a publicar' : 'Publicar' }}
        </button>
      </div>
    </app-modal>
  `,
})
export class ServicePageSettingsModalComponent {
  private readonly appsService = inject(StoreAppsService);
  private readonly productsService = inject(ProductsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model(false);
  /** Emitted after a save, publish or unpublish, so the catalog reloads. */
  readonly changed = output<void>();

  readonly maxServices = MAX_FEATURED_SERVICES;
  readonly maxProducts = MAX_SECONDARY_PRODUCTS;

  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly detail = signal<StoreAppDetail | null>(null);
  readonly customDomains = signal<ProductPageCustomDomain[]>([]);

  readonly services = signal<PickedItem[]>([]);
  readonly products = signal<PickedItem[]>([]);
  readonly customDomainId = signal<number | null>(null);

  readonly serviceQuery = signal('');
  readonly productQuery = signal('');
  private readonly searchTarget = signal<SearchTarget>('service');
  private readonly searchTerm = signal('');
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

  constructor() {
    effect(() => {
      if (this.isOpen()) untracked(() => this.load());
    });

    toObservable(computed(() => ({ term: this.searchTerm(), target: this.searchTarget() })))
      .pipe(
        debounceTime(300),
        distinctUntilChanged((a, b) => a.term === b.term && a.target === b.target),
        switchMap(({ term, target }) =>
          term.trim().length < 2
            ? of([] as Product[])
            : this.productsService
                .getProducts({
                  search: term.trim(),
                  limit: 10,
                  state: 'active' as Product['state'],
                  ...(target === 'service' ? { product_type: 'service' as const } : {}),
                })
                .pipe(
                  // Services go in their own list; the secondary block sells products.
                  map((res) =>
                    (res.data ?? []).filter((p) =>
                      target === 'service'
                        ? p.product_type === 'service'
                        : p.product_type !== 'service',
                    ),
                  ),
                  catchError(() => of([] as Product[])),
                ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((products) => this.results.set(products));
  }

  search(target: SearchTarget, term: string): void {
    this.searchTarget.set(target);
    (target === 'service' ? this.serviceQuery : this.productQuery).set(term);
    this.searchTerm.set(term);
  }

  pick(product: Product): void {
    const picked: PickedItem = { id: product.id, name: product.name };
    const [list, max] =
      this.searchTarget() === 'service'
        ? [this.services, MAX_FEATURED_SERVICES]
        : [this.products, MAX_SECONDARY_PRODUCTS];
    if (!list().some((i) => i.id === picked.id) && list().length < max) {
      list.update((items) => [...items, picked]);
    }
    this.serviceQuery.set('');
    this.productQuery.set('');
    this.searchTerm.set('');
    this.results.set([]);
  }

  remove(target: SearchTarget, id: number): void {
    (target === 'service' ? this.services : this.products).update((items) =>
      items.filter((i) => i.id !== id),
    );
  }

  save(publish: boolean): void {
    this.busy.set(true);
    this.error.set(null);

    const body = {
      featured_service_ids: this.services().map((s) => s.id),
      product_ids: this.products().map((p) => p.id),
    };
    this.appsService
      .saveServicePageConfig(body)
      .pipe(
        switchMap(() =>
          publish ? this.appsService.publishServicePage(this.customDomainId()) : of(null),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success(publish ? 'Página de servicios publicada' : 'Página de servicios guardada');
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
      .unpublishServicePage()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Página de servicios despublicada');
          this.busy.set(false);
          this.changed.emit();
          this.load();
        },
        error: (err) => this.fail(err),
      });
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    forkJoin({
      detail: this.appsService.get('service_page').pipe(map((res) => res.data)),
      domains: this.appsService.servicePageCustomDomains().pipe(
        map((res) => res.data ?? []),
        catchError(() => of([] as ProductPageCustomDomain[])),
      ),
    })
      .pipe(
        switchMap(({ detail, domains }) => {
          const config = detail.config as Partial<ServicePageConfig>;
          const serviceIds = Array.isArray(config.featured_service_ids) ? config.featured_service_ids : [];
          const productIds = Array.isArray(config.product_ids) ? config.product_ids : [];
          const ids = [...serviceIds, ...productIds];
          const items$ = ids.length
            ? forkJoin(
                ids.map((id) =>
                  this.productsService.getProductById(id).pipe(catchError(() => of(null))),
                ),
              )
            : of([] as (Product | null)[]);
          return items$.pipe(
            map((items) => ({ detail, domains, serviceIds, productIds, items })),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ detail, domains, serviceIds, productIds, items }) => {
          const byId = new Map(
            items
              .filter((p): p is Product => !!p)
              .map((p) => [p.id, { id: p.id, name: p.name }]),
          );
          const pickAll = (ids: number[]) =>
            ids.map((id) => byId.get(id)).filter((p): p is PickedItem => !!p);
          this.detail.set(detail);
          this.customDomains.set(domains);
          this.services.set(pickAll(serviceIds));
          this.products.set(pickAll(productIds));
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
