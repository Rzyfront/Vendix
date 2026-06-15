export const environment = {
  production: false,
  // apiUrl is relative so Angular's dev-server proxy forwards /api/* to https://api.vendix.com
  // (avoids CORS by keeping the request same-origin at localhost:4200)
  apiUrl: '/api',
  vendixDomain: 'vendix.com',

  // Configuración para desarrollo
  debugDomainDetection: true,
  debugThemeApplication: true,
  debugAuthFlow: true,

  // Nota: Los mapeos de dominios ahora se obtienen dinámicamente del backend
  // El servicio DomainDetectorService consulta /api/public/config/frontend
  // para obtener la configuración específica del dominio
};
