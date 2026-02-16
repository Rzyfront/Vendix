import { Injectable, inject } from '@angular/core';
import {
  HttpInterceptor,
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpErrorResponse,
} from '@angular/common/http';
import { Observable, throwError, BehaviorSubject, EMPTY } from 'rxjs';
import { catchError, filter, take, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AuthService } from '../services/auth.service';
import { SessionService } from '../services/session.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private isRefreshing = false;
  private refreshTokenSubject: BehaviorSubject<string | null> =
    new BehaviorSubject<string | null>(null);

  private sessionService = inject(SessionService);

  constructor(private authService: AuthService) { }

  intercept(
    req: HttpRequest<any>,
    next: HttpHandler,
  ): Observable<HttpEvent<any>> {
    // Si la sesión se está terminando, cancelar requests pendientes
    if (this.sessionService.isTerminating()) {
      console.log('[AUTH INTERCEPTOR] Session terminating, cancelling request:', req.url);
      return EMPTY;
    }

    // Add auth token to request if available and URL starts with API base
    const authToken = this.authService.getToken();

    // Enhanced logging for environment switch debugging
    if (req.url.includes('switch-environment')) {
      console.log('[AUTH INTERCEPTOR] Environment switch request detected');
      console.log('[AUTH INTERCEPTOR] Request URL:', req.url);
      console.log('[AUTH INTERCEPTOR] API URL:', environment.apiUrl);
      console.log(
        '[AUTH INTERCEPTOR] URL starts with API base:',
        req.url.startsWith(environment.apiUrl),
      );
      console.log('[AUTH INTERCEPTOR] Auth token available:', !!authToken);
      console.log('[AUTH INTERCEPTOR] Request headers:', req.headers.keys());
    }

    if (authToken && req.url.startsWith(environment.apiUrl)) {
      req = this.addTokenToRequest(req, authToken);

      if (req.url.includes('switch-environment')) {
        console.log(
          '[AUTH INTERCEPTOR] Token added to environment switch request',
        );
      }
    } else if (req.url.includes('switch-environment')) {
      console.warn(
        '[AUTH INTERCEPTOR] No token available for environment switch!',
      );
    }

    return next.handle(req).pipe(
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
            console.log(
              '[AUTH INTERCEPTOR] 401 on unauthenticated request (no token sent), passing through:',
              req.url,
            );
            return throwError(() => error);
          }

          console.warn(
            '[AUTH INTERCEPTOR] 401 detected for request:',
            req.url,
            error,
          );
          return this.handle401Error(req, next);
        }
        return throwError(() => error);
      }),
    );
  }

  private addTokenToRequest(
    request: HttpRequest<any>,
    token: string,
  ): HttpRequest<any> {
    const authReq = request.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
    });

    // Enhanced logging for environment switch
    if (request.url.includes('switch-environment')) {
      console.log(
        '[AUTH INTERCEPTOR] Authorization header added:',
        authReq.headers.get('Authorization') ? 'Present' : 'Missing',
      );
    }

    return authReq;
  }

  private handle401Error(
    request: HttpRequest<any>,
    next: HttpHandler,
  ): Observable<HttpEvent<any>> {
    // Si la sesión ya se está terminando, no procesar más
    if (this.sessionService.isTerminating()) {
      return EMPTY;
    }

    if (!this.isRefreshing) {
      this.isRefreshing = true;
      this.refreshTokenSubject.next(null);

      const refreshToken = this.getRefreshToken();

      if (refreshToken) {
        return this.authService.refreshToken().pipe(
          switchMap((response: any) => {
            this.isRefreshing = false;
            const newToken = response.data?.access_token;
            const newRefreshToken = response.data?.refresh_token;

            if (newToken) {
              this.updateTokensInAuthState(newToken, newRefreshToken);
              this.refreshTokenSubject.next(newToken);
              return next.handle(this.addTokenToRequest(request, newToken));
            }

            // Si refresh falló, terminar sesión limpiamente
            console.warn('[AUTH INTERCEPTOR] Token refresh failed, terminating session');
            this.sessionService.terminateSession('token_refresh_failed');
            return EMPTY; // No propagar error
          }),
          catchError((error) => {
            this.isRefreshing = false;
            console.warn('[AUTH INTERCEPTOR] Error during token refresh', error);
            // Terminar sesión limpiamente
            this.sessionService.terminateSession('token_refresh_failed');
            return EMPTY; // No propagar error
          }),
        );
      } else {
        // No hay refresh token - sesión expirada
        this.isRefreshing = false;
        this.sessionService.terminateSession('session_expired');
        return EMPTY;
      }
    }

    // Si ya estamos refrescando, esperar el nuevo token
    return this.refreshTokenSubject.pipe(
      filter((token) => token !== null),
      take(1),
      switchMap((token) => {
        // Verificar si la sesión terminó mientras esperábamos
        if (this.sessionService.isTerminating()) {
          return EMPTY;
        }
        return next.handle(this.addTokenToRequest(request, token));
      }),
    );
  }

  /**
   * Helper method to get refresh token from vendix_auth_state
   */
  private getRefreshToken(): string | null {
    try {
      const authState = localStorage.getItem('vendix_auth_state');
      if (!authState) return null;
      const parsed = JSON.parse(authState);
      return parsed.tokens?.refresh_token || null;
    } catch (e) {
      console.error('❌ Error reading refresh token from auth state:', e);
      return null;
    }
  }

  /**
   * Helper method to update tokens in vendix_auth_state
   */
  private updateTokensInAuthState(accessToken: string, refreshToken?: string): void {
    try {
      const authState = localStorage.getItem('vendix_auth_state');
      if (!authState) {
        console.warn('[AUTH INTERCEPTOR] No auth state found to update tokens');
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
    } catch (e) {
      console.error('❌ Error updating tokens in auth state:', e);
    }
  }
}
