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
  const names = ['description', 'robots'] as const;
  const previous = names.map((name) => ({
    name,
    node: meta.getTag(`name="${name}"`),
    content: meta.getTag(`name="${name}"`)?.getAttribute('content') ?? null,
  }));
  const applied = new Map<string, string>([
    ['description', page.description],
    ['robots', page.robots],
  ]);

  const originalCanonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const previousHref = originalCanonical?.getAttribute('href') ?? null;
  const canonical = originalCanonical ?? document.createElement('link');
  canonical.rel = 'canonical';
  if (!originalCanonical) document.head.appendChild(canonical);
  const origin = url.hostname.endsWith('.com') ? 'https://vendix.com' : 'https://vendix.online';
  const appliedHref = page.canonicalPath === null ? null : origin + page.canonicalPath;

  title.setTitle(page.title);
  for (const [name, content] of applied) meta.updateTag({ name, content });
  if (appliedHref === null) canonical.removeAttribute('href');
  else canonical.setAttribute('href', appliedHref);

  return () => {
    if (title.getTitle() === page.title) title.setTitle(previousTitle);
    for (const { name, node, content } of previous) {
      const current = meta.getTag(`name="${name}"`);
      if (current?.content !== applied.get(name)) continue;
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
} satisfies Record<string, MarketingPageMetadata>;
