import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TenantConfigService } from './tenant-config.service';
import { DomainConfig, DomainType, AppEnvironment } from '../models/domain-config.interface';

describe('TenantConfigService', () => {
  let service: TenantConfigService;
  let httpMock: HttpTestingController;

  // Helper function to create complete mock TenantConfig
  const createMockTenantConfig = (overrides: any = {}) => ({
    organization: { id: '1', name: 'Test Org', slug: 'test' },
    branding: {
      logo: { url: '/logo.png', alt: 'Logo', width: 100, height: 40 },
      colors: {
        primary: '#000000',
        secondary: '#666666',
        accent: '#999999',
        background: '#FFFFFF',
        surface: '#F5F5F5',
        text: { primary: '#000000', secondary: '#666666', muted: '#999999' }
      },
      fonts: { primary: 'Arial', secondary: 'Arial', headings: 'Arial' }
    },
    theme: {
      name: 'test-theme',
      primaryColor: '#000000',
      secondaryColor: '#666666',
      accentColor: '#999999',
      backgroundColor: '#FFFFFF',
      textColor: '#000000',
      fontFamily: 'Arial',
      borderRadius: '4px',
      spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px' },
      shadows: { sm: '0 1px 2px rgba(0,0,0,0.1)', md: '0 4px 6px rgba(0,0,0,0.1)', lg: '0 10px 15px rgba(0,0,0,0.1)' }
    },
    features: { analytics: false, inventory: false },
    seo: { title: 'Test', description: 'Test description', keywords: [] },
    ...overrides
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [TenantConfigService]
    });

    service = TestBed.inject(TenantConfigService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('loadTenantConfig', () => {
    it('should return Vendix default config for Vendix domains', async () => {
      const domainConfig: DomainConfig = {
        domainType: DomainType.VENDIX_CORE,
        environment: AppEnvironment.VENDIX_LANDING,
        isVendixDomain: true,
        hostname: 'vendix.com'
      };

      const result = await service.loadTenantConfig(domainConfig);

      expect(result?.organization.name).toBe('Vendix');
      expect(result?.organization.slug).toBe('vendix');
      expect(result?.branding.colors.primary).toBe('#3B82F6');
      expect(result?.theme.name).toBe('vendix-default');
    });

    it('should fetch config from API for custom domains', async () => {
      const domainConfig: DomainConfig = {
        domainType: DomainType.STORE_CUSTOM,
        environment: AppEnvironment.STORE_ECOMMERCE,
        organizationSlug: 'empresa',
        storeSlug: 'tienda',
        isVendixDomain: false,
        hostname: 'tienda.com'
      };

      const mockApiResponse = {
        success: true,
        data: {
          organization: { id: '1', name: 'Empresa', slug: 'empresa' },
          store: { id: '1', name: 'Tienda', slug: 'tienda' },
          branding: { colors: { primary: '#FF0000' } },
          theme: { name: 'custom-theme' }
        }
      };

      const configPromise = service.loadTenantConfig(domainConfig);

      const req = httpMock.expectOne(`${service['API_URL']}/api/tenants/store/empresa/tienda`);
      expect(req.request.method).toBe('GET');
      req.flush(mockApiResponse);

      const result = await configPromise;

      expect(result?.organization.name).toBe('Empresa');
      expect(result?.store?.name).toBe('Tienda');
      expect(result?.branding.colors.primary).toBe('#FF0000');
    });

    it('should use cached config when available', async () => {
      const domainConfig: DomainConfig = {
        domainType: DomainType.ORGANIZATION_SUBDOMAIN,
        environment: AppEnvironment.ORG_ADMIN,
        organizationSlug: 'empresa',
        isVendixDomain: false,
        hostname: 'empresa.com'
      };

      // First call - should fetch from API
      const mockApiResponse = {
        success: true,
        data: {
          organization: { id: '1', name: 'Empresa', slug: 'empresa' },
          branding: { colors: { primary: '#00FF00' } },
          theme: { name: 'cached-theme' }
        }
      };

      const firstPromise = service.loadTenantConfig(domainConfig);
      const req = httpMock.expectOne(`${service['API_URL']}/api/tenants/organization/empresa`);
      req.flush(mockApiResponse);
      await firstPromise;

      // Second call - should use cache
      const secondResult = await service.loadTenantConfig(domainConfig);

      expect(secondResult?.organization.name).toBe('Empresa');
      expect(secondResult?.branding.colors.primary).toBe('#00FF00');

      // Should not make another HTTP request
      httpMock.expectNone(`${service['API_URL']}/api/tenants/organization/empresa`);
    });

    it('should handle API errors gracefully', async () => {
      const domainConfig: DomainConfig = {
        domainType: DomainType.STORE_SUBDOMAIN,
        environment: AppEnvironment.STORE_ADMIN,
        organizationSlug: 'empresa',
        storeSlug: 'tienda',
        isVendixDomain: false,
        hostname: 'tienda.com'
      };

      const req = httpMock.expectOne(`${service['API_URL']}/api/tenants/store/empresa/tienda`);
      req.flush({ success: false }, { status: 404, statusText: 'Not Found' });

      const result = await service.loadTenantConfig(domainConfig);

      expect(result).toBeNull();
    });
  });

  describe('getCurrentTenantConfig', () => {
    it('should return current tenant config', () => {
      const mockConfig = createMockTenantConfig({
        organization: { id: '1', name: 'Test Org', slug: 'test' }
      });

      service['tenantConfigSubject'].next(mockConfig);

      const result = service.getCurrentTenantConfig();

      expect(result?.organization.name).toBe('Test Org');
    });

    it('should return null when no config is set', () => {
      service['tenantConfigSubject'].next(null);

      const result = service.getCurrentTenantConfig();

      expect(result).toBeNull();
    });
  });

  describe('getCurrentDomainConfig', () => {
    it('should return current domain config', () => {
      const mockDomainConfig: DomainConfig = {
        domainType: DomainType.VENDIX_CORE,
        environment: AppEnvironment.VENDIX_LANDING,
        isVendixDomain: true,
        hostname: 'vendix.com'
      };

      service['domainConfigSubject'].next(mockDomainConfig);

      const result = service.getCurrentDomainConfig();

      expect(result?.hostname).toBe('vendix.com');
    });
  });

  describe('updateTenantConfig', () => {
    it('should update current tenant config', () => {
      const initialConfig = createMockTenantConfig({
        organization: { id: '1', name: 'Test Org', slug: 'test' },
        branding: {
          colors: {
            primary: '#000000',
            secondary: '#666666',
            accent: '#999999',
            background: '#FFFFFF',
            surface: '#F5F5F5',
            text: { primary: '#000000', secondary: '#666666', muted: '#999999' }
          }
        }
      });

      service['tenantConfigSubject'].next(initialConfig);

      service.updateTenantConfig({
        branding: {
          logo: { url: '/logo.png', alt: 'Logo', width: 100, height: 40 },
          colors: {
            primary: '#FFFFFF',
            secondary: '#666666',
            accent: '#999999',
            background: '#FFFFFF',
            surface: '#F5F5F5',
            text: { primary: '#000000', secondary: '#666666', muted: '#999999' }
          },
          fonts: { primary: 'Arial', secondary: 'Arial', headings: 'Arial' }
        }
      });

      const updatedConfig = service.getCurrentTenantConfig();

      expect(updatedConfig?.branding.colors.primary).toBe('#FFFFFF');
      expect(updatedConfig?.organization.name).toBe('Test Org'); // Should remain unchanged
    });
  });

  describe('clearCache', () => {
    it('should clear the config cache', () => {
      const domainConfig: DomainConfig = {
        domainType: DomainType.ORGANIZATION_SUBDOMAIN,
        environment: AppEnvironment.ORG_ADMIN,
        organizationSlug: 'empresa',
        isVendixDomain: false,
        hostname: 'empresa.com'
      };

      // Add something to cache
      service['configCache'].set('test-key', {} as any);

      expect(service['configCache'].has('test-key')).toBe(true);

      service.clearCache();

      expect(service['configCache'].has('test-key')).toBe(false);
    });
  });

  describe('isFeatureEnabled', () => {
    it('should return true for enabled features', () => {
      const mockConfig = createMockTenantConfig({
        features: {
          analytics: true,
          inventory: false
        }
      });

      service['tenantConfigSubject'].next(mockConfig);

      expect(service.isFeatureEnabled('analytics')).toBe(true);
      expect(service.isFeatureEnabled('inventory')).toBe(false);
      expect(service.isFeatureEnabled('nonexistent')).toBe(false);
    });

    it('should return false when no config is set', () => {
      service['tenantConfigSubject'].next(null);

      expect(service.isFeatureEnabled('analytics')).toBe(false);
    });
  });

  describe('getCurrentOrganization', () => {
    it('should return current organization', () => {
      const mockConfig = createMockTenantConfig({
        organization: { id: '1', name: 'Test Org', slug: 'test' }
      });

      service['tenantConfigSubject'].next(mockConfig);

      const result = service.getCurrentOrganization();

      expect(result?.name).toBe('Test Org');
    });

    it('should return null when no organization is set', () => {
      service['tenantConfigSubject'].next(null);

      const result = service.getCurrentOrganization();

      expect(result).toBeNull();
    });
  });

  describe('getCurrentStore', () => {
    it('should return current store', () => {
      const mockConfig = createMockTenantConfig({
        store: { id: '1', name: 'Test Store', slug: 'test' }
      });

      service['tenantConfigSubject'].next(mockConfig);

      const result = service.getCurrentStore();

      expect(result?.name).toBe('Test Store');
    });

    it('should return null when no store is set', () => {
      service['tenantConfigSubject'].next(null);

      const result = service.getCurrentStore();

      expect(result).toBeNull();
    });
  });

  describe('isVendixDomain', () => {
    it('should return true for Vendix domains', () => {
      const mockDomainConfig: DomainConfig = {
        domainType: DomainType.VENDIX_CORE,
        environment: AppEnvironment.VENDIX_LANDING,
        isVendixDomain: true,
        hostname: 'vendix.com'
      };

      service['domainConfigSubject'].next(mockDomainConfig);

      expect(service.isVendixDomain()).toBe(true);
    });

    it('should return false for non-Vendix domains', () => {
      const mockDomainConfig: DomainConfig = {
        domainType: DomainType.STORE_CUSTOM,
        environment: AppEnvironment.STORE_ECOMMERCE,
        isVendixDomain: false,
        hostname: 'tienda.com'
      };

      service['domainConfigSubject'].next(mockDomainConfig);

      expect(service.isVendixDomain()).toBe(false);
    });
  });

  describe('getCurrentEnvironment', () => {
    it('should return current environment', () => {
      const mockDomainConfig: DomainConfig = {
        domainType: DomainType.VENDIX_CORE,
        environment: AppEnvironment.VENDIX_ADMIN,
        isVendixDomain: true,
        hostname: 'admin.vendix.com'
      };

      service['domainConfigSubject'].next(mockDomainConfig);

      expect(service.getCurrentEnvironment()).toBe(AppEnvironment.VENDIX_ADMIN);
    });

    it('should return null when no domain config is set', () => {
      service['domainConfigSubject'].next(null);

      expect(service.getCurrentEnvironment()).toBeNull();
    });
  });
});