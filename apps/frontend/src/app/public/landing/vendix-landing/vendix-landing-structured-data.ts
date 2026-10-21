const VENDIX_ORIGIN = 'https://vendix.online';
const ORGANIZATION_ID = `${VENDIX_ORIGIN}/#organization`;
const WEBSITE_ID = `${VENDIX_ORIGIN}/#website`;
const SOFTWARE_ID = `${VENDIX_ORIGIN}/#software`;

const VENDIX_DESCRIPTION =
  'Crea tu tienda online, gestiona inventario, punto de venta, envíos y clientes desde un solo lugar. Potenciado con inteligencia artificial. Comienza gratis.';

/** Razón social según el certificado de Cámara de Comercio. */
const VENDIX_LEGAL_NAME = 'QUICKSS SOLUCIONES RÁPIDAS DE SOFTWARE S.A.S.';

/** Perfiles oficiales publicados en el pie de la landing. */
const VENDIX_SAME_AS = [
  'https://www.instagram.com/vendix.online/',
  'https://www.tiktok.com/@vendix.online',
];

/** Canal de soporte publicado en la landing. */
const VENDIX_CONTACT_POINT = {
  '@type': 'ContactPoint',
  contactType: 'customer support',
  email: 'soporte@vendix.online',
  telephone: '+57-323-466-8500',
  areaServed: 'CO',
  availableLanguage: ['es'],
};

/**
 * JSON-LD (schema.org) de Vendix para la landing. Solo se inyecta en el
 * navegador desde VendixLandingComponent: index.html y el prerender se sirven
 * también a los storefronts de los tenants, así que no puede ir en estático.
 *
 * Reglas (SEO-TECH-10): describe solo lo que muestra la página; nunca
 * calificaciones, reseñas ni precios inventados. Los precios salen de los
 * planes mensuales publicados por GET /api/public/plans.
 */
export function buildVendixStructuredData(
  monthlyPricesCop: readonly number[] = [],
): Record<string, unknown> {
  const prices = monthlyPricesCop.filter(
    (n) => typeof n === 'number' && Number.isFinite(n) && n > 0,
  );

  const software: Record<string, unknown> = {
    '@type': 'SoftwareApplication',
    '@id': SOFTWARE_ID,
    name: 'Vendix',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: `${VENDIX_ORIGIN}/`,
    description: VENDIX_DESCRIPTION,
    inLanguage: 'es-CO',
    publisher: { '@id': ORGANIZATION_ID },
  };

  if (prices.length === 1) {
    software['offers'] = {
      '@type': 'Offer',
      price: String(prices[0]),
      priceCurrency: 'COP',
    };
  } else if (prices.length > 1) {
    software['offers'] = {
      '@type': 'AggregateOffer',
      lowPrice: String(Math.min(...prices)),
      highPrice: String(Math.max(...prices)),
      offerCount: prices.length,
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
        legalName: VENDIX_LEGAL_NAME,
        url: `${VENDIX_ORIGIN}/`,
        logo: `${VENDIX_ORIGIN}/vlogo.png`,
        sameAs: VENDIX_SAME_AS,
        contactPoint: [VENDIX_CONTACT_POINT],
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
