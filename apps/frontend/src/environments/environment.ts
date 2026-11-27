export const environment = {
  production: true,
  apiUrl: 'https://api.vendix.online/api',
  vendixDomain: 'vendix.online',
  // GA4 de la portada comercial (solo vendix.online, ver VendixLandingComponent)
  commercialAnalyticsId: 'G-1N43GNPS5Q',
  // Editorial preview: activation requires a separate publication review.
  sectorGuidesEnabled: false,
  // SEO-OPS-15, 17 y 20: páginas de la plantilla de sector, aprobadas por Adel (Producto y Ventas) el 17-nov-2026.
  sectorPagesEnabled: true,
  // SEO-OPS-19: página /implementacion, aprobada por Adel (Producto y Ventas) el 17-nov-2026.
  implementationPageEnabled: true,
  // SEO-OPS-30: comparativa de POS. Apagada hasta la revisión legal y la firma de Adel.
  comparisonPageEnabled: false,

  // Configuración para producción
  debugDomainDetection: false,
  debugThemeApplication: false,
  debugAuthFlow: false,

  // Nota: Los dominios soportados ahora se obtienen dinámicamente del backend
  // El servicio DomainDetectorService consulta /api/public/config/frontend
  // para obtener la configuración específica del dominio
};
