import { PublicSeoService } from './public-seo.service';
import { DomainConfigService } from '@common/config/domain.config';
import { DOMParser } from '@xmldom/xmldom';
import * as marketingRegistry from './marketing-sitemap.registry';

// Unit tests inject doubles; do not initialize Prisma or domain infrastructure.
jest.mock('../../../prisma/services/global-prisma.service', () => ({
  GlobalPrismaService: class {},
}));
jest.mock('../domains/public-domains.service', () => ({
  PublicDomainsService: class {},
}));

describe('PublicSeoService (VENDIX_LANDING)', () => {
  let service: PublicSeoService;
  const resolveDomain = jest.fn();
  const findMany = jest.fn();
  const get = jest.fn();
  const set = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(DomainConfigService, 'getBaseDomain').mockReturnValue('vendix.online');
    resolveDomain.mockResolvedValue({ app: 'VENDIX_LANDING' });
    findMany.mockResolvedValue([]);
    get.mockResolvedValue(undefined);
    set.mockResolvedValue(undefined);
    const globalPrisma = { products: { findMany } } as any;
    const publicDomainsService = {
      resolveDomain,
    } as any;
    const cache = {
      get,
      set,
    } as any;
    service = new PublicSeoService(globalPrisma, publicDomainsService, cache);
  });
  afterEach(() => jest.restoreAllMocks());

  it('sitemap lists the real public pages and no hash-fragment URLs', async () => {
    const xml = await service.generateSitemap('vendix.online');
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);

    expect(locs.some((l) => l.includes('#'))).toBe(false);
    expect(locs).toEqual([
      'https://vendix.online/',
    ]);
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    expect(document.documentElement.namespaceURI).toBe('http://www.sitemaps.org/schemas/sitemap/0.9');
    expect(document.getElementsByTagName('loc').length).toBe(1);
    expect(document.getElementsByTagName('parsererror').length).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('omits marketing lastmod rather than inventing an editorial date', async () => {
    const first = await service.generateSitemap('vendix.online');
    expect(first).not.toContain('<lastmod>');
    expect(await service.generateSitemap('vendix.online')).toBe(first);
  });

  it('normalizes www and emits the apex canonical, using a host-scoped cache', async () => {
    const xml = await service.generateSitemap('WWW.VENDIX.ONLINE:443');
    expect(resolveDomain).toHaveBeenCalledWith('www.vendix.online');
    expect(xml).toContain('<loc>https://vendix.online/</loc>');
    expect(set).toHaveBeenCalledWith(`seo:sitemap:www.vendix.online:marketing:${marketingRegistry.marketingSitemapVersion()}`, xml, 3_600_000);
  });

  it('uses the configured domain in development', async () => {
    jest.spyOn(DomainConfigService, 'getBaseDomain').mockReturnValue('vendix.com');
    expect(await service.generateSitemap('www.vendix.com')).toContain('<loc>https://vendix.com/</loc>');
  });

  it('preserves cache hits without resolving or querying domains', async () => {
    get.mockResolvedValue('<cached-sitemap/>');
    expect(await service.generateSitemap('vendix.online')).toBe('<cached-sitemap/>');
    expect(get).toHaveBeenCalledWith(`seo:sitemap:vendix.online:marketing:${marketingRegistry.marketingSitemapVersion()}`);
    expect(resolveDomain).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('preserves an organization hostname and its existing lastmod', async () => {
    resolveDomain.mockResolvedValue({ app: 'ORG_LANDING', organization_id: 9 });
    const xml = await service.generateSitemap('www.organizacion.example');
    expect(xml).toContain('<loc>https://www.organizacion.example/</loc>');
    expect(xml).toContain('<lastmod>');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('preserves ecommerce host, product scope and update date', async () => {
    resolveDomain.mockResolvedValue({ app: 'STORE_ECOMMERCE', store_id: 42 });
    findMany.mockResolvedValue([{ slug: 'cafe-te', updated_at: new Date('2026-09-01T12:00:00Z') }]);
    const xml = await service.generateSitemap('tienda.example');
    expect(xml).toContain('<loc>https://tienda.example/products/cafe-te</loc>');
    expect(xml).toContain('<lastmod>2026-09-01T12:00:00.000Z</lastmod>');
    expect(xml.match(/<loc>/g)).toHaveLength(5);
    expect(findMany).toHaveBeenCalledWith({
      where: { store_id: 42, state: 'active', available_for_ecommerce: true },
      select: { slug: true, updated_at: true },
      orderBy: { updated_at: 'desc' },
    });
    expect(get).toHaveBeenCalledWith('seo:sitemap:tienda.example');
  });

  it('ecommerce listings use the latest product update as lastmod, never the request time', async () => {
    resolveDomain.mockResolvedValue({ app: 'STORE_ECOMMERCE', store_id: 42 });
    findMany.mockResolvedValue([
      { slug: 'nuevo', updated_at: new Date('2026-10-16T06:11:52Z') },
      { slug: 'viejo', updated_at: new Date('2026-10-01T03:13:58Z') },
      { slug: 'sin-fecha', updated_at: null },
    ]);
    const xml = await service.generateSitemap('tienda.example');
    const entry = (loc: string) =>
      xml.split('<url>').find((block) => block.includes(`<loc>${loc}</loc>`)) ?? '';

    for (const path of ['/', '/catalog', '/novedades', '/ofertas']) {
      expect(entry(`https://tienda.example${path}`)).toContain('<lastmod>2026-10-16T06:11:52.000Z</lastmod>');
    }
    expect(entry('https://tienda.example/products/viejo')).toContain('<lastmod>2026-10-01T03:13:58.000Z</lastmod>');
    expect(entry('https://tienda.example/products/sin-fecha')).not.toContain('<lastmod>');
    const today = new Date().toISOString().slice(0, 10);
    expect(xml).not.toContain(`<lastmod>${today}`);
  });

  it('ecommerce store without products omits listing lastmod', async () => {
    resolveDomain.mockResolvedValue({ app: 'STORE_ECOMMERCE', store_id: 42 });
    findMany.mockResolvedValue([]);
    const xml = await service.generateSitemap('tienda.example');
    expect(xml.match(/<loc>/g)).toHaveLength(4);
    expect(xml).not.toContain('<lastmod>');
  });

  it('does not query products without an ecommerce store id', async () => {
    resolveDomain.mockResolvedValue({ app: 'STORE_ECOMMERCE' });
    const xml = await service.generateSitemap('tienda.example');
    expect(xml.match(/<loc>/g)).toHaveLength(4);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('omits products with an empty or invalid slug from the ecommerce sitemap', async () => {
    resolveDomain.mockResolvedValue({ app: 'STORE_ECOMMERCE', store_id: 42 });
    findMany.mockResolvedValue([
      { slug: '', updated_at: new Date('2026-10-20T00:00:00Z') },
      { slug: '   ', updated_at: new Date('2026-10-19T00:00:00Z') },
      { slug: 'Cafe-Especial', updated_at: new Date('2026-10-18T00:00:00Z') },
      { slug: 'cafe&te', updated_at: new Date('2026-10-17T00:00:00Z') },
      { slug: 'hamburguesa-clásica', updated_at: new Date('2026-10-16T00:00:00Z') },
      { slug: 'a//b', updated_at: new Date('2026-10-15T00:00:00Z') },
      { slug: '-borde-', updated_at: new Date('2026-10-14T00:00:00Z') },
      { slug: 'postre-tres-leches', updated_at: new Date('2026-10-01T00:00:00Z') },
    ]);
    const xml = await service.generateSitemap('tienda.example');
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);

    expect(locs).toEqual([
      'https://tienda.example/',
      'https://tienda.example/catalog',
      'https://tienda.example/novedades',
      'https://tienda.example/ofertas',
      'https://tienda.example/products/postre-tres-leches',
    ]);
    expect(locs).not.toContain('https://tienda.example/products/');
    // The listings lastmod only reflects products that are actually published.
    expect(xml).not.toContain('<lastmod>2026-10-20');
    expect(xml.match(/<lastmod>2026-10-01T00:00:00.000Z<\/lastmod>/g)).toHaveLength(5);
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    expect(document.getElementsByTagName('parsererror').length).toBe(0);
  });

  it('never mixes product URLs between two stores', async () => {
    const domains: Record<string, { app: string; store_id: number }> = {
      'tienda-a.example': { app: 'STORE_ECOMMERCE', store_id: 1 },
      'tienda-b.example': { app: 'STORE_ECOMMERCE', store_id: 2 },
    };
    const catalog: Record<number, Array<{ slug: string; updated_at: Date }>> = {
      1: [{ slug: 'producto-a', updated_at: new Date('2026-10-02T00:00:00Z') }],
      2: [{ slug: 'producto-b', updated_at: new Date('2026-10-03T00:00:00Z') }],
    };
    resolveDomain.mockImplementation(async (host: string) => domains[host]);
    findMany.mockImplementation(async ({ where }: { where: { store_id: number } }) => catalog[where.store_id] ?? []);
    const cacheStore = new Map<string, string>();
    get.mockImplementation(async (key: string) => cacheStore.get(key));
    set.mockImplementation(async (key: string, value: string) => { cacheStore.set(key, value); });

    const xmlA = await service.generateSitemap('tienda-a.example');
    const xmlB = await service.generateSitemap('tienda-b.example');
    const locs = (xml: string) => [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);

    expect(locs(xmlA).every((l) => l.startsWith('https://tienda-a.example/'))).toBe(true);
    expect(locs(xmlB).every((l) => l.startsWith('https://tienda-b.example/'))).toBe(true);
    expect(xmlA).toContain('<loc>https://tienda-a.example/products/producto-a</loc>');
    expect(xmlA).not.toContain('producto-b');
    expect(xmlB).toContain('<loc>https://tienda-b.example/products/producto-b</loc>');
    expect(xmlB).not.toContain('producto-a');
    expect(findMany.mock.calls.map(([args]) => args.where.store_id)).toEqual([1, 2]);
    // Each host has its own cache entry: a cached sitemap is never served to another store.
    expect(cacheStore.get('seo:sitemap:tienda-a.example')).toBe(xmlA);
    expect(cacheStore.get('seo:sitemap:tienda-b.example')).toBe(xmlB);
    expect(await service.generateSitemap('tienda-b.example')).toBe(xmlB);
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('store robots.txt blocks search, price/sort params and private or token pages', async () => {
    resolveDomain.mockResolvedValue({ app: 'STORE_ECOMMERCE', store_id: 42 });
    const robots = await service.generateRobotsTxt('tienda.example');
    const lines = robots.split('\n');

    for (const rule of [
      'Disallow: /*?*search=',
      'Disallow: /*?*min_price=',
      'Disallow: /*?*max_price=',
      'Disallow: /*?*sort=',
      'Disallow: /*?*sort_by=',
      'Disallow: /*?*order_by=',
      'Disallow: /pedido/',
      'Disallow: /order/',
      'Disallow: /factura/',
      'Disallow: /preconsulta/',
      'Disallow: /book/',
      'Disallow: /hotel/reserva/',
      'Disallow: /fila',
      'Disallow: /reset-password',
      'Disallow: /cart',
      'Disallow: /wishlist',
      'Disallow: /checkout',
      'Disallow: /account',
      'Disallow: /api/',
    ]) {
      expect(lines).toContain(rule);
    }
    for (const rule of ['Allow: /', 'Allow: /catalog', 'Allow: /products', 'Allow: /novedades', 'Allow: /ofertas', 'Allow: /cartas']) {
      expect(lines).toContain(rule);
    }
    // Public products, listings and category/brand filters stay crawlable.
    const disallowed = lines.filter((l) => l.startsWith('Disallow: ')).map((l) => l.slice('Disallow: '.length));
    for (const path of ['/products', '/productos', '/catalog', '/novedades', '/ofertas', '/new', '/sale']) {
      expect(disallowed.some((d) => !d.includes('*') && path.startsWith(d))).toBe(false);
    }
    expect(disallowed.some((d) => /category|brand/.test(d))).toBe(false);
    expect(robots).toContain('Sitemap: https://tienda.example/sitemap.xml');
    expect(set).toHaveBeenCalledWith('seo:robots:tienda.example', robots, 3_600_000);
  });

  it('marketing robots.txt stays unchanged', async () => {
    expect(await service.generateRobotsTxt('vendix.online')).toBe(
      'User-agent: *\nAllow: /\n\nSitemap: https://vendix.online/sitemap.xml\n',
    );
  });

  it('preserves private-app robots restrictions', async () => {
    resolveDomain.mockResolvedValue({ app: 'STORE_ADMIN' });
    expect(await service.generateRobotsTxt('admin.example')).toBe('User-agent: *\nDisallow: /\n');
  });

  it('blocks all indexing on the API host without touching domain resolution or cache', async () => {
    expect(await service.generateRobotsTxt('api.vendix.online')).toBe('User-agent: *\nDisallow: /\n');
    expect(await service.generateRobotsTxt('API.vendix.com:443')).toBe('User-agent: *\nDisallow: /\n');
    expect(resolveDomain).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('keeps marketing and store robots open', async () => {
    expect(await service.generateRobotsTxt('vendix.online')).toContain('Allow: /');
    resolveDomain.mockResolvedValue({ app: 'STORE_ECOMMERCE', store_id: 42 });
    expect(await service.generateRobotsTxt('tienda.example')).toContain('Allow: /catalog');
  });

  it('robots.txt points to the sitemap', async () => {
    const robots = await service.generateRobotsTxt('vendix.online');
    expect(robots).toContain('Sitemap: https://vendix.online/sitemap.xml');
  });

  it('changes the version on editorial edits, additions and removals', () => {
    const original = marketingRegistry.MARKETING_SITEMAP_PAGES;
    const version = marketingRegistry.marketingSitemapVersion(original);
    expect(marketingRegistry.marketingSitemapVersion([...original])).toBe(version);
    expect(marketingRegistry.marketingSitemapVersion(original.map(p => ({ ...p, editorialRevision: 2 })))).not.toBe(version);
    expect(marketingRegistry.marketingSitemapVersion([...original, { path: '/published-fixture', priority: '0.5', changefreq: 'monthly', editorialRevision: 1 }])).not.toBe(version);
    expect(marketingRegistry.marketingSitemapVersion([])).not.toBe(version);
  });

  it('bypasses stale marketing XML after an editorial revision without touching a tenant cache', async () => {
    const store = new Map<string, string>([
      ['seo:sitemap:vendix.online', '<legacy-marketing/>'],
      ['seo:sitemap:tienda.example', '<tenant-sitemap/>'],
    ]);
    get.mockImplementation(async key => store.get(key));
    set.mockImplementation(async (key, value) => { store.set(key, value); });
    const version = jest.spyOn(marketingRegistry, 'marketingSitemapVersion');
    version.mockReturnValue('editorial-before');
    const first = await service.generateSitemap('vendix.online');
    store.set('seo:sitemap:vendix.online:marketing:editorial-before', '<previous-edition/>');
    version.mockReturnValue('editorial-after');
    const current = await service.generateSitemap('vendix.online');
    expect(current).toBe(first);
    expect(current).not.toContain('previous-edition');
    expect(store.get('seo:sitemap:vendix.online:marketing:editorial-after')).toBe(current);
    expect(await service.generateSitemap('tienda.example')).toBe('<tenant-sitemap/>');
    expect(store.get('seo:sitemap:tienda.example')).toBe('<tenant-sitemap/>');
    expect(store.get('seo:sitemap:vendix.online')).toBe('<legacy-marketing/>');
    expect(resolveDomain).toHaveBeenCalledTimes(2);
  });

  it('keeps marketing cache hits isolated between apex and www', async () => {
    const version = marketingRegistry.marketingSitemapVersion();
    get.mockImplementation(async key => key === `seo:sitemap:vendix.online:marketing:${version}` ? '<apex-cache/>' : undefined);
    expect(await service.generateSitemap('vendix.online')).toBe('<apex-cache/>');
    const www = await service.generateSitemap('www.vendix.online');
    expect(www).toContain('<loc>https://vendix.online/</loc>');
    expect(resolveDomain).toHaveBeenCalledTimes(1);
  });
});
