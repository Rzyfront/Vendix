export const environment = {
  production: true,
  apiUrl: 'https://api.vendix.com',
  vendixDomain: 'vendix.com',
  
  // Configuración para producción
  debugDomainDetection: false,
  debugThemeApplication: false,
  debugAuthFlow: false,
  
  // Dominios soportados en producción
  supportedDomains: [
    'vendix.com',
    '*.vendix.com'
  ]
};
