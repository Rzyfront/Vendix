import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { DomainDetectorService } from './domain-detector.service';
import { DomainConfig, DomainType, AppEnvironment } from '../models/domain-config.interface';

describe('DomainDetectorService', () => {
  let service: DomainDetectorService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        DomainDetectorService,
        { provide: PLATFORM_ID, useValue: 'browser' }
      ]
    });

    service = TestBed.inject(DomainDetectorService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('detectDomain', () => {
    it('should detect Vendix core domain (vendix.com)', async () => {
      const result = await service.detectDomain('vendix.com');

      expect(result.domainType).toBe(DomainType.VENDIX_CORE);
      expect(result.environment).toBe(AppEnvironment.VENDIX_LANDING);
      expect(result.isVendixDomain).toBe(true);
      expect(result.hostname).toBe('vendix.com');
    });

    it('should detect Vendix admin domain (admin.vendix.com)', async () => {
      const result = await service.detectDomain('admin.vendix.com');

      expect(result.domainType).toBe(DomainType.VENDIX_CORE);
      expect(result.environment).toBe(AppEnvironment.VENDIX_ADMIN);
      expect(result.isVendixDomain).toBe(true);
    });

    it('should detect localhost development domain', async () => {
      const result = await service.detectDomain('localhost:4200');

      expect(result.domainType).toBe(DomainType.VENDIX_CORE);
      expect(result.environment).toBe(AppEnvironment.VENDIX_LANDING);
      expect(result.isVendixDomain).toBe(true);
    });

    it('should detect organization subdomain (mordoc.vendix.com)', async () => {
      const result = await service.detectDomain('mordoc.vendix.com');

      expect(result.domainType).toBe(DomainType.ORGANIZATION_SUBDOMAIN);
      expect(result.environment).toBe(AppEnvironment.ORG_ADMIN);
      expect(result.organizationSlug).toBe('mordoc');
      expect(result.isVendixDomain).toBe(true);
    });

    it('should detect admin store subdomain (admin-store.vendix.com)', async () => {
      const result = await service.detectDomain('admin-store.vendix.com');

      expect(result.domainType).toBe(DomainType.STORE_SUBDOMAIN);
      expect(result.environment).toBe(AppEnvironment.STORE_ADMIN);
      expect(result.storeSlug).toBe('store');
      expect(result.isVendixDomain).toBe(true);
    });

    it('should detect store subdomain (store.vendix.com)', async () => {
      const result = await service.detectDomain('store.vendix.com');

      expect(result.domainType).toBe(DomainType.STORE_SUBDOMAIN);
      expect(result.environment).toBe(AppEnvironment.STORE_ECOMMERCE);
      expect(result.storeSlug).toBe('store');
      expect(result.isVendixDomain).toBe(true);
    });

    it('should handle custom domain resolution via API', async () => {
      const customDomain = 'tienda-personalizada.com';
      const mockApiResponse = {
        success: true,
        data: {
          type: 'store_custom',
          organizationSlug: 'empresa',
          storeSlug: 'tienda',
          purpose: 'admin',
          config: {}
        }
      };

      const domainPromise = service.detectDomain(customDomain);

      const req = httpMock.expectOne(`${service['API_URL']}/api/public/domains/resolve/${customDomain}`);
      expect(req.request.method).toBe('GET');
      req.flush(mockApiResponse);

      const result = await domainPromise;

      expect(result.domainType).toBe(DomainType.STORE_CUSTOM);
      expect(result.environment).toBe(AppEnvironment.STORE_ADMIN);
      expect(result.organizationSlug).toBe('empresa');
      expect(result.storeSlug).toBe('tienda');
      expect(result.isVendixDomain).toBe(false);
    });

    it('should handle API resolution failure gracefully', async () => {
      const customDomain = 'unknown-domain.com';

      const req = httpMock.expectOne(`${service['API_URL']}/api/public/domains/resolve/${customDomain}`);
      req.flush({ success: false }, { status: 404, statusText: 'Not Found' });

      try {
        await service.detectDomain(customDomain);
        fail('Expected method to throw');
      } catch (error: any) {
        expect(error.message).toContain('Domain unknown-domain.com not found or not configured');
      }
    });

    it('should use window.location.hostname when no hostname provided', async () => {
      // Mock window.location.hostname
      Object.defineProperty(window, 'location', {
        value: { hostname: 'test.vendix.com' },
        writable: true
      });

      const result = await service.detectDomain();

      expect(result.hostname).toBe('test.vendix.com');
    });
  });

  describe('isVendixCoreDomain', () => {
    it('should return true for Vendix core domains', () => {
      expect(service['isVendixCoreDomain']('vendix.com')).toBe(true);
      expect(service['isVendixCoreDomain']('admin.vendix.com')).toBe(true);
      expect(service['isVendixCoreDomain']('localhost')).toBe(true);
      expect(service['isVendixCoreDomain']('127.0.0.1')).toBe(true);
    });

    it('should return false for non-Vendix domains', () => {
      expect(service['isVendixCoreDomain']('google.com')).toBe(false);
      expect(service['isVendixCoreDomain']('tienda.com')).toBe(false);
    });
  });

  describe('getDevelopmentMapping', () => {
    it('should return correct config for development localhost', () => {
      // Mock window.location.port
      Object.defineProperty(window, 'location', {
        value: { port: '4200' },
        writable: true
      });

      const result = service['getDevelopmentMapping']('localhost');

      expect(result?.domainType).toBe(DomainType.VENDIX_CORE);
      expect(result?.environment).toBe(AppEnvironment.VENDIX_LANDING);
      expect(result?.hostname).toBe('localhost:4200');
    });

    it('should return null for unknown development domain', () => {
      const result = service['getDevelopmentMapping']('unknown.localhost');

      expect(result).toBeNull();
    });
  });

  describe('getDomainInfo', () => {
    it('should return correct info for Vendix landing', () => {
      const config: DomainConfig = {
        domainType: DomainType.VENDIX_CORE,
        environment: AppEnvironment.VENDIX_LANDING,
        isVendixDomain: true,
        hostname: 'vendix.com'
      };

      const info = service.getDomainInfo(config);

      expect(info.displayName).toBe('Vendix');
      expect(info.type).toBe('Landing Principal');
      expect(info.description).toBe('Página principal de Vendix');
    });

    it('should return correct info for organization admin', () => {
      const config: DomainConfig = {
        domainType: DomainType.ORGANIZATION_SUBDOMAIN,
        environment: AppEnvironment.ORG_ADMIN,
        organizationSlug: 'empresa',
        isVendixDomain: false,
        hostname: 'empresa.com'
      };

      const info = service.getDomainInfo(config);

      expect(info.displayName).toBe('empresa');
      expect(info.type).toBe('Admin Organizacional');
      expect(info.description).toBe('Panel de administración organizacional');
    });
  });
});