/**
 * Mirror of `GET /store/apps` (backend `domains/store/apps/dto/store-app.response.ts`).
 * Apps module, odd/tasks/apps-module.md S3.
 */
export type AppKind =
  | 'ecommerce'
  | 'store_home'
  | 'landing'
  | 'product_page'
  | 'service_page'
  | 'booking';

export type AppStatus = 'not_installed' | 'draft' | 'published' | 'disabled';

export interface StoreAppDomain {
  id: number;
  hostname: string;
  status: string;
}

export interface StoreApp {
  key: AppKind;
  name: string;
  description: string;
  applies_to_store_industries: boolean;
  status: AppStatus;
  domain: StoreAppDomain | null;
  public_url: string | null;
  published_at: string | null;
}

export interface StoreAppsResponse {
  success: boolean;
  data: StoreApp[];
  message?: string;
}

/** GET /store/apps/:kind — the list item plus the app's own config. */
export interface StoreAppDetail extends StoreApp {
  config: Record<string, unknown>;
}

export interface StoreAppDetailResponse {
  success: boolean;
  data: StoreAppDetail;
  message?: string;
}

/** `store_apps.config` of the product page (backend `product-page.reader.ts`). */
export interface ProductPageConfig {
  product_id: number | null;
  complement_product_ids: number[];
}

/** A custom domain of the store an app (product or service page) can take over. */
export interface ProductPageCustomDomain {
  id: number;
  hostname: string;
  status: string;
  app_type: string;
}

/** `store_apps.config` of the service page (backend `service-page.reader.ts`). */
export interface ServicePageConfig {
  featured_service_ids: number[];
  product_ids: number[];
}

/** `store_apps.config` of the hotel booking page (backend `booking-page.reader.ts`). */
export interface BookingPageConfig {
  product_ids: number[];
}

/** `store_apps.config` of the store home (backend `store-home.reader.ts`). */
export interface StoreHomeConfig {
  /** Footer line about Vendix; `null` = Vendix's default tagline. */
  footer_text: string | null;
}

/** `store_apps.config` of the landing page (backend `landing-page.reader.ts`). */
export interface LandingPageConfig {
  /** `info` only captures the lead; `product` adds one product to buy. */
  offer_mode: 'info' | 'product';
  offer_title: string | null;
  offer_description: string | null;
  offer_product_id: number | null;
}
