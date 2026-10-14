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
];

export function marketingSitemapVersion(
  pages: readonly MarketingSitemapPage[] = MARKETING_SITEMAP_PAGES,
): string {
  // Increment formatVersion when XML rendering changes without a registry edit.
  return createHash('sha256')
    .update(JSON.stringify({ formatVersion: 1, pages }))
    .digest('hex');
}
