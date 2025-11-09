export const environment = {
  production: true,
  apiUrl: 'https://2bd2zjyqme.us-east-1.awsapprunner.com/api',
  vendixDomain: 'vendix.online',

  // Configuración para producción
  debugDomainDetection: false,
  debugThemeApplication: false,
  debugAuthFlow: false,

  // Nota: Los dominios soportados ahora se obtienen dinámicamente del backend
  // El servicio DomainDetectorService consulta /api/public/config/frontend
  // para obtener la configuración específica del dominio
};
