import { of } from 'rxjs';
import { map } from 'rxjs/operators';

import type { StoreHomeAppLink, StoreHomePublic } from '../../../../../../public/store-home/store-home.service';
import type { BuilderCategory } from '../../builder/builder.types';
import type { StoreAppDetail, StoreHomeConfig } from '../../interfaces/store-app.interface';
import type { StoreAppsService } from '../../services/store-apps.service';
import type { AppPageDocument } from '../../templates';
import { PageBlockMeta, emptyPage, pageBuilderCatalog, storedPage } from '../page-builder-document';
import type { AppPageBuilderAdapter, AppPagePreviewPayload } from '../page-builder.types';

/** Same limit as the old settings panel and the backend (`store-home` config). */
export const MAX_STORE_HOME_FOOTER = 160;

/** What General edits of the store home besides the page. */
export interface StoreHomeSettings {
  footer_text: string;
}

/** Real data the store home paints (`GET /store/apps/store-home/preview-context`). */
export type StoreHomeContext = Omit<StoreHomePublic, 'page'>;

export const EMPTY_STORE_HOME_CONTEXT: StoreHomeContext = {
  store_name: null,
  branding: { name: null, logo_url: null, primary_color: null, secondary_color: null, accent_color: null },
  footer: { text: '', site_url: '' },
  apps: [],
};

const CATEGORIES: readonly BuilderCategory[] = [
  { id: 'essentials', label: 'Esenciales' },
  { id: 'trust', label: 'Confianza' },
  { id: 'contact', label: 'Contacto' },
];

/**
 * The store home has three sections: «Mis apps» (drawn by the layout, right
 * under the cover), the highlights and the contact data.
 */
const META: Record<string, PageBlockMeta> = {
  apps: { category: 'essentials', pinned: 'start', liveData: 'Tus apps publicadas, con su dirección real.' },
  highlights: { category: 'trust' },
  contact: { category: 'contact' },
};

export const STORE_HOME_BUILDER_CATALOG = pageBuilderCatalog('store_home', CATEGORIES, META);

/** Kinds of the apps the «Mis apps» block lists, in order; `null` = every published app (as before F6-B). */
export function storeHomeKinds(page: AppPageDocument): string[] | null {
  const kinds = page.blocks.find((b) => b.type === 'apps')?.props['kinds'];
  return Array.isArray(kinds) ? kinds.filter((k): k is string => typeof k === 'string') : null;
}

/** Same rule as the backend `selectStoreHomeApps`: no list = all; a list = those, in its order. */
export function selectStoreHomeApps(apps: readonly StoreHomeAppLink[], kinds: unknown): StoreHomeAppLink[] {
  if (!Array.isArray(kinds)) return [...apps];
  return kinds
    .filter((kind): kind is string => typeof kind === 'string')
    .map((kind) => apps.find((app) => app.kind === kind))
    .filter((app): app is StoreHomeAppLink => !!app)
    .filter((app, index, list) => list.indexOf(app) === index);
}

/**
 * The store home the public page would receive with this draft: the real
 * brand, the footer line of the settings and the published apps, only when
 * the «Mis apps» block is on (as `GET /ecommerce/store-home` answers).
 */
export function storeHomePreview(payload: AppPagePreviewPayload<StoreHomeSettings | null, StoreHomeContext | null>): StoreHomePublic {
  const context = payload.context ?? EMPTY_STORE_HOME_CONTEXT;
  const page = payload.page;
  const appsBlock = page.blocks.find((b) => b.type === 'apps');
  const home: StoreHomePublic = {
    store_name: context.store_name ?? payload.storeName,
    branding: context.branding,
    footer: { ...context.footer, text: payload.settings?.footer_text.trim() ?? context.footer.text },
    page,
  };
  if (appsBlock?.enabled) home.apps = selectStoreHomeApps(context.apps ?? [], appsBlock.props['kinds']);
  return home;
}

export function storeHomeBuilderAdapter(apps: StoreAppsService): AppPageBuilderAdapter<StoreHomeSettings, StoreHomeContext> {
  return {
    kind: 'store_home',
    icon: 'home',
    noun: 'el inicio de tienda',
    publishedToast: 'Inicio de tienda publicado',
    catalog: STORE_HOME_BUILDER_CATALOG,
    addressHint: 'La dirección principal de tu tienda ({tienda}-store). Al publicar, reemplaza a la landing en esa dirección.',
    emptyContext: EMPTY_STORE_HOME_CONTEXT,
    initialPage: (detail: StoreAppDetail) => storedPage(detail.config) ?? emptyPage(),
    settings$: (detail: StoreAppDetail) =>
      of({ footer_text: ((detail.config ?? {}) as Partial<StoreHomeConfig>).footer_text ?? '' }),
    saveSettings$: (settings) => apps.saveStoreHomeConfig({ footer_text: settings.footer_text.trim() || null }),
    context$: () => apps.storeHomePreviewContext().pipe(map((res) => res.data ?? EMPTY_STORE_HOME_CONTEXT)),
    domains$: () => null,
    publishBlocker: (settings) =>
      settings.footer_text.length > MAX_STORE_HOME_FOOTER
        ? `El pie de página admite hasta ${MAX_STORE_HOME_FOOTER} caracteres.`
        : null,
    publish$: () => apps.publishStoreHome(),
    unpublish$: () => apps.unpublishStoreHome(),
  };
}
