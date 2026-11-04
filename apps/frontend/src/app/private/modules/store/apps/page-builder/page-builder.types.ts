import type { Observable } from 'rxjs';

import type { BuilderCatalog } from '../builder/builder.types';
import type { ProductPageCustomDomain, StoreAppDetail } from '../interfaces/store-app.interface';
import type { AppPageDocument, PageAppKind } from '../templates';

/**
 * F6-B — what each app plugs into the shared page builder view
 * (`AppPageBuilderPageComponent`): its catalog, its own settings (what
 * General edits besides the page), the real data its preview paints and its
 * publish chain. One adapter per app (`page-builder/<app>/`); the view never
 * branches on the app for behavior, only to project the app's General panel
 * and preview body.
 *
 * `S` is the app's settings draft (compared by value to detect changes) and
 * `C` the preview context (real store data, read once on entering the view).
 */
export interface AppPageBuilderAdapter<S = unknown, C = unknown> {
  readonly kind: PageAppKind;
  /** Header icon and the app as a noun («el inicio de tienda»), for messages. */
  readonly icon: string;
  readonly noun: string;
  /** Toast after publishing («Inicio de tienda publicado»). */
  readonly publishedToast: string;
  readonly catalog: BuilderCatalog;
  /** Where the app is published, for General (e.g. «la dirección principal de tu tienda»). */
  readonly addressHint: string;
  readonly emptyContext: C;

  /** The page the builder starts from when the app never saved one: it must render like today. */
  initialPage(detail: StoreAppDetail): AppPageDocument;
  /** The app's own settings as stored (may look up names, e.g. the featured product). */
  settings$(detail: StoreAppDetail): Observable<S>;
  saveSettings$(settings: S): Observable<unknown>;
  /** Real store data the preview paints (products, services, apps…). */
  context$(): Observable<C>;
  /** The store's own domains the app may use; `null` when it has a fixed address. */
  domains$(): Observable<ProductPageCustomDomain[]> | null;
  /** Why the app cannot be published with these settings, or `null`. */
  publishBlocker(settings: S, page: AppPageDocument): string | null;
  publish$(customDomainId: number | null): Observable<unknown>;
  unpublish$(): Observable<unknown>;
}

/** What the editor posts to the preview frame on every change. */
export interface AppPagePreviewPayload<S = unknown, C = unknown> {
  kind: PageAppKind;
  /** The page as it would be saved (hidden sections with `enabled: false`). */
  page: AppPageDocument;
  settings: S;
  context: C;
  storeName: string;
  storeLogoUrl: string | null;
}

/** Route of the shared preview frame, outside the admin layout (`store_admin.routes.ts`). */
export const APP_PAGE_PREVIEW_FRAME_ROUTE = '/admin/apps/page-preview';

export function appPagePreviewFrameSrc(kind: PageAppKind): string {
  return `${APP_PAGE_PREVIEW_FRAME_ROUTE}/${kind}`;
}
