import { Injectable } from '@angular/core';
import {
  HttpInterceptor,
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpErrorResponse,
} from '@angular/common/http';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError, filter, take, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AuthService } from '../services/auth.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private isRefreshing = false;
  private refreshTokenSubject: BehaviorSubject<string | null> =
    new BehaviorSubject<string | null>(null);

  constructor(private authService: AuthService) { }

  intercept(
    req: HttpRequest<any>,
    next: HttpHandler,
  ): Observable<HttpEvent<any>> {
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
    if (!this.isRefreshing) {
      this.isRefreshing = true;
      this.refreshTokenSubject.next(null);

      const refreshToken = localStorage.getItem('refresh_token');

      if (refreshToken) {
        return this.authService.refreshToken().pipe(
          switchMap((response: any) => {
            this.isRefreshing = false;
            const newToken = response.data?.access_token;
            const newRefreshToken = response.data?.refresh_token;

            if (newToken) {
              localStorage.setItem('access_token', newToken);
              if (newRefreshToken) {
                localStorage.setItem('refresh_token', newRefreshToken);
              }
              this.refreshTokenSubject.next(newToken);
              return next.handle(this.addTokenToRequest(request, newToken));
            }

            // If refresh failed, logout user
            console.warn(
              '[AUTH INTERCEPTOR] Token refresh failed, logging out user',
            );
            this.authService.logout();
            return throwError(() => new Error('Token refresh failed'));
          }),
          catchError((error) => {
            this.isRefreshing = false;
            console.warn(
              '[AUTH INTERCEPTOR] Error during token refresh, logging out user',
              error,
            );
            this.authService.logout();
            return throwError(() => error);
          }),
        );
      }
    }

    // If already refreshing, wait for the new token
    return this.refreshTokenSubject.pipe(
      filter((token) => token !== null),
      take(1),
      switchMap((token) => next.handle(this.addTokenToRequest(request, token))),
    );
  }
}
