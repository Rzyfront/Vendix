import { inject } from '@angular/core';
import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { EMPTY, Observable, Subject, throwError } from 'rxjs';
import { catchError, switchMap, take } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AuthService } from '../services/auth.service';
import { SessionService } from '../services/session.service';

/**
 * Shared module-scoped state across all invocations of the functional
 * interceptor. This implements the "single refresh at a time, queue
 * concurrent 401s" pattern.
 *
 * Using a plain `Subject` (not `BehaviorSubject`) lets us drop the
 * `filter(token => token !== null)` we needed before — a Subject only
 * emits when `next()` is called, so waiting requests naturally unblock
 * only when a fresh token arrives. See skill `vendix-zoneless-signals` §10
 * ("Subject con composición RxJS" — legitimate use case).
 */
let isRefreshing = false;
const refreshToken$ = new Subject<string>();

export const authInterceptorFn: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  const authService = inject(AuthService);
  const sessionService = inject(SessionService);

  // Si la sesión se está terminando, cancelar requests pendientes
  if (sessionService.isTerminating()) {
    return EMPTY;
  }

  // Add auth token to request if available and URL starts with API base
  const authToken = authService.getToken();

  if (authToken && req.url.startsWith(environment.apiUrl)) {
    req = addTokenToRequest(req, authToken);
  }

  return next(req).pipe(
    catchError((error) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        req.url.startsWith(environment.apiUrl) &&
        !req.url.includes('/auth/login')
      ) {
        // Only handle as session expiration if we actually sent a token.
        // A 401 on a request WITHOUT a token means the user is simply
        // not authenticated — not that their session expired.
        if (!req.headers.has('Authorization')) {
          return throwError(() => error);
        }

        return handle401Error(req, next, authService, sessionService);
      }
      return throwError(() => error);
    }),
  );
};

function addTokenToRequest(
  request: HttpRequest<unknown>,
  token: string,
): HttpRequest<unknown> {
  return request.clone({
    setHeaders: {
      Authorization: `Bearer ${token}`,
    },
  });
}

function handle401Error(
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
  authService: AuthService,
  sessionService: SessionService,
): Observable<HttpEvent<unknown>> {
  // Si la sesión ya se está terminando, no procesar más
  if (sessionService.isTerminating()) {
    return EMPTY;
  }

  if (!isRefreshing) {
    isRefreshing = true;

    const refreshToken = getRefreshToken();

    if (refreshToken) {
      return authService.refreshToken().pipe(
        switchMap((response: any) => {
          isRefreshing = false;
          const newToken = response.data?.access_token;
          const newRefreshToken = response.data?.refresh_token;

          if (newToken) {
            updateTokensInAuthState(newToken, newRefreshToken);
            refreshToken$.next(newToken);
            return next(addTokenToRequest(request, newToken));
          }

          // Si refresh falló, terminar sesión limpiamente
          sessionService.terminateSession('token_refresh_failed');
          return EMPTY;
        }),
        catchError(() => {
          isRefreshing = false;
          // Terminar sesión limpiamente
          sessionService.terminateSession('token_refresh_failed');
          return EMPTY;
        }),
      );
    } else {
      // No hay refresh token - sesión expirada
      isRefreshing = false;
      sessionService.terminateSession('session_expired');
      return EMPTY;
    }
  }

  // Si ya estamos refrescando, esperar el nuevo token.
  // El Subject solo emite cuando llega un token real, por lo que no se
  // necesita filter(token => token !== null) como con BehaviorSubject.
  return refreshToken$.pipe(
    take(1),
    switchMap((token) => {
      // Verificar si la sesión terminó mientras esperábamos
      if (sessionService.isTerminating()) {
        return EMPTY;
      }
      return next(addTokenToRequest(request, token));
    }),
  );
}

/**
 * Helper to get refresh token from vendix_auth_state
 */
function getRefreshToken(): string | null {
  try {
    const authState = localStorage.getItem('vendix_auth_state');
    if (!authState) return null;
    const parsed = JSON.parse(authState);
    return parsed.tokens?.refresh_token || null;
  } catch {
    return null;
  }
}

/**
 * Helper to update tokens in vendix_auth_state
 */
function updateTokensInAuthState(
  accessToken: string,
  refreshToken?: string,
): void {
  try {
    const authState = localStorage.getItem('vendix_auth_state');
    if (!authState) {
      return;
    }
    const parsed = JSON.parse(authState);
    if (parsed.tokens) {
      parsed.tokens.access_token = accessToken;
      if (refreshToken) {
        parsed.tokens.refresh_token = refreshToken;
      }
      localStorage.setItem('vendix_auth_state', JSON.stringify(parsed));
    }
  } catch {
    // Silently fail
  }
}
