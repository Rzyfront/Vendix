import { PublicSeoService } from './public-seo.service';

describe('PublicSeoService (VENDIX_LANDING)', () => {
  let service: PublicSeoService;

  beforeEach(() => {
    const globalPrisma = {} as any;
    const publicDomainsService = {
      resolveDomain: jest.fn().mockResolvedValue({ app: 'VENDIX_LANDING' }),
    } as any;
    const cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    } as any;
    service = new PublicSeoService(globalPrisma, publicDomainsService, cache);
  });

  it('sitemap lists the real public pages and no hash-fragment URLs', async () => {
    const xml = await service.generateSitemap('vendix.online');
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);

    expect(locs.some((l) => l.includes('#'))).toBe(false);
    expect(locs).toEqual([
      'https://vendix.online/',
      'https://vendix.online/ayuda',
      'https://vendix.online/pqr',
      'https://vendix.online/legal/terminos',
      'https://vendix.online/legal/privacidad',
      'https://vendix.online/legal/cookies',
    ]);
  });

  it('robots.txt points to the sitemap', async () => {
    const robots = await service.generateRobotsTxt('vendix.online');
    expect(robots).toContain('Sitemap: https://vendix.online/sitemap.xml');
  });
});
