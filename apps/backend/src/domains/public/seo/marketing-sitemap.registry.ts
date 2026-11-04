import { createHash } from 'crypto';

interface MarketingSitemapPage {
  readonly path: string;
  readonly priority: string;
  readonly changefreq: string;
  readonly editorialRevision: number;
}

// Approved published marketing pages only. Bump editorialRevision when content
// changes; this is a cache revision, never an invented lastmod date.
export const MARKETING_SITEMAP_PAGES: readonly MarketingSitemapPage[] = [
  { path: '/', priority: '1.0', changefreq: 'weekly', editorialRevision: 1 },
  // /pricing: canonical approved on 2026-10-22; served with HTTP 200 since the
  // CloudFront Function (2026-11-02) and rendered as `index, follow`.
  { path: '/pricing', priority: '0.9', changefreq: 'weekly', editorialRevision: 1 },
  // Legal documents with current text (privacy v1.1 and terms v2.2, 2026-11-02),
  // indexable per the 2026-10-22 decision. /legal/cookies has no active document.
  { path: '/legal/terminos', priority: '0.3', changefreq: 'monthly', editorialRevision: 1 },
  { path: '/legal/privacidad', priority: '0.3', changefreq: 'monthly', editorialRevision: 1 },
];

export function marketingSitemapVersion(
  pages: readonly MarketingSitemapPage[] = MARKETING_SITEMAP_PAGES,
): string {
  // Increment formatVersion when XML rendering changes without a registry edit.
  return createHash('sha256')
    .update(JSON.stringify({ formatVersion: 1, pages }))
    .digest('hex');
}
