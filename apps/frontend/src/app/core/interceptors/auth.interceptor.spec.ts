import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { of, throwError as rxjsThrowError } from 'rxjs';
import {
  __resetAuthInterceptorForTests,
  authInterceptorFn,
} from './auth.interceptor';
import { AuthService } from '../services/auth.service';
import { SessionService } from '../services/session.service';
import { environment } from '../../../environments/environment';
import { PLATFORM_ID, signal } from '@angular/core';

/**
 * Base URL the interceptor's URL guard checks against. All API specs
 * build their request URLs from this constant so they match the guard;
 * the one non-API spec uses a URL that does NOT start with it on
 * purpose (the guard must skip it).
 */
const API = environment.apiUrl;

describe('authInterceptorFn', () => {
  let httpMock: HttpTestingController;
  let httpClient: HttpClient;
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let sessionServiceSpy: jasmine.SpyObj<SessionService> & {
    isTerminating: ReturnType<typeof signal<boolean>>;
  };

  beforeEach(() => {
    const authSpy = jasmine.createSpyObj('AuthService', [
      'getToken',
      'refreshToken',
      'logout',
    ]);
    const sessionSpy = jasmine.createSpyObj('SessionService', [
      'terminateSession',
    ]);
    // isTerminating is a signal in SessionService — mock as such.
    (sessionSpy as any).isTerminating = signal(false);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptorFn])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authSpy },
        { provide: SessionService, useValue: sessionSpy },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    httpClient = TestBed.inject(HttpClient);
    authServiceSpy = TestBed.inject(AuthService) as jasmine.SpyObj<AuthService>;
    sessionServiceSpy = TestBed.inject(
      SessionService,
    ) as jasmine.SpyObj<SessionService> & {
      isTerminating: ReturnType<typeof signal<boolean>>;
    };
  });

  afterEach(() => {
    // Clear the seeded refresh token and drain the interceptor's
    // module-scoped refresh state so the next test starts fresh.
    localStorage.removeItem('vendix_auth_state');
    __resetAuthInterceptorForTests();
    httpMock.verify();
  });

  describe('token attachment', () => {
    it('should add Authorization header for API requests when token exists', () => {
      authServiceSpy.getToken.and.returnValue('test-token');

      httpClient.get(`${API}/test`).subscribe();

      const req = httpMock.expectOne(`${API}/test`);
      expect(req.request.headers.get('Authorization')).toBe(
        'Bearer test-token',
      );
    });

    it('should not add Authorization header for non-API requests', () => {
      authServiceSpy.getToken.and.returnValue('test-token');

      // CDN-style URL must not start with environment.apiUrl so the
      // interceptor's URL guard correctly skips the token attachment.
      httpClient.get('https://cdn.example.com/test').subscribe();

      const req = httpMock.expectOne('https://cdn.example.com/test');
      expect(req.request.headers.get('Authorization')).toBeNull();
    });

    it('should not add Authorization header when no token exists', () => {
      authServiceSpy.getToken.and.returnValue(null);

      httpClient.get(`${API}/test`).subscribe();

      const req = httpMock.expectOne(`${API}/test`);
      expect(req.request.headers.get('Authorization')).toBeNull();
    });
  });

  describe('401 error handling', () => {
    beforeEach(() => {
      authServiceSpy.getToken.and.returnValue('test-token');
      // Seed the refresh token the interceptor reads from localStorage.
      // Without it, getRefreshToken() returns null and the interceptor
      // terminates the session instead of retrying.
      localStorage.setItem(
        'vendix_auth_state',
        JSON.stringify({
          tokens: {
            access_token: 'test-token',
            refresh_token: 'test-refresh',
          },
        }),
      );
    });

    it('should handle 401 errors for API requests', () => {
      authServiceSpy.refreshToken.and.returnValue(
        of({
          data: { access_token: 'new-token' },
        }) as any,
      );

      httpClient.get(`${API}/test`).subscribe();

      const req = httpMock.expectOne(`${API}/test`);
      req.flush({}, { status: 401, statusText: 'Unauthorized' });

      // Should attempt token refresh
      expect(authServiceSpy.refreshToken).toHaveBeenCalled();

      // Drain the retry request the interceptor creates — without
      // this, httpMock.verify() in afterEach trips on the dangling
      // request.
      httpMock.expectOne(`${API}/test`).flush({});
    });

    it('should not handle 401 errors for non-API requests', () => {
      httpClient.get('https://cdn.example.com/test').subscribe(
        () => fail('Should have thrown error'),
        (error) => {
          expect(error.status).toBe(401);
        },
      );

      const req = httpMock.expectOne('https://cdn.example.com/test');
      req.flush({}, { status: 401, statusText: 'Unauthorized' });

      // Should not attempt token refresh
      expect(authServiceSpy.refreshToken).not.toHaveBeenCalled();
    });

    it('should retry request with new token after successful refresh', () => {
      authServiceSpy.refreshToken.and.returnValue(
        of({
          data: { access_token: 'new-token' },
        }) as any,
      );

      httpClient.get(`${API}/test`).subscribe();

      // First request fails with 401
      const firstReq = httpMock.expectOne(`${API}/test`);
      firstReq.flush({}, { status: 401, statusText: 'Unauthorized' });

      // Second request should have new token
      const secondReq = httpMock.expectOne(`${API}/test`);
      expect(secondReq.request.headers.get('Authorization')).toBe(
        'Bearer new-token',
      );
      secondReq.flush({ data: 'success' });
    });

    it('should terminate session when refresh fails', () => {
      authServiceSpy.refreshToken.and.returnValue(
        rxjsThrowError(() => new Error('Refresh failed')) as any,
      );

      let captured: unknown = null;
      httpClient.get(`${API}/test`).subscribe({
        next: () => {
          // EMPTY completes without next — this branch is fine.
        },
        error: (err: unknown) => (captured = err),
      });

      const req = httpMock.expectOne(`${API}/test`);
      req.flush({}, { status: 401, statusText: 'Unauthorized' });

      // The interceptor surfaces the error via terminateSession +
      // EMPTY — verify both.
      expect(captured).toBeNull(); // EMPTY swallows the upstream error
      expect(sessionServiceSpy.terminateSession).toHaveBeenCalledWith(
        'token_refresh_failed',
      );
    });

    it('should handle concurrent 401 requests correctly', () => {
      authServiceSpy.refreshToken.and.returnValue(
        of({
          data: { access_token: 'new-token' },
        }) as any,
      );

      // Make two concurrent requests
      httpClient.get(`${API}/test1`).subscribe();
      httpClient.get(`${API}/test2`).subscribe();

      // Both should fail with 401
      const req1 = httpMock.expectOne(`${API}/test1`);
      const req2 = httpMock.expectOne(`${API}/test2`);
      req1.flush({}, { status: 401, statusText: 'Unauthorized' });
      req2.flush({}, { status: 401, statusText: 'Unauthorized' });

      // Should only call refresh once
      expect(authServiceSpy.refreshToken).toHaveBeenCalledTimes(1);

      // Both should retry with new token
      const retryReq1 = httpMock.expectOne(`${API}/test1`);
      const retryReq2 = httpMock.expectOne(`${API}/test2`);
      expect(retryReq1.request.headers.get('Authorization')).toBe(
        'Bearer new-token',
      );
      expect(retryReq2.request.headers.get('Authorization')).toBe(
        'Bearer new-token',
      );

      retryReq1.flush({ data: 'success1' });
      retryReq2.flush({ data: 'success2' });
    });

    it('triggers a fresh refresh after the previous one completes (cache cleared)', async () => {
      // Regression for the shareReplay-based dedup: the cached refresh
      // Observable is cleared via finalize() when refCount drops to 0.
      // A subsequent 401 (after the retry completed) must trigger a new
      // refresh call, not serve a stale cached value.
      authServiceSpy.refreshToken.and.returnValue(
        of({ data: { access_token: 'first-token' } }) as any,
      );

      // First cycle: 401 + retry succeeds.
      httpClient.get(`${API}/test1`).subscribe();
      const firstReq = httpMock.expectOne(`${API}/test1`);
      firstReq.flush({}, { status: 401, statusText: 'Unauthorized' });
      const firstRetry = httpMock.expectOne(`${API}/test1`);
      firstRetry.flush({ data: 'ok' });
      expect(authServiceSpy.refreshToken).toHaveBeenCalledTimes(1);

      // Wait for queueMicrotask in finalize to clear activeRefresh$
      await Promise.resolve();

      // Second cycle: refreshToken now returns a different value. The
      // shareReplay cache should have cleared when both subscribers
      // detached, so a fresh refresh() call must happen.
      authServiceSpy.refreshToken.and.returnValue(
        of({ data: { access_token: 'second-token' } }) as any,
      );
      httpClient.get(`${API}/test2`).subscribe();
      const secondReq = httpMock.expectOne(`${API}/test2`);
      secondReq.flush({}, { status: 401, statusText: 'Unauthorized' });
      const secondRetry = httpMock.expectOne(`${API}/test2`);
      expect(secondRetry.request.headers.get('Authorization')).toBe(
        'Bearer second-token',
      );
      secondRetry.flush({ data: 'ok' });

      expect(authServiceSpy.refreshToken).toHaveBeenCalledTimes(2);
    });
  });

  describe('token refresh with rotation', () => {
    beforeEach(() => {
      // Seed both tokens so the rotation path can persist the new
      // refresh_token back to localStorage.
      localStorage.setItem(
        'vendix_auth_state',
        JSON.stringify({
          tokens: {
            access_token: 'test-token',
            refresh_token: 'test-refresh',
          },
        }),
      );
    });

    it('should update both access and refresh tokens when provided', () => {
      authServiceSpy.getToken.and.returnValue('test-token');
      authServiceSpy.refreshToken.and.returnValue(
        of({
          data: {
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
          },
        }) as any,
      );

      httpClient.get(`${API}/test`).subscribe();

      const req = httpMock.expectOne(`${API}/test`);
      req.flush({}, { status: 401, statusText: 'Unauthorized' });

      // Should retry with new access token
      const retryReq = httpMock.expectOne(`${API}/test`);
      expect(retryReq.request.headers.get('Authorization')).toBe(
        'Bearer new-access-token',
      );
      retryReq.flush({ data: 'success' });
    });
  });
});
