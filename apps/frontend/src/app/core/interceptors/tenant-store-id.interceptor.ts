import {
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * Subdomain → store_id mapping for the dev environment.
 *
 * Background: the public booking flow lives at tenant subdomains
 * (e.g. `nike-shop.vendix.com`) but the frontend's `environment.apiUrl`
 * is the generic `https://api.vendix.com/api`. That means every API
 * request hits the backend with `Host: api.vendix.com` instead of
 * `Host: nike-shop.vendix.com`, so the backend's `DomainResolverMiddleware`
 * cannot resolve a store_id and any `StorePrismaService` query throws
 * 403 'Access denied - store context required'.
 *
 * Workaround for dev: this interceptor injects the `x-store-id` header
 * derived from the current subdomain, so the backend can set the
 * store context without depending on the Host header.
 *
 * Production TODO: replace this with a call to a public
 * `/api/public/domains/resolve/{hostname}` endpoint that maps
 * subdomain → store_id centrally.
 */
const DEV_SUBDOMAIN_TO_STORE_ID: Record<string, number> = {
  'nike-shop': 2,
  // Add more tenant mappings as the team onboards them.
};

function resolveStoreIdFromHostname(): number | null {
  if (typeof window === 'undefined') return null;
  const hostname = window.location.hostname; // e.g. nike-shop.vendix.com
  const parts = hostname.split('.');
  if (parts.length < 2) return null;
  const subdomain = parts[0];
  return DEV_SUBDOMAIN_TO_STORE_ID[subdomain] ?? null;
}

export const tenantStoreIdInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  // Only inject for our own API; never for third-party URLs.
  if (!req.url.startsWith(environment.apiUrl)) {
    return next(req);
  }
  const storeId = resolveStoreIdFromHostname();
  if (storeId == null) {
    return next(req);
  }
  const cloned = req.clone({
    setHeaders: { 'x-store-id': String(storeId) },
  });
  return next(cloned);
};
