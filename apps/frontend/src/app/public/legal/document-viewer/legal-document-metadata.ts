import { Meta, Title } from '@angular/platform-browser';
import type { LegalDocument } from '../services/public-legal.service';

const LEGAL_PATHS = new Set(['/legal/terminos', '/legal/privacidad', '/legal/cookies']);

/** Marketing-only metadata. HTTP indexing remains blocked until hosting is fixed. */
export function createLegalDocumentMetadata(document: Document, title: Title, meta: Meta) {
  const url = new URL(document.URL);
  if (!['vendix.online', 'www.vendix.online', 'vendix.com', 'www.vendix.com'].includes(url.hostname)
      || !LEGAL_PATHS.has(url.pathname)) return { update: () => {}, restore: () => {} };

  const previousTitle = title.getTitle();
  let lastTitle: string | undefined;
  const names = ['description', 'robots'] as const;
  const previous = names.map(name => ({ name, node: meta.getTag(`name="${name}"`),
    content: meta.getTag(`name="${name}"`)?.getAttribute('content') ?? null }));
  const lastContent = new Map<string, string>();
  const originalCanonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const previousHref = originalCanonical?.getAttribute('href') ?? null;
  const canonical = originalCanonical ?? document.createElement('link');
  canonical.rel = 'canonical';
  if (!originalCanonical) document.head.appendChild(canonical);
  let lastHref: string | null | undefined;

  return {
    update(doc: LegalDocument | null, loaded: boolean) {
      const available = !!doc?.content?.trim();
      lastTitle = available ? `${doc!.title} | Vendix`
        : loaded ? 'Documento no disponible | Vendix' : 'Documento legal | Vendix';
      title.setTitle(lastTitle);
      const description = available
        ? doc!.description?.trim() || 'Consulta el documento legal vigente de Vendix.'
        : loaded ? 'No hay una versión activa disponible de este documento.' : 'Consultando el documento legal de Vendix.';
      for (const [name, content] of [['description', description], ['robots', 'noindex, follow']]) {
        meta.updateTag({ name, content });
        lastContent.set(name, content);
      }
      lastHref = available
        ? `${url.hostname.endsWith('.com') ? 'https://vendix.com' : 'https://vendix.online'}${url.pathname}` : null;
      if (lastHref === null) canonical.removeAttribute('href');
      else canonical.setAttribute('href', lastHref);
    },
    restore() {
      if (title.getTitle() === lastTitle) title.setTitle(previousTitle);
      for (const { name, node, content } of previous) {
        const current = meta.getTag(`name="${name}"`);
        if (current?.content !== lastContent.get(name)) continue;
        if (!node) current?.remove();
        else if (content === null) current?.removeAttribute('content');
        else current?.setAttribute('content', content);
      }
      if (!canonical.isConnected || canonical.getAttribute('href') !== lastHref) return;
      if (!originalCanonical) canonical.remove();
      else if (previousHref === null) canonical.removeAttribute('href');
      else canonical.setAttribute('href', previousHref);
    },
  };
}
