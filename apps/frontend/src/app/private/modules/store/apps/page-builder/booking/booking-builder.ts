import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import type { BookingPreviewRoom } from '../../../../../../public/booking-page/booking-page-home-view.component';
import type { Product } from '../../../products/interfaces/product.interface';
import type { ProductsService } from '../../../products/services/products.service';
import type { BuilderCategory } from '../../builder/builder.types';
import type { BookingPageConfig, StoreAppDetail } from '../../interfaces/store-app.interface';
import type { StoreAppsService } from '../../services/store-apps.service';
import type { AppPageDocument } from '../../templates';
import { PageBlockMeta, emptyPage, pageBuilderCatalog, storedPage } from '../page-builder-document';
import type { AppPageBuilderAdapter, AppPagePreviewPayload } from '../page-builder.types';

/** Same limit as the backend (`MAX_BOOKING_PRODUCTS`). */
export const MAX_BOOKING_PRODUCTS = 8;

/** A product the owner picked for «Para tu estadía». */
export interface PickedItem {
  id: number;
  name: string;
}

/** What General edits of the booking page besides the page: the «Para tu estadía» products. */
export interface BookingSettings {
  products: PickedItem[];
}

/** Data the page paints (`GET /store/apps/booking/preview-context`). */
export interface BookingContext {
  room_types: BookingPreviewRoom[];
  products: { id: number; slug: string; name: string; image_url: string | null }[];
}

export const EMPTY_BOOKING_CONTEXT: BookingContext = { room_types: [], products: [] };

const CATEGORIES: readonly BuilderCategory[] = [
  { id: 'stay', label: 'Estadía' },
  { id: 'trust', label: 'Confianza' },
  { id: 'sales', label: 'Venta' },
];

/**
 * The booking page draws, in this order: the cover, «Buscador y habitaciones»
 * (the PMS engine), «Check-in en línea», the owner's blocks and «Para tu
 * estadía». The three sections are shown by the public page whenever the block
 * is absent (only a hidden block turns them off), so they are pinned to their
 * place and cannot be removed, only hidden. The products block only makes sense
 * when the page sells.
 */
const META: Record<string, PageBlockMeta> = {
  search: {
    category: 'stay',
    pinned: 'start',
    removable: false,
    liveData: 'Tus habitaciones reales con su tarifa y disponibilidad (Hotelería).',
  },
  checkin_info: { category: 'stay', pinned: 'start', removable: false },
  amenities: { category: 'stay' },
  policies: { category: 'trust' },
  location: { category: 'stay' },
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
};

export const BOOKING_BUILDER_CATALOG = pageBuilderCatalog('booking', CATEGORIES, META);

/** The booking page as the public home draws it with this draft. */
export interface BookingPreview {
  page: AppPageDocument;
  storeName: string;
  storeLogoUrl: string | null;
  rooms: BookingPreviewRoom[];
  productIds: number[];
  products: { id: number; name: string; image_url: string | null }[];
}

/**
 * The booking page the public layout would draw with this draft: the real room
 * types (the PMS engine itself is not called) and the «Para tu estadía»
 * products of General with the photos the server knows.
 */
export function bookingPreview(payload: AppPagePreviewPayload<BookingSettings | null, BookingContext | null>): BookingPreview {
  const context = payload.context ?? EMPTY_BOOKING_CONTEXT;
  const products = (payload.settings?.products ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    image_url: context.products.find((k) => k.id === p.id)?.image_url ?? null,
  }));
  return {
    page: payload.page,
    storeName: payload.storeName,
    storeLogoUrl: payload.storeLogoUrl,
    rooms: context.room_types,
    productIds: products.map((p) => p.id),
    products,
  };
}

export function bookingBuilderAdapter(
  apps: StoreAppsService,
  products: ProductsService,
): AppPageBuilderAdapter<BookingSettings, BookingContext> {
  return {
    kind: 'booking',
    icon: 'bed-double',
    noun: 'la página de reservas',
    publishedToast: 'Página de reservas publicada',
    catalog: BOOKING_BUILDER_CATALOG,
    addressHint: 'Dirección de Vendix creada a partir de la tienda (por ejemplo tuhotel-booking.vendix.online).',
    emptyContext: EMPTY_BOOKING_CONTEXT,
    // Without a saved page the public page draws search, check-in note and products (mode «both»): so does an empty one.
    initialPage: (detail: StoreAppDetail) => storedPage(detail.config) ?? emptyPage(),
    settings$: (detail: StoreAppDetail) => resolveSettings(products, (detail.config ?? {}) as Partial<BookingPageConfig>),
    saveSettings$: (settings) => apps.saveBookingConfig({ product_ids: settings.products.map((p) => p.id) }),
    context$: () => apps.bookingPreviewContext().pipe(map((res) => res.data ?? EMPTY_BOOKING_CONTEXT)),
    domains$: () => apps.bookingCustomDomains().pipe(map((res) => res.data ?? [])),
    // The server refuses to publish a store with no active room type (STORE_APPS_009); it says so itself.
    publishBlocker: () => null,
    publish$: (customDomainId) => apps.publishBooking(customDomainId),
    unpublish$: () => apps.unpublishBooking(),
  };
}

/** The stored ids as names (a product that cannot be read is left out). */
function resolveSettings(products: ProductsService, config: Partial<BookingPageConfig>): Observable<BookingSettings> {
  const ids = Array.isArray(config.product_ids) ? config.product_ids : [];
  if (!ids.length) return of({ products: [] });
  return forkJoin(ids.map((id) => products.getProductById(id).pipe(catchError(() => of(null))))).pipe(
    map((rows) => {
      const byId = new Map(rows.filter((p): p is Product => !!p).map((p) => [p.id, { id: p.id, name: p.name } as PickedItem]));
      return { products: ids.map((id) => byId.get(id)).filter((p): p is PickedItem => !!p) };
    }),
  );
}
