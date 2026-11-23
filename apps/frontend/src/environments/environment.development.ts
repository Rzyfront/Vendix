export const environment = {
  production: false,
  // apiUrl points to local backend for development
  apiUrl: 'https://api.vendix.com/api',
  vendixDomain: 'vendix.com',
  // Vacío: la portada comercial no mide en desarrollo
  commercialAnalyticsId: '',
  sectorGuidesEnabled: true,
  sectorPagesEnabled: true,
  // SEO-OPS-19: página /implementacion, encendida también en producción desde el 17-nov-2026.
  implementationPageEnabled: true,

  // Configuración para desarrollo
  debugDomainDetection: true,
  debugThemeApplication: true,
  debugAuthFlow: true,

  // Nota: Los mapeos de dominios ahora se obtienen dinámicamente del backend
  // El servicio DomainDetectorService consulta /api/public/config/frontend
  // para obtener la configuración específica del dominio
};
