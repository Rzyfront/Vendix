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
  ProductPageConfig,
  ProductPageCustomDomain,
  StoreAppDetail,
} from '../interfaces/store-app.interface';
import { StoreAppsService } from '../services/store-apps.service';

const MAX_COMPLEMENTS = 8;

interface PickedProduct {
  id: number;
  name: string;
  slug: string;
}

type SearchTarget = 'featured' | 'complement';

/**
 * Apps · product page settings (Fase 2): featured product, up to 8
 * complements, the domain it is published on, publish and unpublish.
 * The server re-validates every rule (sellable online, limits, domain
 * ownership); this screen only explains them before the user hits them.
 */
@Component({
  selector: 'app-product-page-settings-modal',
  standalone: true,
  imports: [ModalComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      title="Página de producto"
      subtitle="Un producto con su propio dominio, carrito y pago."
      size="lg"
    >
      @if (loading()) {
        <p class="text-sm text-[var(--color-text-secondary)]">Cargando…</p>
      } @else {
        <div class="space-y-5 text-sm" data-testid="product-page-settings">
          <!-- Estado -->
          <div class="rounded-lg border border-[var(--color-border)] p-3">
            <p class="text-[var(--color-text-primary)]">
              Estado: <strong>{{ statusLabel() }}</strong>
            </p>
            @if (detail()?.public_url; as url) {
              <p class="mt-1 text-[var(--color-text-secondary)]">
                Publicada en
                <a [href]="url" target="_blank" rel="noopener noreferrer"
                   class="text-[var(--color-primary)] hover:underline" data-testid="product-page-url">{{ url }}</a>
              </p>
            }
          </div>

          <!-- Producto destacado -->
          <section>
            <h3 class="font-semibold text-[var(--color-text-primary)]">Producto destacado</h3>
            @if (featured(); as product) {
              <div class="mt-2 flex items-center justify-between rounded-lg bg-[var(--color-background)] px-3 py-2">
                <span class="truncate" data-testid="featured-name">{{ product.name }}</span>
                @if (!lockFeatured()) {
                  <button type="button" class="text-xs font-semibold text-[var(--color-primary)]"
                          (click)="featured.set(null)">Cambiar</button>
                }
              </div>
              @if (lockFeatured()) {
                <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
                  Despublica la página para cambiar el producto destacado: su dirección se crea a partir de él.
                </p>
              }
            } @else {
              <input type="search" class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                     placeholder="Busca el producto por nombre o SKU" data-testid="featured-search"
                     [value]="featuredQuery()" (input)="search('featured', $any($event.target).value)" />
            }
          </section>

          <!-- Complementos -->
          <section>
            <h3 class="font-semibold text-[var(--color-text-primary)]">
              Complementa tu compra
              <span class="font-normal text-[var(--color-text-secondary)]">({{ complements().length }}/{{ maxComplements }})</span>
            </h3>
            @if (complements().length > 0) {
              <ul class="mt-2 flex flex-wrap gap-2">
                @for (c of complements(); track c.id) {
                  <li class="inline-flex items-center gap-1 rounded-full bg-[var(--color-background)] px-3 py-1">
                    {{ c.name }}
                    <button type="button" [attr.aria-label]="'Quitar ' + c.name" (click)="removeComplement(c.id)">
                      <app-icon name="x" [size]="12" />
                    </button>
                  </li>
                }
              </ul>
            }
            @if (complements().length < maxComplements) {
              <input type="search" class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                     placeholder="Añade productos que se compran junto al destacado" data-testid="complement-search"
                     [value]="complementQuery()" (input)="search('complement', $any($event.target).value)" />
            }
          </section>

          <!-- Resultados de búsqueda -->
          @if (results().length > 0) {
            <ul class="max-h-56 overflow-auto rounded-lg border border-[var(--color-border)]" data-testid="product-results">
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
              <input type="radio" name="pp-domain" [checked]="customDomainId() === null" (change)="customDomainId.set(null)" />
              <span>
                Dirección de Vendix, creada a partir de la tienda y el producto
                <span class="block text-xs text-[var(--color-text-secondary)]">Por ejemplo: tutienda-tuproducto.vendix.online</span>
              </span>
            </label>
            @for (d of customDomains(); track d.id) {
              <label class="mt-2 flex items-start gap-2">
                <input type="radio" name="pp-domain" [checked]="customDomainId() === d.id" (change)="customDomainId.set(d.id)" />
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
                  [disabled]="busy()" (click)="unpublish()" data-testid="product-page-unpublish">Despublicar</button>
        }
        <button type="button" class="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
                [disabled]="busy() || !featured()" (click)="save(false)">Guardar</button>
        <button type="button" class="rounded-lg bg-[var(--color-primary)] px-3 py-2 text-sm font-semibold text-[var(--color-text-on-primary)] disabled:opacity-50"
                [disabled]="busy() || !featured()" (click)="save(true)" data-testid="product-page-publish">
          {{ isPublished() ? 'Guardar y volver a publicar' : 'Publicar' }}
        </button>
      </div>
    </app-modal>
  `,
})
export class ProductPageSettingsModalComponent {
  private readonly appsService = inject(StoreAppsService);
  private readonly productsService = inject(ProductsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model(false);
  /** Emitted after a save, publish or unpublish, so the catalog reloads. */
  readonly changed = output<void>();

  readonly maxComplements = MAX_COMPLEMENTS;

  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly detail = signal<StoreAppDetail | null>(null);
  readonly customDomains = signal<ProductPageCustomDomain[]>([]);

  readonly featured = signal<PickedProduct | null>(null);
  readonly complements = signal<PickedProduct[]>([]);
  readonly customDomainId = signal<number | null>(null);

  readonly featuredQuery = signal('');
  readonly complementQuery = signal('');
  private readonly searchTarget = signal<SearchTarget>('featured');
  private readonly searchTerm = signal('');
  readonly results = signal<Product[]>([]);

  readonly isPublished = computed(() => this.detail()?.status === 'published');

  /** The Vendix hostname is built from the featured product (plan S5). */
  readonly lockFeatured = computed(
    () => this.isPublished() && !this.isOnCustomDomain(),
  );

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

    toObservable(this.searchTerm)
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) =>
          term.trim().length < 2
            ? of([] as Product[])
            : this.productsService
                .getProducts({ search: term.trim(), limit: 10, state: 'active' as Product['state'] })
                .pipe(
                  map((res) => res.data ?? []),
                  catchError(() => of([] as Product[])),
                ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((products) => this.results.set(products));
  }

  search(target: SearchTarget, term: string): void {
    this.searchTarget.set(target);
    (target === 'featured' ? this.featuredQuery : this.complementQuery).set(term);
    this.searchTerm.set(term);
  }

  pick(product: Product): void {
    const picked: PickedProduct = { id: product.id, name: product.name, slug: product.slug };
    if (this.searchTarget() === 'featured') {
      this.featured.set(picked);
      this.complements.update((list) => list.filter((c) => c.id !== picked.id));
    } else if (
      picked.id !== this.featured()?.id &&
      !this.complements().some((c) => c.id === picked.id) &&
      this.complements().length < MAX_COMPLEMENTS
    ) {
      this.complements.update((list) => [...list, picked]);
    }
    this.featuredQuery.set('');
    this.complementQuery.set('');
    this.searchTerm.set('');
    this.results.set([]);
  }

  removeComplement(id: number): void {
    this.complements.update((list) => list.filter((c) => c.id !== id));
  }

  save(publish: boolean): void {
    const featured = this.featured();
    if (!featured) return;
    this.busy.set(true);
    this.error.set(null);

    const body = {
      product_id: featured.id,
      complement_product_ids: this.complements().map((c) => c.id),
    };
    this.appsService
      .saveProductPageConfig(body)
      .pipe(
        switchMap(() =>
          publish ? this.appsService.publishProductPage(this.customDomainId()) : of(null),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success(publish ? 'Página de producto publicada' : 'Página de producto guardada');
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
      .unpublishProductPage()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Página de producto despublicada');
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
      detail: this.appsService.get('product_page').pipe(map((res) => res.data)),
      domains: this.appsService.productPageCustomDomains().pipe(
        map((res) => res.data ?? []),
        catchError(() => of([] as ProductPageCustomDomain[])),
      ),
    })
      .pipe(
        switchMap(({ detail, domains }) => {
          const config = detail.config as Partial<ProductPageConfig>;
          const ids = [
            ...(typeof config.product_id === 'number' ? [config.product_id] : []),
            ...(Array.isArray(config.complement_product_ids) ? config.complement_product_ids : []),
          ];
          const products$ = ids.length
            ? forkJoin(
                ids.map((id) =>
                  this.productsService.getProductById(id).pipe(catchError(() => of(null))),
                ),
              )
            : of([] as (Product | null)[]);
          return products$.pipe(map((products) => ({ detail, domains, config, products })));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ detail, domains, config, products }) => {
          const byId = new Map(
            products
              .filter((p): p is Product => !!p)
              .map((p) => [p.id, { id: p.id, name: p.name, slug: p.slug }]),
          );
          this.detail.set(detail);
          this.customDomains.set(domains);
          this.featured.set(
            typeof config.product_id === 'number' ? (byId.get(config.product_id) ?? null) : null,
          );
          this.complements.set(
            (config.complement_product_ids ?? [])
              .map((id) => byId.get(id))
              .filter((p): p is PickedProduct => !!p),
          );
          // Keep the custom domain the page is on, if any.
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

  private isOnCustomDomain(): boolean {
    const domainId = this.detail()?.domain?.id;
    return domainId != null && this.customDomains().some((d) => d.id === domainId);
  }

  private fail(err: unknown): void {
    this.busy.set(false);
    this.error.set(parseApiError(err).userMessage ?? 'No se pudo completar la acción.');
  }
}
