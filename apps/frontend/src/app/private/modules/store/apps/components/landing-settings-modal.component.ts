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
import { RouterLink } from '@angular/router';
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
  LandingPageConfig,
  ProductPageCustomDomain,
  StoreAppDetail,
} from '../interfaces/store-app.interface';
import { StoreAppsService } from '../services/store-apps.service';

/** Same limits as the backend (`landing-page.reader.ts`). */
export const MAX_OFFER_TITLE = 120;
export const MAX_OFFER_DESCRIPTION = 400;

/** Route of the existing landing editor ("Landing de captación"), unchanged. */
export const LANDING_EDITOR_ROUTE = '/admin/customers/crm';

interface PickedItem {
  id: number;
  name: string;
}

/**
 * Apps · landing page settings (Fase 6): the landing made in "Landing de
 * captación" published on its own domain, with an offer block. The owner
 * picks the offer mode (informative: only captures the lead; product: one
 * product with a buy button through the shared cart and checkout), the
 * domain, and publishes or unpublishes. The server re-validates every rule
 * (published landing content, product sold online).
 */
@Component({
  selector: 'app-landing-settings-modal',
  standalone: true,
  imports: [ModalComponent, IconComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      title="Landing page"
      subtitle="Tu landing de captación en su propio dominio, con una oferta y los leads directo al CRM."
      size="lg"
    >
      @if (loading()) {
        <p class="text-sm text-[var(--color-text-secondary)]">Cargando…</p>
      } @else {
        <div class="space-y-5 text-sm" data-testid="landing-settings">
          <div class="rounded-lg border border-[var(--color-border)] p-3">
            <p class="text-[var(--color-text-primary)]">
              Estado: <strong>{{ statusLabel() }}</strong>
            </p>
            @if (detail()?.public_url; as url) {
              <p class="mt-1 text-[var(--color-text-secondary)]">
                Publicada en
                <a [href]="url" target="_blank" rel="noopener noreferrer"
                   class="text-[var(--color-primary)] hover:underline" data-testid="landing-url">{{ url }}</a>
              </p>
            }
            <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
              El contenido de la landing se crea y se edita en
              <a [routerLink]="editorRoute" class="text-[var(--color-primary)] hover:underline" (click)="isOpen.set(false)">Landing de captación</a>.
              Cada contacto llega al Pipeline del CRM con el origen, la oferta y la fecha.
            </p>
          </div>

          <section>
            <h3 class="font-semibold text-[var(--color-text-primary)]">Oferta</h3>
            <label class="mt-2 flex items-start gap-2">
              <input type="radio" name="lp-mode" data-testid="landing-mode-info"
                     [checked]="mode() === 'info'" (change)="mode.set('info')" />
              <span>
                Oferta informativa
                <span class="block text-xs text-[var(--color-text-secondary)]">Solo capta el lead con el formulario de la landing.</span>
              </span>
            </label>
            <label class="mt-2 flex items-start gap-2">
              <input type="radio" name="lp-mode" data-testid="landing-mode-product"
                     [checked]="mode() === 'product'" (change)="mode.set('product')" />
              <span>
                Oferta con producto
                <span class="block text-xs text-[var(--color-text-secondary)]">Un producto con botón de compra, con el carrito y el checkout de la tienda.</span>
              </span>
            </label>

            <label class="mt-3 block">
              <span class="text-xs text-[var(--color-text-secondary)]">Título de la oferta ({{ title().length }}/{{ maxTitle }})</span>
              <input type="text" class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                     [attr.maxlength]="maxTitle" data-testid="landing-offer-title"
                     placeholder="Vacío: el nombre del producto o «Déjanos tus datos y te contactamos»"
                     [value]="title()" (input)="title.set($any($event.target).value)" />
            </label>
            <label class="mt-3 block">
              <span class="text-xs text-[var(--color-text-secondary)]">Descripción ({{ description().length }}/{{ maxDescription }})</span>
              <textarea rows="3" class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                        [attr.maxlength]="maxDescription" data-testid="landing-offer-description"
                        [value]="description()" (input)="description.set($any($event.target).value)"></textarea>
            </label>

            @if (mode() === 'product') {
              <div class="mt-3" data-testid="landing-product">
                <span class="text-xs text-[var(--color-text-secondary)]">Producto de la oferta</span>
                @if (product(); as p) {
                  <p class="mt-1 inline-flex items-center gap-1 rounded-full bg-[var(--color-background)] px-3 py-1">
                    {{ p.name }}
                    <button type="button" [attr.aria-label]="'Quitar ' + p.name" (click)="product.set(null)">
                      <app-icon name="x" [size]="12" />
                    </button>
                  </p>
                } @else {
                  <input type="search" class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                         placeholder="Busca un producto por nombre o SKU" data-testid="landing-product-search"
                         [value]="query()" (input)="query.set($any($event.target).value)" />
                }
                @if (results().length > 0) {
                  <ul class="mt-2 max-h-56 overflow-auto rounded-lg border border-[var(--color-border)]" data-testid="landing-search-results">
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
              </div>
            }
          </section>

          <section>
            <h3 class="font-semibold text-[var(--color-text-primary)]">Dominio</h3>
            <label class="mt-2 flex items-start gap-2">
              <input type="radio" name="lp-domain" [checked]="customDomainId() === null" (change)="customDomainId.set(null)" />
              <span>
                Dirección de Vendix para tu landing
                <span class="block text-xs text-[var(--color-text-secondary)]">Por ejemplo: tutienda-landing.vendix.online</span>
              </span>
            </label>
            @for (d of customDomains(); track d.id) {
              <label class="mt-2 flex items-start gap-2">
                <input type="radio" name="lp-domain" [checked]="customDomainId() === d.id" (change)="customDomainId.set(d.id)" />
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
        @if (hasOwnDomain()) {
          <button type="button" class="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
                  [disabled]="busy()" (click)="unpublish()" data-testid="landing-unpublish">Despublicar</button>
        }
        <button type="button" class="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
                [disabled]="busy() || loading()" (click)="save(false)" data-testid="landing-save">Guardar</button>
        <button type="button" class="rounded-lg bg-[var(--color-primary)] px-3 py-2 text-sm font-semibold text-[var(--color-text-on-primary)] disabled:opacity-50"
                [disabled]="busy() || loading()" (click)="save(true)" data-testid="landing-publish">
          {{ hasOwnDomain() ? 'Guardar y volver a publicar' : 'Publicar' }}
        </button>
      </div>
    </app-modal>
  `,
})
export class LandingSettingsModalComponent {
  private readonly appsService = inject(StoreAppsService);
  private readonly productsService = inject(ProductsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model(false);
  /** Emitted after a save, publish or unpublish, so the catalog reloads. */
  readonly changed = output<void>();

  readonly maxTitle = MAX_OFFER_TITLE;
  readonly maxDescription = MAX_OFFER_DESCRIPTION;
  readonly editorRoute = LANDING_EDITOR_ROUTE;

  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly detail = signal<StoreAppDetail | null>(null);
  readonly customDomains = signal<ProductPageCustomDomain[]>([]);
  readonly mode = signal<'info' | 'product'>('info');
  readonly title = signal('');
  readonly description = signal('');
  readonly product = signal<PickedItem | null>(null);
  readonly customDomainId = signal<number | null>(null);
  readonly query = signal('');
  readonly results = signal<Product[]>([]);

  /**
   * Published on its own domain. A landing the Fase 0 backfill marked
   * published has no domain yet: it lives on `{tienda}-store` only.
   */
  readonly hasOwnDomain = computed(
    () => this.detail()?.status === 'published' && !!this.detail()?.domain,
  );

  readonly statusLabel = computed(() => {
    const status = this.detail()?.status;
    if (status === 'published') {
      return this.hasOwnDomain()
        ? 'Publicada en su dominio'
        : 'Publicada en Landing de captación, sin dominio propio';
    }
    if (status === 'draft') return 'Borrador';
    if (status === 'disabled') return 'Despublicada';
    return 'Sin configurar';
  });

  constructor() {
    effect(() => {
      if (this.isOpen()) untracked(() => this.load());
    });

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
                  map((res) => res.data ?? []),
                  catchError(() => of([] as Product[])),
                ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((products) => this.results.set(products));
  }

  pick(product: Product): void {
    this.product.set({ id: product.id, name: product.name });
    this.query.set('');
    this.results.set([]);
  }

  save(publish: boolean): void {
    if (this.mode() === 'product' && !this.product()) {
      this.error.set('Elige el producto de la oferta.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.appsService
      .saveLandingConfig({
        offer_mode: this.mode(),
        offer_title: this.title().trim() || null,
        offer_description: this.description().trim() || null,
        offer_product_id: this.mode() === 'product' ? (this.product()?.id ?? null) : null,
      })
      .pipe(
        switchMap(() =>
          publish ? this.appsService.publishLanding(this.customDomainId()) : of(null),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success(publish ? 'Landing publicada en su dominio' : 'Oferta de la landing guardada');
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
      .unpublishLanding()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Landing despublicada de su dominio');
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
      detail: this.appsService.get('landing').pipe(map((res) => res.data)),
      domains: this.appsService.landingCustomDomains().pipe(
        map((res) => res.data ?? []),
        catchError(() => of([] as ProductPageCustomDomain[])),
      ),
    })
      .pipe(
        switchMap(({ detail, domains }) => {
          const config = detail.config as Partial<LandingPageConfig>;
          const productId =
            config.offer_mode === 'product' && typeof config.offer_product_id === 'number'
              ? config.offer_product_id
              : null;
          const product$ = productId
            ? this.productsService.getProductById(productId).pipe(catchError(() => of(null)))
            : of(null);
          return product$.pipe(map((product) => ({ detail, domains, config, product })));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ detail, domains, config, product }) => {
          this.detail.set(detail);
          this.customDomains.set(domains);
          this.mode.set(config.offer_mode === 'product' ? 'product' : 'info');
          this.title.set(config.offer_title ?? '');
          this.description.set(config.offer_description ?? '');
          this.product.set(product ? { id: product.id, name: product.name } : null);
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
