import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { complementsTitleOf } from '../../../../../../public/product-page/product-page-view.component';
import type { Product } from '../../../products/interfaces/product.interface';
import type { ProductsService } from '../../../products/services/products.service';
import type { BuilderCategory } from '../../builder/builder.types';
import type { ProductPageConfig, StoreAppDetail } from '../../interfaces/store-app.interface';
import type { StoreAppsService } from '../../services/store-apps.service';
import type { AppPageDocument } from '../../templates';
import { PageBlockMeta, emptyPage, pageBuilderCatalog, storedPage } from '../page-builder-document';
import type { AppPageBuilderAdapter, AppPagePreviewPayload } from '../page-builder.types';

/** Same limit as the backend (`MAX_COMPLEMENTS`). */
export const MAX_PRODUCT_PAGE_COMPLEMENTS = 8;

/** A product the owner picked (featured or complement). */
export interface PickedProduct {
  id: number;
  name: string;
  slug: string;
}

/** What General edits of the product page besides the page: the featured product and its complements. */
export interface ProductPageSettings {
  product: PickedProduct | null;
  complements: PickedProduct[];
}

/** Catalog data the page paints (`GET /store/apps/product_page/preview-context`). */
export interface ProductPageContext {
  product: {
    id: number;
    slug: string;
    name: string;
    description: string | null;
    image_url: string | null;
    variants: { id: number; name: string }[];
  } | null;
  complements: { id: number; slug: string; name: string; image_url: string | null }[];
}

export const EMPTY_PRODUCT_PAGE_CONTEXT: ProductPageContext = { product: null, complements: [] };

const CATEGORIES: readonly BuilderCategory[] = [
  { id: 'product', label: 'Producto' },
  { id: 'trust', label: 'Confianza' },
  { id: 'sales', label: 'Venta' },
];

/**
 * The product page is the featured product (the store's own detail, always
 * first) with the owner's blocks around it. The layout draws «Complementos»
 * right under the product, before the rest of the sections, and shows it
 * whenever there are complements unless the block is hidden: so it is pinned
 * there and cannot be removed (only hidden), as the public page does today.
 */
const META: Record<string, PageBlockMeta> = {
  benefits: { category: 'product' },
  how_it_works: { category: 'product' },
  specifications: { category: 'product' },
  gallery: { category: 'product' },
  testimonials: { category: 'trust' },
  shipping_warranty: { category: 'trust' },
  faq: { category: 'trust' },
  complements: {
    category: 'sales',
    pinned: 'start',
    removable: false,
    liveData: 'Los productos complementarios que elegiste en General.',
  },
  cta: { category: 'sales' },
};

export const PRODUCT_PAGE_BUILDER_CATALOG = pageBuilderCatalog('product_page', CATEGORIES, META);

/** The product (or complement) as the preview draws it: the real catalog row when it has one, else only its name. */
export interface ProductPagePreview {
  page: AppPageDocument;
  storeName: string;
  storeLogoUrl: string | null;
  product: { name: string; description: string | null; image_url: string | null; variants: { id: number; name: string }[] } | null;
  complements: { id: number; name: string; image_url: string | null }[];
  /** As the public layout: complements exist and the block is not hidden. */
  showComplements: boolean;
  complementsTitle: string;
  /** Id of the «Complementos» block, to select it from the preview; `null` when the page has none. */
  complementsBlockId: string | null;
}

/**
 * The product page the public layout would draw with this draft: the page,
 * the featured product and complements of General (with the catalog data the
 * server gave for the ones it knows) and the complements section only when
 * the layout shows it.
 */
export function productPagePreview(
  payload: AppPagePreviewPayload<ProductPageSettings | null, ProductPageContext | null>,
): ProductPagePreview {
  const context = payload.context ?? EMPTY_PRODUCT_PAGE_CONTEXT;
  const settings = payload.settings;
  const page = payload.page;
  const picked = settings?.product ?? null;
  const known = context.product && context.product.id === picked?.id ? context.product : null;
  const product = picked
    ? { name: picked.name, description: known?.description ?? null, image_url: known?.image_url ?? null, variants: known?.variants ?? [] }
    : null;
  const complements = (settings?.complements ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    image_url: context.complements.find((k) => k.id === c.id)?.image_url ?? null,
  }));
  const block = page.blocks.find((b) => b.type === 'complements');
  return {
    page,
    storeName: payload.storeName,
    storeLogoUrl: payload.storeLogoUrl,
    product,
    complements,
    showComplements: !!product && complements.length > 0 && block?.enabled !== false,
    complementsTitle: complementsTitleOf(page),
    complementsBlockId: block?.id ?? null,
  };
}

export function productPageBuilderAdapter(
  apps: StoreAppsService,
  products: ProductsService,
): AppPageBuilderAdapter<ProductPageSettings, ProductPageContext> {
  return {
    kind: 'product_page',
    icon: 'package',
    noun: 'la página de producto',
    publishedToast: 'Página de producto publicada',
    catalog: PRODUCT_PAGE_BUILDER_CATALOG,
    addressHint: 'Dirección de Vendix creada a partir de la tienda y el producto (por ejemplo tutienda-tuproducto.vendix.online).',
    emptyContext: EMPTY_PRODUCT_PAGE_CONTEXT,
    // Without a saved page the public page draws only the product and its complements: so does an empty one.
    initialPage: (detail: StoreAppDetail) => storedPage(detail.config) ?? emptyPage(),
    settings$: (detail: StoreAppDetail) => resolveSettings(products, (detail.config ?? {}) as Partial<ProductPageConfig>),
    saveSettings$: (settings) =>
      settings.product
        ? apps.saveProductPageConfig({
            product_id: settings.product.id,
            complement_product_ids: settings.complements.map((c) => c.id),
          })
        : of(null),
    context$: () => apps.productPagePreviewContext().pipe(map((res) => res.data ?? EMPTY_PRODUCT_PAGE_CONTEXT)),
    domains$: () => apps.productPageCustomDomains().pipe(map((res) => res.data ?? [])),
    publishBlocker: (settings) => (settings.product ? null : 'Elige el producto destacado en General para publicar.'),
    publish$: (customDomainId) => apps.publishProductPage(customDomainId),
    unpublish$: () => apps.unpublishProductPage(),
  };
}

/** The stored product ids as names (a product that cannot be read is left out). */
function resolveSettings(products: ProductsService, config: Partial<ProductPageConfig>): Observable<ProductPageSettings> {
  const complementIds = Array.isArray(config.complement_product_ids) ? config.complement_product_ids : [];
  const ids = [...(typeof config.product_id === 'number' ? [config.product_id] : []), ...complementIds];
  if (!ids.length) return of({ product: null, complements: [] });
  return forkJoin(ids.map((id) => products.getProductById(id).pipe(catchError(() => of(null))))).pipe(
    map((rows) => {
      const byId = new Map(
        rows.filter((p): p is Product => !!p).map((p) => [p.id, { id: p.id, name: p.name, slug: p.slug } as PickedProduct]),
      );
      return {
        product: typeof config.product_id === 'number' ? (byId.get(config.product_id) ?? null) : null,
        complements: complementIds.map((id) => byId.get(id)).filter((p): p is PickedProduct => !!p),
      };
    }),
  );
}
