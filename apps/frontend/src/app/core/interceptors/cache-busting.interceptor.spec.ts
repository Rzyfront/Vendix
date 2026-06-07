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
import { cacheBustingInterceptor } from './cache-busting.interceptor';
import { environment } from '../../../environments/environment';

describe('cacheBustingInterceptor', () => {
  let httpMock: HttpTestingController;
  let httpClient: HttpClient;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([cacheBustingInterceptor])),
        provideHttpClientTesting(),
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    httpClient = TestBed.inject(HttpClient);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should add Cache-Control: no-cache to GET requests targeting the API', () => {
    httpClient.get(`${environment.apiUrl}/products`).subscribe();

    const req = httpMock.expectOne(`${environment.apiUrl}/products`);
    expect(req.request.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('should not add Cache-Control to GET requests targeting non-API URLs', () => {
    httpClient.get('https://cdn.example.com/asset.png').subscribe();

    const req = httpMock.expectOne('https://cdn.example.com/asset.png');
    expect(req.request.headers.get('Cache-Control')).toBeNull();
  });

  it('should not add Cache-Control to non-GET requests targeting the API', () => {
    httpClient.post(`${environment.apiUrl}/products`, {}).subscribe();

    const req = httpMock.expectOne(`${environment.apiUrl}/products`);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Cache-Control')).toBeNull();
  });

  it('should preserve existing headers when adding Cache-Control', () => {
    httpClient
      .get(`${environment.apiUrl}/products`, {
        headers: { 'X-Custom': 'value' },
      })
      .subscribe();

    const req = httpMock.expectOne(`${environment.apiUrl}/products`);
    expect(req.request.headers.get('Cache-Control')).toBe('no-cache');
    expect(req.request.headers.get('X-Custom')).toBe('value');
  });
});
