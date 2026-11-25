import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { plainDescription } from '../../private/modules/ecommerce/services/store-seo';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { CurrencyPipe } from '../../shared/pipes/currency';
import {
  AppPageDocument,
  effectiveMode,
  modeBooks,
  modeSells,
} from '../../private/modules/store/apps/templates/app-page.types';
import { AppPageViewComponent } from '../app-page/app-page-view.component';
import { AppPageProductsViewComponent } from '../app-page/app-page-products-view.component';
import {
  AppPageProductItem,
  AppPageProductVariant,
  blockProductIds,
  blockProductsLayout,
  blockProductsSelection,
  blockShowVariants,
} from '../app-page/app-page-products.util';
import { ProductComplementsComponent } from '../product-page/components/product-complements.component';
import {
  ServiceCardData,
  ServiceCategoryChip,
  bookingLabel,
  bookingTarget,
  formatDuration,
  serviceCategories,
  servicesInCategory,
} from './service-page.util';

/**
 * The service list of a service page as it is drawn (F6-B): the owner's
 * hero, the services (category filter, cards with duration, price and what
 * they include), the owner's blocks and the products block. The public home
 * (`ServicePageHomeComponent`) feeds it the ecommerce catalog; the editor's
 * preview feeds it the draft and the services the server read.
 *
 * `blockIds` (off on the public page: no extra attributes) marks the hero and
 * each section with `data-block-id` for the editor's preview. `previewProducts`
 * (editor only) draws the products block from plain data instead of loading
 * the ecommerce cards.
 */
@Component({
  selector: 'app-service-page-home-view',
  standalone: true,
  imports: [RouterModule, IconComponent, CurrencyPipe, ProductComplementsComponent, AppPageViewComponent, AppPageProductsViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
  @if (page()) {
    <app-app-page-view kind="service_page" [page]="page()" part="hero" [blockIds]="blockIds()" />
  }
  @if (showServices()) {
  <section class="mx-auto w-full max-w-6xl px-4 pb-4 pt-8" [attr.id]="page() ? 'app-page-main' : null" [attr.data-block-id]="servicesBlockId()">
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

  <section class="mx-auto grid w-full max-w-6xl gap-4 px-4 pb-10 md:grid-cols-2" aria-label="Servicios" data-testid="service-list" [attr.data-block-id]="servicesBlockId()">
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
              {{ bookingLabel(service, books()) }}
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
    <app-app-page-view kind="service_page" [page]="page()" part="blocks" [blockIds]="blockIds()" />
  }

  @if (showProducts()) {
    <div class="border-t border-border bg-surface-secondary/40" data-testid="service-page-products" [attr.data-block-id]="productsBlockId()">
      @if (previewProducts(); as picked) {
        @if (hasAdvancedProductsProps()) {
          <section class="mx-auto w-full max-w-6xl px-4 py-6">
            <app-page-products-view
              [title]="productsTitle()"
              [selection]="productsSelection()"
              [productIds]="productsManualIds()"
              [autoProductIds]="productIds()"
              [showVariants]="productsShowVariants()"
              [layout]="productsLayout()"
              [preview]="true"
              [previewItems]="resolvedPreviewCatalog()"
              [compact]="true"
            />
          </section>
        } @else {
          <section class="mx-auto w-full max-w-6xl px-4 py-6" data-testid="preview-products">
            <h2 class="mb-3 text-lg font-semibold text-text-primary">{{ productsTitle() }}</h2>
            <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
              @for (item of picked; track item.id) {
                <article class="overflow-hidden rounded-xl border border-border bg-surface">
                  <div class="aspect-square bg-surface-secondary">
                    @if (item.image_url) {
                      <img [src]="item.image_url" [alt]="item.name" class="h-full w-full object-cover" />
                    }
                  </div>
                  <p class="truncate px-3 py-2 text-sm font-medium text-text-primary">{{ item.name }}</p>
                </article>
              }
            </div>
          </section>
        }
      } @else if (hasAdvancedProductsProps()) {
        <section class="mx-auto w-full max-w-6xl px-4 py-8">
          <app-page-products-view
            [title]="productsTitle()"
            [selection]="productsSelection()"
            [productIds]="productsManualIds()"
            [autoProductIds]="productIds()"
            [showVariants]="productsShowVariants()"
            [layout]="productsLayout()"
            [compact]="true"
          />
        </section>
      } @else {
        <app-product-complements [productIds]="productIds()" [title]="productsTitle()" [compact]="true" />
      }
    </div>
  }
  `,
})
export class ServicePageHomeViewComponent {
  private readonly router = inject(Router);

  readonly activeChip = 'border-primary bg-primary text-white';
  readonly idleChip = 'border-border bg-surface text-text-primary';

  readonly services = input<ServiceCardData[]>([]);
  readonly featuredIds = input<number[]>([]);
  readonly productIds = input<number[]>([]);
  /** The owner's own page; `null` keeps the page exactly as it was (apps-f2 S5). */
  readonly page = input<AppPageDocument | null>(null);
  readonly storeName = input<string | null>(null);
  readonly blockIds = input(false);
  readonly previewProducts = input<
    | {
        id: number;
        name: string;
        image_url: string | null;
        slug?: string;
        final_price?: number;
        regular_final_price?: number | null;
        is_on_sale?: boolean;
        variants?: AppPageProductVariant[];
      }[]
    | null
  >(null);
  /** Catálogo pre-resuelto para vista previa del bloque `products` (incluye selección manual y variantes). */
  readonly previewCatalogProducts = input<readonly AppPageProductItem[] | null>(null);

  readonly activeCategory = signal<number | null>(null);
  readonly featured = computed(() => new Set(this.featuredIds()));

  private readonly mode = computed(() => effectiveMode('service_page', this.page()));
  /** Booking buttons only when the mode books (always, with no saved page). */
  readonly books = computed(() => !this.page() || modeBooks(this.mode()));
  private blockProps(type: string): { id: string; enabled: boolean; props: Record<string, unknown> } | null {
    const block = this.page()?.blocks.find((b) => b.type === type);
    return block ? { id: block.id, enabled: block.enabled, props: block.props } : null;
  }
  private text(type: string, key: string): string | null {
    const v = this.blockProps(type)?.props[key];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }
  readonly servicesBlockId = computed(() => (this.blockIds() ? (this.blockProps('services')?.id ?? null) : null));
  readonly productsBlockId = computed(() => (this.blockIds() ? (this.blockProps('products')?.id ?? null) : null));
  readonly showServices = computed(() => this.blockProps('services')?.enabled !== false);
  readonly showDuration = computed(() => this.blockProps('services')?.props['show_duration'] !== false);
  readonly showPrice = computed(() => this.blockProps('services')?.props['show_price'] !== false);
  readonly subheading = computed(
    () => this.text('services', 'subtitle') ?? 'Elige un servicio, el día y la hora que prefieras.',
  );
  readonly productsSelection = computed(() => blockProductsSelection(this.blockProps('products')?.props ?? {}));
  readonly productsManualIds = computed(() => blockProductIds(this.blockProps('products')?.props ?? {}));
  readonly productsLayout = computed(() => blockProductsLayout(this.blockProps('products')?.props ?? {}));
  readonly productsShowVariants = computed(() => blockShowVariants(this.blockProps('products')?.props ?? {}));
  readonly hasAdvancedProductsProps = computed(
    () =>
      this.productsSelection() === 'manual' ||
      this.productsShowVariants() ||
      this.productsLayout() !== null,
  );
  readonly effectiveProductIds = computed(() =>
    this.productsSelection() === 'manual' ? this.productsManualIds() : this.productIds(),
  );
  readonly resolvedPreviewCatalog = computed<AppPageProductItem[]>(() => {
    const byId = new Map<number, AppPageProductItem>();
    for (const item of this.previewProducts() ?? []) {
      byId.set(item.id, {
        id: item.id,
        slug: item.slug ?? String(item.id),
        name: item.name,
        image_url: item.image_url,
        final_price: item.final_price ?? 0,
        regular_final_price: item.regular_final_price ?? null,
        is_on_sale: Boolean(item.is_on_sale),
        variants: item.variants ?? [],
      });
    }
    for (const item of this.previewCatalogProducts() ?? []) {
      byId.set(item.id, item);
    }
    return Array.from(byId.values());
  });
  readonly showProducts = computed(() => {
    const enabled = !this.page() || (modeSells(this.mode()) && this.blockProps('products')?.enabled !== false);
    if (!enabled) return false;
    if (this.previewProducts() !== null && this.productsSelection() === 'manual') return true;
    return this.effectiveProductIds().length > 0;
  });
  readonly productsTitle = computed(() => this.text('products', 'title') ?? 'También puedes comprar');
  readonly categories = computed<ServiceCategoryChip[]>(() => serviceCategories(this.services()));
  readonly visibleServices = computed(() => servicesInCategory(this.services(), this.activeCategory()));
  readonly heading = computed(() => {
    const custom = this.text('services', 'title');
    if (custom) return custom;
    const name = this.storeName();
    return name ? `Servicios de ${name}` : 'Nuestros servicios';
  });

  duration(service: ServiceCardData): string | null {
    return formatDuration(service.service_duration_minutes, service.service_duration_unit);
  }

  modality(service: ServiceCardData): string {
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
  includes(service: ServiceCardData): string | null {
    const text = plainDescription(service.description, '');
    return text || null;
  }

  readonly bookingLabel = bookingLabel;

  book(service: ServiceCardData): void {
    // A page that does not book sends the visitor to the service detail.
    this.router.navigate(this.books() ? bookingTarget(service) : ['/products', service.slug]);
  }
}
