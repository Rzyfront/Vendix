import { PublicPwaService } from './public-pwa.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';

/**
 * These specs pin the two rules the installable icon depends on and that are
 * invisible from the outside once the PNG is served:
 *
 *  1. WHICH asset each kind of app derives its icon from — a store and an
 *     organization read different columns, and a storefront banner must never
 *     win the cascade.
 *  2. That a tiny favicon is upgraded to its large sibling before deriving a
 *     512px icon.
 *
 * Both failed silently in production before: the tenant still got *an* icon,
 * just the wrong one.
 */

const ORG = { id: 33, slug: 'vendix-demo' };
const STORE = { id: 94, slug: 'vendix-pit-and-grill' };
const STORE_PATH = `organizations/${ORG.slug}-${ORG.id}/stores/${STORE.slug}-${STORE.id}`;
const ORG_PATH = `organizations/${ORG.slug}-${ORG.id}`;

describe('PublicPwaService — tenant icon source', () => {
  let service: PublicPwaService;
  let globalPrisma: any;
  let publicDomains: any;
  let s3Service: any;
  let cache: any;

  /** Keys that "exist" in the bucket for this test run. */
  let existingKeys: Set<string>;

  const buildService = () => {
    existingKeys = new Set<string>();

    globalPrisma = {
      stores: {
        findUnique: jest.fn().mockResolvedValue({
          ...STORE,
          logo_url: null,
          organizations: ORG,
        }),
      },
      store_settings: { findUnique: jest.fn().mockResolvedValue(null) },
      organizations: { findUnique: jest.fn().mockResolvedValue(ORG) },
      organization_settings: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    publicDomains = { resolveDomain: jest.fn() };

    s3Service = {
      objectExists: jest.fn((key: string) =>
        Promise.resolve(existingKeys.has(key)),
      ),
      getOrCreatePwaIcon: jest.fn().mockResolvedValue(Buffer.from('icon')),
    };

    // Not a stub: the real path/branding rules are exactly what is under test.
    const s3PathHelper = new S3PathHelper();

    cache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };

    service = new PublicPwaService(
      globalPrisma,
      publicDomains,
      s3Service,
      s3PathHelper,
      cache,
    );
  };

  /** The S3 key the derivation was actually asked to read. */
  const derivedFrom = () => s3Service.getOrCreatePwaIcon.mock.calls[0]?.[0];

  const resolveIcon = () => service.resolveIconBuffer('shop.test', 'icon-512');

  const storeDomain = () => ({
    app: 'STORE_ECOMMERCE',
    store_id: STORE.id,
    store_name: 'Pit & Grill',
    branding: { primary_color: '#2ecc71' },
  });

  const orgDomain = () => ({
    app: 'ORG_LANDING',
    organization_id: ORG.id,
    organization_name: 'Vendix Demo',
    branding: { primary_color: '#825741' },
  });

  const storeSettings = (settings: Record<string, unknown>) =>
    globalPrisma.store_settings.findUnique.mockResolvedValue({ settings });

  beforeEach(buildService);

  describe('store apps', () => {
    beforeEach(() => publicDomains.resolveDomain.mockResolvedValue(storeDomain()));

    it('prefers stores.logo_url over every settings candidate', async () => {
      const logo = `${STORE_PATH}/logos/logo.webp`;
      globalPrisma.stores.findUnique.mockResolvedValue({
        ...STORE,
        logo_url: logo,
        organizations: ORG,
      });
      storeSettings({
        branding: { logo_url: `${STORE_PATH}/logos/other.webp` },
      });

      const { fromTenant } = await resolveIcon();

      expect(fromTenant).toBe(true);
      expect(derivedFrom()).toBe(logo);
    });

    it('rejects an ecommerce slider photo as an app icon', async () => {
      // `ecommerce.inicio.logo_url` holds a storefront BANNER in production.
      // Without the branding-path filter it wins the cascade and the tenant
      // installs with a picture of its own shelf.
      storeSettings({
        ecommerce: {
          inicio: { logo_url: `${STORE_PATH}/ecommerce/slider/banner.webp` },
        },
      });

      const { fromTenant } = await resolveIcon();

      expect(fromTenant).toBe(false);
      expect(s3Service.getOrCreatePwaIcon).not.toHaveBeenCalled();
    });

    it('upgrades a 16px favicon to its 192px sibling when it exists', async () => {
      existingKeys.add(`${STORE_PATH}/favicons/favicon-192.png`);
      storeSettings({
        branding: { favicon_url: `${STORE_PATH}/favicons/favicon-16.png` },
      });

      await resolveIcon();

      expect(derivedFrom()).toBe(`${STORE_PATH}/favicons/favicon-192.png`);
    });

    it('keeps the 16px favicon when no larger sibling was ever generated', async () => {
      // Rows predating the multi-size favicon generator have only the 16px file.
      const favicon = `${STORE_PATH}/favicons/favicon-16.png`;
      storeSettings({ branding: { favicon_url: favicon } });

      await resolveIcon();

      expect(derivedFrom()).toBe(favicon);
    });

    it('falls back to the Vendix brand when the store has no branding asset', async () => {
      const { fromTenant } = await resolveIcon();

      expect(fromTenant).toBe(false);
      expect(s3Service.getOrCreatePwaIcon).not.toHaveBeenCalled();
    });
  });

  describe('organization apps', () => {
    beforeEach(() => publicDomains.resolveDomain.mockResolvedValue(orgDomain()));

    it('derives from the organization branding logo', async () => {
      const logo = `${ORG_PATH}/logos/org-logo.webp`;
      globalPrisma.organization_settings.findUnique.mockResolvedValue({
        settings: { branding: { logo_url: logo } },
      });

      const { fromTenant } = await resolveIcon();

      expect(fromTenant).toBe(true);
      expect(derivedFrom()).toBe(logo);
    });

    it('falls back to the Vendix brand when the organization has no logo', async () => {
      // The production state for every ORG_LANDING at the time of writing.
      const { fromTenant } = await resolveIcon();

      expect(fromTenant).toBe(false);
    });
  });

  describe('manifest', () => {
    it('never emits a signed S3 URL as an icon source', async () => {
      // A presigned URL expires in 24h and the installed app loses its icon.
      publicDomains.resolveDomain.mockResolvedValue(storeDomain());

      const manifest = await service.buildManifest('shop.test');
      const icons = manifest['icons'] as Array<{ src: string }>;

      expect(icons.length).toBeGreaterThan(0);
      for (const icon of icons) {
        expect(icon.src.startsWith('/pwa/')).toBe(true);
      }
    });

    it('names a store app after the store and an org app after the organization', async () => {
      publicDomains.resolveDomain.mockResolvedValue(storeDomain());
      expect((await service.buildManifest('shop.test'))['name']).toBe(
        'Pit & Grill',
      );

      buildService();
      publicDomains.resolveDomain.mockResolvedValue(orgDomain());
      expect((await service.buildManifest('org.test'))['name']).toBe(
        'Vendix Demo',
      );
    });
  });
});
