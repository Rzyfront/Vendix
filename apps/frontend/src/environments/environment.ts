export const environment = {
  production: true,
  apiUrl: 'https://api.vendix.online/api',
  vendixDomain: 'vendix.online',
  // GA4 de la portada comercial (solo vendix.online, ver VendixLandingComponent)
  commercialAnalyticsId: 'G-1N43GNPS5Q',
  // Editorial preview: activation requires a separate publication review.
  sectorGuidesEnabled: false,

  // Configuración para producción
  debugDomainDetection: false,
  debugThemeApplication: false,
  debugAuthFlow: false,

  // Nota: Los dominios soportados ahora se obtienen dinámicamente del backend
  // El servicio DomainDetectorService consulta /api/public/config/frontend
  // para obtener la configuración específica del dominio
};
