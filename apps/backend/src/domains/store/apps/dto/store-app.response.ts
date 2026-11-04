import { AppKind, AppStatus } from '../apps.catalog';

export interface StoreAppDomainView {
  id: number;
  hostname: string;
  status: string;
}

/** One item of GET /store/apps — light catalog, never the app's config. */
export interface StoreAppView {
  key: AppKind;
  name: string;
  description: string;
  /** True when the app applies to at least one of the store industries. */
  applies_to_store_industries: boolean;
  status: AppStatus;
  /** "Encendida": installed and not switched off (`draft` or `published`). */
  enabled: boolean;
  domain: StoreAppDomainView | null;
  /** Only when the app is published on an active domain. */
  public_url: string | null;
  published_at: Date | null;
}

/** GET /store/apps/:kind — what the app view needs: list item plus its config. */
export interface StoreAppDetailView extends StoreAppView {
  config: Record<string, unknown>;
}
