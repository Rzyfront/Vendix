import { AppKind, AppStatus } from '../apps.catalog';

export interface StoreAppDomainView {
  id: number;
  hostname: string;
  status: string;
}

/** One item of GET /store/apps. */
export interface StoreAppView {
  key: AppKind;
  name: string;
  description: string;
  /** True when the app applies to at least one of the store industries. */
  applies_to_store_industries: boolean;
  status: AppStatus;
  domain: StoreAppDomainView | null;
  /** Only when the app is published on an active domain. */
  public_url: string | null;
  published_at: Date | null;
}

/** GET /store/apps/:kind — list item plus the app's own config. */
export interface StoreAppDetailView extends StoreAppView {
  config: Record<string, unknown>;
}
