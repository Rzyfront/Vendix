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
