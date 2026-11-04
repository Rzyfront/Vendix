import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import type { AppKind } from '../interfaces/store-app.interface';

/** Base route of the Apps module. */
export const APPS_ROUTE = '/admin/apps';

/** The online store keeps its own standalone route, unchanged (apps-vistas-f1 S5). */
export const ECOMMERCE_ADMIN_ROUTE = '/admin/ecommerce';

/**
 * URL segment of each app view `/admin/apps/:slug` (apps-vistas-f1 S3).
 * Kebab-case in the URL, snake_case `AppKind` in the API.
 */
export const APP_SLUGS: Record<AppKind, string> = {
  ecommerce: 'ecommerce',
  store_home: 'store-home',
  landing: 'landing',
  product_page: 'product-page',
  service_page: 'service-page',
  booking: 'booking',
};

/**
 * Apps whose view is `/admin/apps/:slug`. The online store (apps-f2 S1) hosts
 * the existing `EcommerceComponent` there; `/admin/ecommerce` keeps working.
 */
export const APPS_WITH_VIEW: readonly AppKind[] = [
  'ecommerce',
  'store_home',
  'landing',
  'product_page',
  'service_page',
  'booking',
];

/** `AppKind` of a view slug, or `null` when the slug is not an app view. */
export function appKindFromSlug(slug: string | null | undefined): AppKind | null {
  const match = APPS_WITH_VIEW.find((kind) => APP_SLUGS[kind] === slug);
  return match ?? null;
}

/** Route that manages an app: its view `/admin/apps/:slug` (the online store included). */
export function appViewRoute(kind: AppKind): string {
  return `${APPS_ROUTE}/${APP_SLUGS[kind]}`;
}

/** Unknown slug → back to the catalog instead of an empty view. */
export const appKindGuard: CanActivateFn = (route) => {
  if (appKindFromSlug(route.paramMap.get('kind'))) return true;
  return inject(Router).createUrlTree([APPS_ROUTE]);
};
