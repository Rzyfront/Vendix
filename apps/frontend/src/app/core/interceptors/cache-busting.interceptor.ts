import {
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * Cache-busting interceptor para APIs privadas.
 *
 * Complementa el middleware `no-store` del backend (ver `apps/backend/src/main.ts`).
 * Si alguien en el futuro quita o cambia ese middleware, este interceptor
 * blinda al frontend añadiendo `Cache-Control: no-cache` a todas las
 * requests GET hacia la API.
 *
 * Solo afecta GETs: los POST/PATCH/DELETE nunca se cachean por defecto
 * en el browser, así que no necesitan intervención.
 *
 * No afecta URLs fuera de `environment.apiUrl` (assets, S3, fonts, etc.).
 */
export const cacheBustingInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  if (req.method === 'GET' && req.url.startsWith(environment.apiUrl)) {
    const cloned = req.clone({
      setHeaders: { 'Cache-Control': 'no-cache' },
    });
    return next(cloned);
  }
  return next(req);
};
