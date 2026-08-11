import { PwaCacheService } from './pwa-cache.service';
import { S3PathHelper } from '../helpers/s3-path.helper';

const ORG = { id: 33, slug: 'vendix-demo' };
const STORE = { id: 94, slug: 'vendix-pit-and-grill' };

describe('PwaCacheService', () => {
  let service: PwaCacheService;
  let globalPrisma: any;
  let s3Service: any;
  let cache: any;

  beforeEach(() => {
    globalPrisma = {
      stores: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...STORE, organizations: ORG }),
      },
      organizations: { findUnique: jest.fn().mockResolvedValue(ORG) },
      domain_settings: { findMany: jest.fn().mockResolvedValue([]) },
    };

    s3Service = { deleteDerivedPwaIcons: jest.fn().mockResolvedValue(2) };
    cache = { del: jest.fn().mockResolvedValue(undefined) };

    service = new PwaCacheService(
      globalPrisma,
      s3Service,
      new S3PathHelper(),
      cache,
    );
  });

  const deletedKeys = () => cache.del.mock.calls.map(([key]: [string]) => key);

  describe('invalidateStore', () => {
    it('drops the manifest and every icon variant for each store hostname', async () => {
      globalPrisma.domain_settings.findMany.mockResolvedValue([
        { hostname: 'pit-store.vendix.online' },
        { hostname: 'pit-shop.vendix.online' },
      ]);

      await service.invalidateStore(STORE.id);

      const keys = deletedKeys();
      expect(keys).toContain('pwa:manifest:pit-store.vendix.online');
      expect(keys).toContain('pwa:icon:pit-store.vendix.online:icon-512');
      expect(keys).toContain(
        'pwa:icon:pit-shop.vendix.online:apple-touch-icon-180',
      );
      // 2 hostnames x (1 manifest + 4 icon variants)
      expect(keys).toHaveLength(10);
    });

    it('drops the icons derived under the store S3 path', async () => {
      await service.invalidateStore(STORE.id);

      expect(s3Service.deleteDerivedPwaIcons).toHaveBeenCalledWith(
        `organizations/${ORG.slug}-${ORG.id}/stores/${STORE.slug}-${STORE.id}`,
      );
    });

    it('lowercases hostnames so the key matches the one the PWA service wrote', async () => {
      // `resolveIconBuffer` normalizes the Host header before building its key;
      // a mixed-case row here would delete a key nobody ever wrote.
      globalPrisma.domain_settings.findMany.mockResolvedValue([
        { hostname: 'Pit-Store.Vendix.Online' },
      ]);

      await service.invalidateStore(STORE.id);

      expect(deletedKeys()).toContain('pwa:manifest:pit-store.vendix.online');
    });

    it('never throws when the store cannot be read', async () => {
      globalPrisma.stores.findUnique.mockRejectedValue(new Error('db down'));

      await expect(service.invalidateStore(STORE.id)).resolves.toBeUndefined();
    });
  });

  describe('invalidateOrganization', () => {
    it('scopes to the organization OWN domains, never its stores', async () => {
      // A store subdomain resolves its icon from the STORE branding, so an
      // org-level branding change must leave that cache warm.
      await service.invalidateOrganization(ORG.id);

      expect(globalPrisma.domain_settings.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organization_id: ORG.id, store_id: null },
        }),
      );
    });

    it('drops the icons derived under the organization S3 path', async () => {
      await service.invalidateOrganization(ORG.id);

      expect(s3Service.deleteDerivedPwaIcons).toHaveBeenCalledWith(
        `organizations/${ORG.slug}-${ORG.id}`,
      );
    });

    it('never throws when the organization cannot be read', async () => {
      globalPrisma.organizations.findUnique.mockRejectedValue(
        new Error('db down'),
      );

      await expect(
        service.invalidateOrganization(ORG.id),
      ).resolves.toBeUndefined();
    });
  });
});
