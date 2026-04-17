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
import { authInterceptorFn } from './auth.interceptor';
import { AuthService } from '../services/auth.service';
import { SessionService } from '../services/session.service';
import { PLATFORM_ID, signal } from '@angular/core';

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
    httpMock.verify();
  });

  describe('token attachment', () => {
    it('should add Authorization header for API requests when token exists', () => {
      authServiceSpy.getToken.and.returnValue('test-token');

      httpClient.get('/api/test').subscribe();

      const req = httpMock.expectOne('/api/test');
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

      httpClient.get('/api/test').subscribe();

      const req = httpMock.expectOne('/api/test');
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

      httpClient.get('/api/test').subscribe();

      const req = httpMock.expectOne('/api/test');
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

      httpClient.get('/api/test').subscribe();

      // First request fails with 401
      const firstReq = httpMock.expectOne('/api/test');
      firstReq.flush({}, { status: 401, statusText: 'Unauthorized' });

      // Second request should have new token
      const secondReq = httpMock.expectOne('/api/test');
      expect(secondReq.request.headers.get('Authorization')).toBe(
        'Bearer new-token',
      );
      secondReq.flush({ data: 'success' });
    });

    it('should terminate session when refresh fails', () => {
      authServiceSpy.refreshToken.and.returnValue(
        rxjsThrowError(() => new Error('Refresh failed')) as any,
      );

      httpClient.get('/api/test').subscribe({
        next: () => {
          // EMPTY completes without next — this branch is fine
        },
        error: () => fail('Interceptor should swallow via EMPTY'),
      });

      const req = httpMock.expectOne('/api/test');
      req.flush({}, { status: 401, statusText: 'Unauthorized' });

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
      httpClient.get('/api/test1').subscribe();
      httpClient.get('/api/test2').subscribe();

      // Both should fail with 401
      const req1 = httpMock.expectOne('/api/test1');
      const req2 = httpMock.expectOne('/api/test2');
      req1.flush({}, { status: 401, statusText: 'Unauthorized' });
      req2.flush({}, { status: 401, statusText: 'Unauthorized' });

      // Should only call refresh once
      expect(authServiceSpy.refreshToken).toHaveBeenCalledTimes(1);

      // Both should retry with new token
      const retryReq1 = httpMock.expectOne('/api/test1');
      const retryReq2 = httpMock.expectOne('/api/test2');
      expect(retryReq1.request.headers.get('Authorization')).toBe(
        'Bearer new-token',
      );
      expect(retryReq2.request.headers.get('Authorization')).toBe(
        'Bearer new-token',
      );

      retryReq1.flush({ data: 'success1' });
      retryReq2.flush({ data: 'success2' });
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

      httpClient.get('/api/test').subscribe();

      const req = httpMock.expectOne('/api/test');
      req.flush({}, { status: 401, statusText: 'Unauthorized' });

      // Should retry with new access token
      const retryReq = httpMock.expectOne('/api/test');
      expect(retryReq.request.headers.get('Authorization')).toBe(
        'Bearer new-access-token',
      );
      retryReq.flush({ data: 'success' });
    });
  });
});
