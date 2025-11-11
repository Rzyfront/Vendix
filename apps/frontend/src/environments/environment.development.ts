export const environment = {
  production: false,
  // apiUrl is forced to the production API endpoint. This ensures the frontend
  // always calls the correct backend when served in Docker/nginx.
  apiUrl: 'https://api.vendix.com/api',
  vendixDomain: 'vendix.com',

  // Configuración para desarrollo
  debugDomainDetection: true,
  debugThemeApplication: true,
  debugAuthFlow: true,

  // Nota: Los mapeos de dominios ahora se obtienen dinámicamente del backend
  // El servicio DomainDetectorService consulta /api/public/config/frontend
  // para obtener la configuración específica del dominio
};
