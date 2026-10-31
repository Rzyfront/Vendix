const VENDIX_ORIGIN = 'https://vendix.online';
const ORGANIZATION_ID = `${VENDIX_ORIGIN}/#organization`;
const WEBSITE_ID = `${VENDIX_ORIGIN}/#website`;
const SOFTWARE_ID = `${VENDIX_ORIGIN}/#software`;

const VENDIX_DESCRIPTION =
  'Crea tu tienda online, gestiona inventario, punto de venta, envíos y clientes desde un solo lugar. Potenciado con inteligencia artificial. Comienza gratis.';

/** Razón social según el certificado de Cámara de Comercio. */
const VENDIX_LEGAL_NAME = 'QUICKSS SOLUCIONES RÁPIDAS DE SOFTWARE S.A.S.';

/**
 * Perfiles oficiales de Vendix: redes enlazadas en el Perfil de Negocio de
 * Google y el propio perfil (SEO-OPS-27). Ayudan a que buscadores e IA no
 * confundan a Vendix con otras marcas de nombre parecido (SEO-OPS-29).
 */
const VENDIX_SAME_AS = [
  'https://maps.google.com/?cid=2119636985592340036',
  'https://www.instagram.com/vendix.online/',
  'https://www.tiktok.com/@vendix.online',
  'https://www.youtube.com/@VENDIX.ONLINE',
  'https://www.facebook.com/people/Vendix-App-Multitienda/61587350788405/',
];

/** Descripción de la organización: qué es, de quién y desde dónde. */
const VENDIX_ORGANIZATION_DESCRIPTION =
  'Software colombiano de punto de venta (POS), inventario y tienda online desarrollado por Quickss S.A.S. en Riohacha, La Guajira.';

/** Sede declarada sin dirección exacta: el Perfil de Negocio la oculta (área de servicio). */
const VENDIX_ADDRESS = {
  '@type': 'PostalAddress',
  addressLocality: 'Riohacha',
  addressRegion: 'La Guajira',
  addressCountry: 'CO',
};

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
 * Reglas (SEO-TECH-10): solo datos verificables de Vendix (lo que muestra la
 * página y lo publicado en su Perfil de Negocio de Google, como la sede en
 * Riohacha y los perfiles de sameAs, aunque no aparezcan en la página); nunca
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
        description: VENDIX_ORGANIZATION_DESCRIPTION,
        url: `${VENDIX_ORIGIN}/`,
        // 128 px (#945): cumple el mínimo de 112 px de Google sin descargar el PNG de 505 KB.
        logo: `${VENDIX_ORIGIN}/vlogo-128.png`,
        sameAs: VENDIX_SAME_AS,
        address: VENDIX_ADDRESS,
        areaServed: 'CO',
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
