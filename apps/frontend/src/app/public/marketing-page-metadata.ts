import { Meta, Title } from '@angular/platform-browser';

/**
 * Metadatos de una página de la web comercial de Vendix (SEO-TECH-04).
 *
 * `canonicalPath: null` quita el canonical: una página `noindex` (auth, ayuda
 * sin contenido) no debe canonicalizar a la portada, que es lo que hereda hoy
 * del `index.html` compartido.
 */
export interface MarketingPageMetadata {
  title: string;
  description: string;
  robots: 'index, follow' | 'noindex, follow';
  canonicalPath: string | null;
}

interface MetaTagValue {
  attr: 'name' | 'property';
  key: string;
  content: string;
}

function selectorOf(tag: MetaTagValue): string {
  return `${tag.attr}="${tag.key}"`;
}

const MARKETING_HOSTS = new Set(['vendix.online', 'www.vendix.online', 'vendix.com', 'www.vendix.com']);

/**
 * Aplica los metadatos de la página solo en el host comercial y devuelve la
 * función que los restaura al salir. Fuera del host comercial (tiendas y
 * dominios propios, que comparten estos componentes de auth) no toca nada.
 *
 * Igual que `createLegalDocumentMetadata`, solo restaura un valor si sigue
 * siendo el que se puso aquí: si la página siguiente ya escribió el suyo,
 * no se pisa.
 */
export function applyMarketingPageMetadata(
  document: Document,
  title: Title,
  meta: Meta,
  page: MarketingPageMetadata,
): () => void {
  const url = new URL(document.URL);
  if (!MARKETING_HOSTS.has(url.hostname)) return () => {};

  const previousTitle = title.getTitle();
  const origin = url.hostname.endsWith('.com') ? 'https://vendix.com' : 'https://vendix.online';
  const appliedHref = page.canonicalPath === null ? null : origin + page.canonicalPath;

  // Una página con URL propia también se comparte: sin esto og:* y twitter:*
  // siguen diciendo los de la portada (og:url = `/`) en la tarjeta de /pricing.
  const tags: MetaTagValue[] = [
    { attr: 'name', key: 'description', content: page.description },
    { attr: 'name', key: 'robots', content: page.robots },
  ];
  if (appliedHref !== null) {
    tags.push(
      { attr: 'property', key: 'og:title', content: page.title },
      { attr: 'property', key: 'og:description', content: page.description },
      { attr: 'property', key: 'og:url', content: appliedHref },
      { attr: 'name', key: 'twitter:title', content: page.title },
      { attr: 'name', key: 'twitter:description', content: page.description },
    );
  }
  const previous = tags.map((tag) => {
    const node = meta.getTag(selectorOf(tag));
    return { tag, node, content: node?.getAttribute('content') ?? null };
  });

  const originalCanonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const previousHref = originalCanonical?.getAttribute('href') ?? null;
  const canonical = originalCanonical ?? document.createElement('link');
  canonical.rel = 'canonical';
  if (!originalCanonical) document.head.appendChild(canonical);

  title.setTitle(page.title);
  for (const tag of tags) meta.updateTag({ [tag.attr]: tag.key, content: tag.content });
  if (appliedHref === null) canonical.removeAttribute('href');
  else canonical.setAttribute('href', appliedHref);

  return () => {
    if (title.getTitle() === page.title) title.setTitle(previousTitle);
    for (const { tag, node, content } of previous) {
      const current = meta.getTag(selectorOf(tag));
      if (current?.content !== tag.content) continue;
      if (!node) current?.remove();
      else if (content === null) current?.removeAttribute('content');
      else current?.setAttribute('content', content);
    }
    if (!canonical.isConnected || canonical.getAttribute('href') !== appliedHref) return;
    if (!originalCanonical) canonical.remove();
    else if (previousHref === null) canonical.removeAttribute('href');
    else canonical.setAttribute('href', previousHref);
  };
}

/** Metadatos de las páginas comerciales con ruta propia. Textos sin claims sin respaldo (claims-register). */
export const MARKETING_PAGES = {
  pricing: {
    title: 'Planes y precios de Vendix | POS, inventario y facturación electrónica',
    description:
      'Compara los planes de Vendix: Impulsa, Emprendedor, Empresarial Pro e IA Business. Todos incluyen POS, inventario, tienda en línea y contabilidad. Precios en COP y sin permanencia.',
    robots: 'index, follow',
    canonicalPath: '/pricing',
  },
  help: {
    title: 'Centro de ayuda | Vendix',
    description: 'Contacta al soporte de Vendix y radica peticiones, quejas o reclamos.',
    robots: 'noindex, follow',
    canonicalPath: null,
  },
  login: {
    title: 'Iniciar sesión | Vendix',
    description: 'Ingresa a tu cuenta de Vendix.',
    robots: 'noindex, follow',
    canonicalPath: null,
  },
  register: {
    title: 'Crea tu cuenta | Vendix',
    description: 'Crea tu cuenta de Vendix y empieza la prueba gratis de 14 días.',
    robots: 'noindex, follow',
    canonicalPath: null,
  },
  forgotPassword: {
    title: 'Recuperar contraseña | Vendix',
    description: 'Solicita el enlace para recuperar la contraseña de tu cuenta de Vendix.',
    robots: 'noindex, follow',
    canonicalPath: null,
  },
  resetPassword: {
    title: 'Restablecer contraseña | Vendix',
    description: 'Define una nueva contraseña para tu cuenta de Vendix.',
    robots: 'noindex, follow',
    canonicalPath: null,
  },
  verifyEmail: {
    title: 'Verificar correo | Vendix',
    description: 'Confirma el correo electrónico de tu cuenta de Vendix.',
    robots: 'noindex, follow',
    canonicalPath: null,
  },
  pqr: {
    title: 'Peticiones, quejas y reclamos | Vendix',
    description: 'Radica una petición, queja o reclamo ante Vendix.',
    robots: 'noindex, follow',
    canonicalPath: null,
  },
  pqrTrack: {
    title: 'Consultar PQR | Vendix',
    description: 'Consulta el estado de tu petición, queja o reclamo con su número de radicado.',
    robots: 'noindex, follow',
    canonicalPath: null,
  },
} satisfies Record<string, MarketingPageMetadata>;
