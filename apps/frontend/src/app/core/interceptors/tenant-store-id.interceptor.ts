import {
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { TenantFacade } from '../store/tenant/tenant.facade';

/**
 * Interceptor that ensures every API request carries an `x-store-id` header.
 *
 * Priority:
 *   1. If the outgoing request already has `x-store-id` (set explicitly by
 *      a service), keep it as-is.
 *   2. Otherwise, read the store_id from the TenantFacade domain config
 *      (resolved at app init via /api/public/domains/resolve/{hostname}).
 *
 * The previous implementation used a hardcoded subdomain → store_id map
 * that was stale (nike-shop→2 vs actual 10).  This version reads the
 * authoritative store_id from the DomainConfig resolved by the backend.
 */
export const tenantStoreIdInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  // Only intercept our own API requests; never third-party URLs.
  if (!req.url.startsWith(environment.apiUrl)) {
    return next(req);
  }

  // If the service layer already set x-store-id, honour it.
  if (req.headers.has('x-store-id')) {
    return next(req);
  }

  // Read store_id from TenantFacade (backed by NgRx store).
  // The APP_INITIALIZER resolves the domain config before any route loads,
  // so by the time an API call fires, domainConfig is populated.
  const tenantFacade = inject(TenantFacade);
  const domainConfig = tenantFacade.getCurrentDomainConfig();
  const storeId = domainConfig?.store_id;

  if (storeId) {
    const cloned = req.clone({
      setHeaders: { 'x-store-id': String(storeId) },
    });
    return next(cloned);
  }

  return next(req);
};
