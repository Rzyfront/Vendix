export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000',
  vendixDomain: 'vendix.com',
  
  // Configuración para desarrollo
  debugDomainDetection: true,
  debugThemeApplication: true,
  debugAuthFlow: true,
  
  // Mapeo de dominios para desarrollo local
  domainMapping: {
    'localhost:4200': {
      type: 'vendix_core',
      environment: 'vendix_landing'
    },
    'mordoc.localhost:4200': {
      type: 'organization_root',
      environment: 'org_landing',
      organizationSlug: 'mordoc'
    },
    'app.mordoc.localhost:4200': {
      type: 'organization_subdomain',
      environment: 'org_admin',
      organizationSlug: 'mordoc'
    },
    'luda.mordoc.localhost:4200': {
      type: 'store_subdomain',
      environment: 'store_ecommerce',
      organizationSlug: 'mordoc',
      storeSlug: 'luda'
    },
    'admin.luda.localhost:4200': {
      type: 'store_subdomain',
      environment: 'store_admin',
      organizationSlug: 'mordoc',
      storeSlug: 'luda'
    }
  }
};
