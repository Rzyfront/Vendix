import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import type { ServiceCardData } from '../../../../../../public/service-page/service-page.util';
import type { Product } from '../../../products/interfaces/product.interface';
import type { ProductsService } from '../../../products/services/products.service';
import type { BuilderCategory } from '../../builder/builder.types';
import type { ServicePageConfig, StoreAppDetail } from '../../interfaces/store-app.interface';
import type { StoreAppsService } from '../../services/store-apps.service';
import type { AppPageDocument } from '../../templates';
import { PageBlockMeta, emptyPage, pageBuilderCatalog, storedPage } from '../page-builder-document';
import type { AppPageBuilderAdapter, AppPagePreviewPayload } from '../page-builder.types';

/** Same limits as the backend (`service-page.reader.ts`). */
export const MAX_FEATURED_SERVICES = 12;
export const MAX_SECONDARY_PRODUCTS = 8;
/** Most services the public page lists. */
const MAX_LISTED_SERVICES = 60;

/** A service or product the owner picked. */
export interface PickedItem {
  id: number;
  name: string;
}

/** What General edits of the service page besides the page: the featured services and the secondary products. */
export interface ServicePageSettings {
  featured: PickedItem[];
  products: PickedItem[];
}

/** Catalog data the page paints (`GET /store/apps/service_page/preview-context`). */
export interface ServicePageContext {
  services: {
    id: number;
    slug: string;
    name: string;
    description: string | null;
    price: number;
    image_url: string | null;
    service_duration_minutes: number | null;
    service_modality: string | null;
    requires_booking: boolean;
    categories: { id: number; name: string; slug: string }[];
  }[];
  featured_service_ids: number[];
  products: { id: number; slug: string; name: string; image_url: string | null }[];
}

export const EMPTY_SERVICE_PAGE_CONTEXT: ServicePageContext = { services: [], featured_service_ids: [], products: [] };

const CATEGORIES: readonly BuilderCategory[] = [
  { id: 'services', label: 'Servicios' },
  { id: 'trust', label: 'Confianza' },
  { id: 'sales', label: 'Venta' },
];

/**
 * The service page draws, in this order: the cover, «Servicios» (the store's
 * real services), the owner's blocks and «También puedes comprar». Both
 * sections are shown by the public layout whenever the block is absent (only
 * a hidden block turns them off), so they are pinned to their place and
 * cannot be removed, only hidden. «Cómo reservar» and «Políticas» only make
 * sense when the page books; the products block only when it sells.
 */
const META: Record<string, PageBlockMeta> = {
  services: {
    category: 'services',
    pinned: 'start',
    removable: false,
    liveData: 'Tus servicios que se venden en línea, con su precio y duración.',
  },
  how_it_works: { category: 'services', modes: ['booking', 'both'] },
  team: { category: 'services' },
  policies: { category: 'trust', modes: ['booking', 'both'] },
  gallery: { category: 'trust' },
  testimonials: { category: 'trust' },
  faq: { category: 'trust' },
  products: {
    category: 'sales',
    pinned: 'end',
    removable: false,
    modes: ['sales', 'both'],
    liveData: 'Los productos que elegiste en General.',
  },
  cta: { category: 'sales' },
};

export const SERVICE_PAGE_BUILDER_CATALOG = pageBuilderCatalog('service_page', CATEGORIES, META);

/** The service page as the public home draws it with this draft. */
export interface ServicePagePreview {
  page: AppPageDocument;
  storeName: string;
  storeLogoUrl: string | null;
  services: ServiceCardData[];
  featuredIds: number[];
  /** Ids of the secondary products (the home view only needs to know whether there are any). */
  productIds: number[];
  products: { id: number; name: string; image_url: string | null }[];
}

/**
 * The service page the public layout would draw with this draft: every
 * online service the server read, the featured ones of General first in the
 * owner's order and the rest by name (the public rule), and the secondary
 * products of General with the photos the server knows.
 */
export function servicePagePreview(
  payload: AppPagePreviewPayload<ServicePageSettings | null, ServicePageContext | null>,
): ServicePagePreview {
  const context = payload.context ?? EMPTY_SERVICE_PAGE_CONTEXT;
  const settings = payload.settings;
  const byId = new Map(context.services.map((s) => [s.id, s]));
  const featured = (settings?.featured ?? []).map((f) => byId.get(f.id)).filter((s): s is ServicePageContext['services'][number] => !!s);
  const featuredSet = new Set(featured.map((s) => s.id));
  const rest = context.services.filter((s) => !featuredSet.has(s.id)).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const services: ServiceCardData[] = [...featured, ...rest].slice(0, MAX_LISTED_SERVICES).map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    description: s.description,
    final_price: s.price,
    image_url: s.image_url,
    service_duration_minutes: s.service_duration_minutes,
    service_modality: (s.service_modality ?? null) as ServiceCardData['service_modality'],
    requires_booking: s.requires_booking,
    categories: s.categories,
  }));
  const products = (settings?.products ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    image_url: context.products.find((k) => k.id === p.id)?.image_url ?? null,
  }));
  return {
    page: payload.page,
    storeName: payload.storeName,
    storeLogoUrl: payload.storeLogoUrl,
    services,
    featuredIds: featured.map((s) => s.id),
    productIds: products.map((p) => p.id),
    products,
  };
}

export function servicePageBuilderAdapter(
  apps: StoreAppsService,
  products: ProductsService,
): AppPageBuilderAdapter<ServicePageSettings, ServicePageContext> {
  return {
    kind: 'service_page',
    icon: 'briefcase',
    noun: 'la página de servicios',
    publishedToast: 'Página de servicios publicada',
    catalog: SERVICE_PAGE_BUILDER_CATALOG,
    addressHint: 'Dirección de Vendix creada a partir de la tienda (por ejemplo tutienda-service.vendix.online).',
    emptyContext: EMPTY_SERVICE_PAGE_CONTEXT,
    // Without a saved page the public page draws the cover-less service list (mode «both»): so does an empty one.
    initialPage: (detail: StoreAppDetail) => storedPage(detail.config) ?? emptyPage(),
    settings$: (detail: StoreAppDetail) => resolveSettings(products, (detail.config ?? {}) as Partial<ServicePageConfig>),
    saveSettings$: (settings) =>
      apps.saveServicePageConfig({
        featured_service_ids: settings.featured.map((s) => s.id),
        product_ids: settings.products.map((p) => p.id),
      }),
    context$: () => apps.servicePagePreviewContext().pipe(map((res) => res.data ?? EMPTY_SERVICE_PAGE_CONTEXT)),
    domains$: () => apps.servicePageCustomDomains().pipe(map((res) => res.data ?? [])),
    // The server refuses to publish a store with no online service (STORE_APPS_007); it says so itself.
    publishBlocker: () => null,
    publish$: (customDomainId) => apps.publishServicePage(customDomainId),
    unpublish$: () => apps.unpublishServicePage(),
  };
}

/** The stored ids as names (an item that cannot be read is left out). */
function resolveSettings(products: ProductsService, config: Partial<ServicePageConfig>): Observable<ServicePageSettings> {
  const featuredIds = Array.isArray(config.featured_service_ids) ? config.featured_service_ids : [];
  const productIds = Array.isArray(config.product_ids) ? config.product_ids : [];
  const ids = [...featuredIds, ...productIds];
  if (!ids.length) return of({ featured: [], products: [] });
  return forkJoin(ids.map((id) => products.getProductById(id).pipe(catchError(() => of(null))))).pipe(
    map((rows) => {
      const byId = new Map(rows.filter((p): p is Product => !!p).map((p) => [p.id, { id: p.id, name: p.name } as PickedItem]));
      const pick = (list: number[]) => list.map((id) => byId.get(id)).filter((p): p is PickedItem => !!p);
      return { featured: pick(featuredIds), products: pick(productIds) };
    }),
  );
}
