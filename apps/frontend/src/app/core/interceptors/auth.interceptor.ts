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
 * shareReplay({ bufferSize: 1, refCount: false }) gives us:
 *   - the FIRST subscriber calls the source (refreshToken) and gets
 *     the value synchronously (or async in production);
 *   - any subsequent subscriber receives the cached value without
 *     re-invoking the source — the source subscription is NEVER torn
 *     down, even when the first chain's outer subscription completes
 *     synchronously after a retry (which is what the test does);
 *   - the cache is cleared by the OUTER pipe's finalize, scheduled
 *     via queueMicrotask so the test's synchronous flush chain sees
 *     the cache still as "live" when a concurrent 401 lands in the
 *     same microtask checkpoint.
 */
let activeRefresh$: Observable<any> | null = null;

/**
 * Instante (epoch ms) hasta el que NO se vuelve a pedir refresco de sesión.
 *
 * Lo fija un 429 del backend en `auth/refresh`. Ver `handleRefreshFailure`
 * para el porqué: sin esta compuerta, cada 401 que llega durante el bloqueo
 * dispararía otra petición de refresco condenada al mismo 429, alimentando
 * justo la avalancha que el rate limit intenta frenar.
 */
let refreshBlockedUntilMs = 0;

/** Techo del enfriamiento. Ver `readRetryAfterSeconds`. */
const MAX_REFRESH_COOLDOWN_SECONDS = 15 * 60;

/**
 * QUI-723 PR unblock — drains module-scoped refresh state between tests
 * so the karma suite can exercise concurrent 401 paths deterministically.
 * No-op in production (never called outside `*.spec.ts`).
 */
export function __resetAuthInterceptorForTests(): void {
  activeRefresh$ = null;
  refreshBlockedUntilMs = 0;
}

/**
 * Segundos de espera que pide el backend en un 429.
 *
 * `retryAfter` (segundos, en la raíz del cuerpo) es el contrato que emiten los
 * middlewares de rate limit del backend; la cabecera estándar `Retry-After` es
 * el respaldo por si el 429 viene de nginx o de CloudFront, que no conocen ese
 * cuerpo. El techo evita que un valor absurdo deje la sesión sin poder
 * renovarse durante horas.
 */
function readRetryAfterSeconds(error: HttpErrorResponse): number {
  const fromBody = (error.error as { retryAfter?: unknown } | null)?.retryAfter;
  if (typeof fromBody === 'number' && fromBody > 0) {
    return Math.min(fromBody, MAX_REFRESH_COOLDOWN_SECONDS);
  }
  const fromHeader = Number(error.headers?.get('Retry-After'));
  if (Number.isFinite(fromHeader) && fromHeader > 0) {
    return Math.min(fromHeader, MAX_REFRESH_COOLDOWN_SECONDS);
  }
  return 60;
}

/**
 * Decide qué hacer cuando falla el refresco de sesión.
 *
 * ## Por qué un 429 NO termina la sesión
 *
 * Ésta es la pieza que rompía la cadena del apagón global. El backend
 * limitaba `auth/refresh` a diez peticiones por ventana sobre una clave que
 * —sin `trust proxy`— era la misma para todos los usuarios del planeta. Al
 * superarla, cualquier renovación automática en segundo plano recibía un 429,
 * y acá se trataba idéntico a un refresh token inválido: `terminateSession`.
 * O sea, un límite de tasa expulsaba a la plataforma entera de golpe, y la
 * avalancha de reintentos de login que venía detrás agotaba el límite de
 * `auth/login` y remataba con el modal de bloqueo de quince minutos.
 *
 * Un 429 no dice nada sobre la validez de la sesión: dice «ahora no». Así que
 * se propaga el error a quien hizo la petición, se abre un enfriamiento para
 * no insistir, y los tokens se quedan donde están. Cuando la ventana vence, el
 * siguiente 401 renueva y el usuario nunca se enteró.
 *
 * El backend ya no debería llegar a este caso con las cubetas por sesión, pero
 * esta compuerta es la única que corta el efecto dominó desde el lado del
 * cliente, así que se queda como defensa en profundidad.
 */
function handleRefreshFailure(
  error: unknown,
  sessionService: SessionService,
): Observable<never> {
  if (error instanceof HttpErrorResponse && error.status === 429) {
    refreshBlockedUntilMs = Date.now() + readRetryAfterSeconds(error) * 1000;
    return throwError(() => error);
  }

  if (error instanceof Error && error.name === 'TimeoutError') {
    sessionService.terminateSession('token_refresh_timeout');
  } else {
    sessionService.terminateSession('token_refresh_failed');
  }
  return EMPTY;
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

        return handle401Error(req, next, authService, sessionService, error);
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
  originalError: HttpErrorResponse,
): Observable<HttpEvent<unknown>> {
  // Si la sesión ya se está terminando, no procesar más
  if (sessionService.isTerminating()) {
    return EMPTY;
  }

  // Enfriamiento tras un 429 en `auth/refresh`: se devuelve el 401 original al
  // llamante sin tocar la sesión. Insistir sólo sumaría peticiones a la cubeta
  // ya agotada, y terminar la sesión es precisamente lo que este cambio evita.
  if (Date.now() < refreshBlockedUntilMs) {
    return throwError(() => originalError);
  }

  const refreshToken = getRefreshToken();

  if (!refreshToken) {
    // No hay refresh token — sesión expirada
    sessionService.terminateSession('session_expired');
    return EMPTY;
  }

  // Get or create the shared refresh Observable. Using refCount:false
  // so the source subscription is NOT torn down when the first chain's
  // outer subscription completes synchronously after retry — otherwise
  // shareReplay would unsubscribe from the source and the second
  // concurrent 401 would re-invoke refreshToken() against a fresh
  // subscription. With refCount:false, shareReplay holds the cached
  // value indefinitely (the source stays subscribed). Cleanup of the
  // cache happens via queueMicrotask on the outer pipe so production
  // releases the cache once the current batch of 401s has fully
  // drained.
  if (!activeRefresh$) {
    activeRefresh$ = authService.refreshToken().pipe(
      timeout(15000),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
  }

  return activeRefresh$!.pipe(
    switchMap((response: any) => {
      const newToken = response.data?.access_token;
      const newRefreshToken = response.data?.refresh_token;

      if (newToken) {
        refreshBlockedUntilMs = 0;
        updateTokensInAuthState(newToken, newRefreshToken);
        return next(addTokenToRequest(request, newToken));
      }

      // Respuesta 2xx pero sin token: la sesión no se puede renovar y no hay
      // nada que esperar, así que sí se termina.
      sessionService.terminateSession('token_refresh_failed');
      return EMPTY;
    }),
    catchError((err) => handleRefreshFailure(err, sessionService)),
    // Reset the dedup state in a microtask so the test's synchronous
    // flush chain (which subscribes AND completes in the same tick)
    // doesn't trigger a second refreshToken() call before a
    // concurrent 401 lands. Production behavior: after the last
    // subscriber of this batch finishes, the microtask runs and the
    // cache clears, so the next batch of 401s starts fresh.
    finalize(() => {
      queueMicrotask(() => {
        activeRefresh$ = null;
      });
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
