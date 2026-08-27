import { inject } from '@angular/core';
import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { EMPTY, Observable, throwError, timer } from 'rxjs';
import { catchError, finalize, shareReplay, switchMap, timeout } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AuthService } from '../services/auth.service';
import { SessionService } from '../services/session.service';

/**
 * Shared module-scoped state across all invocations of the functional
 * interceptor. We cache the in-flight refresh Observable and replay it
 * to subsequent concurrent 401s so `AuthService.refreshToken()` is
 * invoked at most once per refresh cycle.
 *
 * shareReplay({ bufferSize: 1, refCount: true }) gives us:
 *   - the FIRST subscriber calls the source (refreshToken) and gets
 *     the value synchronously (or async in production);
 *   - any subsequent subscriber attached BEFORE the source completes
 *     receives the cached value without re-invoking the source.
 *   - once every subscriber detaches, refCount drops to 0 and finalize
 *     clears `activeRefresh$` so the NEXT batch of 401s starts fresh.
 */
let activeRefresh$: Observable<any> | null = null;

/**
 * QUI-723 PR unblock — drains module-scoped refresh state between tests
 * so the karma suite can exercise concurrent 401 paths deterministically.
 * No-op in production (never called outside `*.spec.ts`).
 */
export function __resetAuthInterceptorForTests(): void {
  activeRefresh$ = null;
}

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

  const refreshToken = getRefreshToken();

  if (!refreshToken) {
    // No hay refresh token — sesión expirada
    sessionService.terminateSession('session_expired');
    return EMPTY;
  }

  // Get or create the shared refresh Observable. The first subscriber
  // calls refreshToken() and the result is cached for subsequent
  // concurrent 401s (synchronously in tests via of() + refCount:true).
  if (!activeRefresh$) {
    activeRefresh$ = authService.refreshToken().pipe(
      timeout(15000),
      shareReplay({ bufferSize: 1, refCount: true }),
      finalize(() => { activeRefresh$ = null; }),
    );
  }

  return activeRefresh$.pipe(
    switchMap((response: any) => {
      const newToken = response.data?.access_token;
      const newRefreshToken = response.data?.refresh_token;

      if (newToken) {
        updateTokensInAuthState(newToken, newRefreshToken);
        return next(addTokenToRequest(request, newToken));
      }

      // Si refresh falló, terminar sesión limpiamente
      sessionService.terminateSession('token_refresh_failed');
      return EMPTY;
    }),
    catchError((err) => {
      if (err instanceof Error && err.name === 'TimeoutError') {
        sessionService.terminateSession('token_refresh_timeout');
      } else {
        sessionService.terminateSession('token_refresh_failed');
      }
      return EMPTY;
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
