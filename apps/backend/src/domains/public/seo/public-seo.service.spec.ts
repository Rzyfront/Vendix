import { PublicSeoService } from './public-seo.service';
import { DomainConfigService } from '@common/config/domain.config';
import { DOMParser } from '@xmldom/xmldom';

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
    expect(set).toHaveBeenCalledWith('seo:sitemap:www.vendix.online', xml, 3_600_000);
  });

  it('uses the configured domain in development', async () => {
    jest.spyOn(DomainConfigService, 'getBaseDomain').mockReturnValue('vendix.com');
    expect(await service.generateSitemap('www.vendix.com')).toContain('<loc>https://vendix.com/</loc>');
  });

  it('preserves cache hits without resolving or querying domains', async () => {
    get.mockResolvedValue('<cached-sitemap/>');
    expect(await service.generateSitemap('vendix.online')).toBe('<cached-sitemap/>');
    expect(get).toHaveBeenCalledWith('seo:sitemap:vendix.online');
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

  it('preserves ecommerce host, product scope, escaping and update date', async () => {
    resolveDomain.mockResolvedValue({ app: 'STORE_ECOMMERCE', store_id: 42 });
    findMany.mockResolvedValue([{ slug: 'cafe&te', updated_at: new Date('2026-09-01T12:00:00Z') }]);
    const xml = await service.generateSitemap('tienda.example');
    expect(xml).toContain('<loc>https://tienda.example/products/cafe&amp;te</loc>');
    expect(xml).toContain('<lastmod>2026-09-01T12:00:00.000Z</lastmod>');
    expect(xml.match(/<loc>/g)).toHaveLength(5);
    expect(findMany).toHaveBeenCalledWith({
      where: { store_id: 42, state: 'active', available_for_ecommerce: true },
      select: { slug: true, updated_at: true },
      orderBy: { updated_at: 'desc' },
    });
    expect(get).toHaveBeenCalledWith('seo:sitemap:tienda.example');
  });

  it('does not query products without an ecommerce store id', async () => {
    resolveDomain.mockResolvedValue({ app: 'STORE_ECOMMERCE' });
    const xml = await service.generateSitemap('tienda.example');
    expect(xml.match(/<loc>/g)).toHaveLength(4);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('preserves private-app robots restrictions', async () => {
    resolveDomain.mockResolvedValue({ app: 'STORE_ADMIN' });
    expect(await service.generateRobotsTxt('admin.example')).toBe('User-agent: *\nDisallow: /\n');
  });

  it('robots.txt points to the sitemap', async () => {
    const robots = await service.generateRobotsTxt('vendix.online');
    expect(robots).toContain('Sitemap: https://vendix.online/sitemap.xml');
  });
});
