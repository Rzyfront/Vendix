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
import { of, Subject, throwError as rxjsThrowError } from 'rxjs';
import { authInterceptorFn } from './auth.interceptor';
import { AuthService } from '../services/auth.service';
import { SessionService } from '../services/session.service';
import { PLATFORM_ID, signal } from '@angular/core';
import { environment } from '../../../environments/environment';

// URL absoluta prefijada con environment.apiUrl — el interceptor gatea con
// `req.url.startsWith(environment.apiUrl)` (ver auth.interceptor.ts:44,53).
const API_URL = `${environment.apiUrl}/test`;
const API_URL_1 = `${environment.apiUrl}/test1`;
const API_URL_2 = `${environment.apiUrl}/test2`;

// El interceptor lee el refresh token desde `localStorage.getItem('vendix_auth_state')`
// (auth.interceptor.ts:153). Sin sembrar este valor, el código cae en el
// branch `session_expired` en lugar del path de refresh.
const SEED_AUTH_STATE = (access: string, refresh: string) =>
  JSON.stringify({ tokens: { access_token: access, refresh_token: refresh } });

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

    // Sembrar `vendix_auth_state` para que el interceptor entre al path de
    // refresh cuando llegue un 401 (no al branch session_expired).
    // Tests que quieren session_expired pueden localStorage.removeItem explícito.
    localStorage.setItem(
      'vendix_auth_state',
      SEED_AUTH_STATE('initial-access', 'initial-refresh'),
    );

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
    httpMock.verify();
    // Limpia el estado sembrado para que no contamine el siguiente test.
    localStorage.removeItem('vendix_auth_state');
  });

  describe('token attachment', () => {
    it('should add Authorization header for API requests when token exists', () => {
      authServiceSpy.getToken.and.returnValue('test-token');

      httpClient.get(API_URL).subscribe();

      const req = httpMock.expectOne(API_URL);
      expect(req.request.headers.get('Authorization')).toBe(
        'Bearer test-token',
      );
    });

    it('should not add Authorization header for non-API requests', () => {
      authServiceSpy.getToken.and.returnValue('test-token');

      httpClient.get('/external-api/test').subscribe();

      const req = httpMock.expectOne('/external-api/test');
      expect(req.request.headers.get('Authorization')).toBeNull();
    });

    it('should not add Authorization header when no token exists', () => {
      authServiceSpy.getToken.and.returnValue(null);

      httpClient.get(API_URL).subscribe();

      const req = httpMock.expectOne(API_URL);
      expect(req.request.headers.get('Authorization')).toBeNull();
    });
  });

  describe('401 error handling', () => {
    beforeEach(() => {
      authServiceSpy.getToken.and.returnValue('test-token');
    });

    it('should handle 401 errors for API requests', () => {
      authServiceSpy.refreshToken.and.returnValue(
        of({
          data: { access_token: 'new-token' },
        }) as any,
      );

      httpClient.get(API_URL).subscribe();

      const req = httpMock.expectOne(API_URL);
      req.flush({}, { status: 401, statusText: 'Unauthorized' });

      // Should attempt token refresh
      expect(authServiceSpy.refreshToken).toHaveBeenCalled();
    });

    it('should not handle 401 errors for non-API requests', () => {
      httpClient.get('/external/test').subscribe(
        () => fail('Should have thrown error'),
        (error) => {
          expect(error.status).toBe(401);
        },
      );

      const req = httpMock.expectOne('/external/test');
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

      httpClient.get(API_URL).subscribe();

      // First request fails with 401
      const firstReq = httpMock.expectOne(API_URL);
      firstReq.flush({}, { status: 401, statusText: 'Unauthorized' });

      // Second request should have new token
      const secondReq = httpMock.expectOne(API_URL);
      expect(secondReq.request.headers.get('Authorization')).toBe(
        'Bearer new-token',
      );
      secondReq.flush({ data: 'success' });
    });

    it('should terminate session when refresh fails', () => {
      authServiceSpy.refreshToken.and.returnValue(
        rxjsThrowError(() => new Error('Refresh failed')) as any,
      );

      httpClient.get(API_URL).subscribe({
        next: () => {
          // EMPTY completes without next — this branch is fine
        },
        error: () => fail('Interceptor should swallow via EMPTY'),
      });

      const req = httpMock.expectOne(API_URL);
      req.flush({}, { status: 401, statusText: 'Unauthorized' });

      expect(sessionServiceSpy.terminateSession).toHaveBeenCalledWith(
        'token_refresh_failed',
      );
    });

    it('should handle concurrent 401 requests correctly', () => {
      // Subject controlado — `of(...)` síncrono no sirve porque el interceptor
      // setea `isRefreshing=false` antes de que el segundo 401 dispare su handler.
      // Con un Subject plain, el segundo request queda subscripto a `refreshToken$`
      // (otro Subject plain en el módulo) hasta que llamemos `.next()`.
      const refreshSubject = new Subject<any>();
      authServiceSpy.refreshToken.and.returnValue(
        refreshSubject.asObservable() as any,
      );

      // Make two concurrent requests
      httpClient.get(API_URL_1).subscribe();
      httpClient.get(API_URL_2).subscribe();

      // Both should fail with 401
      const req1 = httpMock.expectOne(API_URL_1);
      const req2 = httpMock.expectOne(API_URL_2);
      req1.flush({}, { status: 401, statusText: 'Unauthorized' });
      req2.flush({}, { status: 401, statusText: 'Unauthorized' });

      // After both flushes: req1 entró al refresh path (isRefreshing=true,
      // esperando el Subject), req2 está subscripto a refreshToken$ bloqueado.
      // refreshToken se llamó exactamente 1 vez.
      expect(authServiceSpy.refreshToken).toHaveBeenCalledTimes(1);

      // Emitimos — esto despierta req2 (vía refreshToken$.next) y dispara
      // el retry de ambos con el token nuevo.
      refreshSubject.next({ data: { access_token: 'new-token' } });

      // Both should retry with new token
      const retryReq1 = httpMock.expectOne(API_URL_1);
      const retryReq2 = httpMock.expectOne(API_URL_2);
      expect(retryReq1.request.headers.get('Authorization')).toBe(
        'Bearer new-token',
      );
      expect(retryReq2.request.headers.get('Authorization')).toBe(
        'Bearer new-token',
      );

      retryReq1.flush({ data: 'success1' });
      retryReq2.flush({ data: 'success2' });
      refreshSubject.complete();
    });
  });

  describe('token refresh with rotation', () => {
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

      httpClient.get(API_URL).subscribe();

      const req = httpMock.expectOne(API_URL);
      req.flush({}, { status: 401, statusText: 'Unauthorized' });

      // Should retry with new access token
      const retryReq = httpMock.expectOne(API_URL);
      expect(retryReq.request.headers.get('Authorization')).toBe(
        'Bearer new-access-token',
      );
      retryReq.flush({ data: 'success' });

      // Verificar la rotación: el interceptor escribe ambos tokens al
      // localStorage vía updateTokensInAuthState() (auth.interceptor.ts:165-185).
      // Sin esta aserción, el test pasaría aunque el refresh_token NO rotara.
      const stored = JSON.parse(
        localStorage.getItem('vendix_auth_state') || '{}',
      );
      expect(stored.tokens?.access_token).toBe('new-access-token');
      expect(stored.tokens?.refresh_token).toBe('new-refresh-token');
    });
  });
});
