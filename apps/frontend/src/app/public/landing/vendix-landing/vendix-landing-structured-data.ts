const VENDIX_ORIGIN = 'https://vendix.online';
const ORGANIZATION_ID = `${VENDIX_ORIGIN}/#organization`;
const WEBSITE_ID = `${VENDIX_ORIGIN}/#website`;

const VENDIX_DESCRIPTION =
  'Crea tu tienda online, gestiona inventario, punto de venta, envíos y clientes desde un solo lugar. Potenciado con inteligencia artificial. Comienza gratis.';

/**
 * JSON-LD (schema.org) de Vendix para la landing. Solo se inyecta en el
 * navegador desde VendixLandingComponent: index.html y el prerender se sirven
 * también a los storefronts de los tenants, así que no puede ir en estático.
 */
export function buildVendixStructuredData(
  minMonthlyPriceCop?: number | null,
): Record<string, unknown> {
  const software: Record<string, unknown> = {
    '@type': 'SoftwareApplication',
    name: 'Vendix',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: `${VENDIX_ORIGIN}/`,
    description: VENDIX_DESCRIPTION,
    publisher: { '@id': ORGANIZATION_ID },
  };

  if (
    typeof minMonthlyPriceCop === 'number' &&
    Number.isFinite(minMonthlyPriceCop) &&
    minMonthlyPriceCop > 0
  ) {
    software['offers'] = {
      '@type': 'Offer',
      price: String(minMonthlyPriceCop),
      priceCurrency: 'COP',
    };
  }

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': ORGANIZATION_ID,
        name: 'Vendix',
        url: `${VENDIX_ORIGIN}/`,
        logo: `${VENDIX_ORIGIN}/vlogo.png`,
      },
      {
        '@type': 'WebSite',
        '@id': WEBSITE_ID,
        url: `${VENDIX_ORIGIN}/`,
        name: 'Vendix',
        inLanguage: 'es-CO',
        publisher: { '@id': ORGANIZATION_ID },
      },
      software,
    ],
  };
}
