import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError, filter, take, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AuthService } from '../services/auth.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private isRefreshing = false;
  private refreshTokenSubject: BehaviorSubject<string | null> = new BehaviorSubject<string | null>(null);

  constructor(private authService: AuthService) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Add auth token to request if available and URL starts with API base
    const authToken = this.authService.getToken();

    if (authToken && req.url.startsWith(environment.apiUrl)) {
      req = this.addTokenToRequest(req, authToken);
    }

    return next.handle(req).pipe(
      catchError(error => {
        if (error instanceof HttpErrorResponse && error.status === 401 && req.url.startsWith(environment.apiUrl)) {
          return this.handle401Error(req, next);
        }
        return throwError(() => error);
      })
    );
  }

  private addTokenToRequest(request: HttpRequest<any>, token: string): HttpRequest<any> {
    return request.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  private handle401Error(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
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
            this.authService.logout();
            return throwError(() => new Error('Token refresh failed'));
          }),
          catchError((error) => {
            this.isRefreshing = false;
            this.authService.logout();
            return throwError(() => error);
          })
        );
      }
    }

    // If already refreshing, wait for the new token
    return this.refreshTokenSubject.pipe(
      filter(token => token !== null),
      take(1),
      switchMap((token) => next.handle(this.addTokenToRequest(request, token)))
    );
  }
}
