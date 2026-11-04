import { ErrorCodes } from '@common/errors/error-codes';
import {
  assertAppTypeAssignable,
  syncAppDomainAssignment,
} from './app-domain-assignment';

/**
 * Apps F5: rules the domain modals (store and organization) apply when a
 * domain is pointed to an app's `app_type` by hand.
 */
describe('app domain assignment (domain modals)', () => {
  const STORE_ID = 10;
  let prisma: { store_apps: { findFirst: jest.Mock; update: jest.Mock } };

  beforeEach(() => {
    prisma = {
      store_apps: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
    };
  });

  describe('assertAppTypeAssignable', () => {
    it('refuses an app type whose app is not published, with STORE_APPS_016 and the app name', async () => {
      await expect(
        assertAppTypeAssignable(prisma as any, {
          storeId: STORE_ID,
          currentAppType: 'STORE_LANDING',
          nextAppType: 'STORE_BOOKING',
        }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.STORE_APPS_016.code,
        message: 'Publica primero la app «Reservas» para usar este dominio con ella.',
      });
      expect(prisma.store_apps.findFirst).toHaveBeenCalledWith({
        where: { store_id: STORE_ID, kind: 'booking', status: 'published' },
        select: { id: true },
      });
    });

    it('accepts an app type whose app is published', async () => {
      prisma.store_apps.findFirst.mockResolvedValue({ id: 5 });
      await expect(
        assertAppTypeAssignable(prisma as any, {
          storeId: STORE_ID,
          currentAppType: 'STORE_LANDING',
          nextAppType: 'STORE_PRODUCT_PAGE',
        }),
      ).resolves.toBeUndefined();
    });

    it('never moves the online store or the admin domain to an app (STORE_APPS_017)', async () => {
      prisma.store_apps.findFirst.mockResolvedValue({ id: 5 });
      for (const current of ['STORE_ECOMMERCE', 'STORE_ADMIN']) {
        await expect(
          assertAppTypeAssignable(prisma as any, {
            storeId: STORE_ID,
            currentAppType: current,
            nextAppType: 'STORE_HOME',
          }),
        ).rejects.toMatchObject({ errorCode: ErrorCodes.STORE_APPS_017.code });
      }
    });

    it('leaves the existing app types as they were (no lookup)', async () => {
      for (const next of ['STORE_ECOMMERCE', 'STORE_LANDING', 'STORE_ADMIN']) {
        await expect(
          assertAppTypeAssignable(prisma as any, {
            storeId: STORE_ID,
            currentAppType: 'STORE_ECOMMERCE',
            nextAppType: next,
          }),
        ).resolves.toBeUndefined();
      }
      expect(prisma.store_apps.findFirst).not.toHaveBeenCalled();
    });

    it('keeping the same app type needs no published check', async () => {
      await expect(
        assertAppTypeAssignable(prisma as any, {
          storeId: STORE_ID,
          currentAppType: 'STORE_BOOKING',
          nextAppType: 'STORE_BOOKING',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('syncAppDomainAssignment', () => {
    it('adds the domain as an alias of the app, remembering its previous app type', async () => {
      prisma.store_apps.findFirst.mockResolvedValue({
        id: 5,
        domain_settings_id: 40,
        config: { product_ids: [3] },
      });

      await syncAppDomainAssignment(prisma as any, {
        storeId: STORE_ID,
        domainId: 77,
        previousAppType: 'STORE_LANDING',
        nextAppType: 'STORE_BOOKING',
      });

      expect(prisma.store_apps.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { store_id: STORE_ID, kind: 'booking' } }),
      );
      expect(prisma.store_apps.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: expect.objectContaining({
          config: {
            product_ids: [3],
            custom_domain_aliases: [{ domain_id: 77, previous_app_type: 'STORE_LANDING' }],
          },
        }),
      });
    });

    it('removes the domain from the alias list of the app it stops serving', async () => {
      prisma.store_apps.findFirst.mockResolvedValue({
        id: 5,
        domain_settings_id: 40,
        config: {
          custom_domain_aliases: [
            { domain_id: 77, previous_app_type: 'STORE_LANDING' },
            { domain_id: 78, previous_app_type: null },
          ],
        },
      });

      await syncAppDomainAssignment(prisma as any, {
        storeId: STORE_ID,
        domainId: 77,
        previousAppType: 'STORE_BOOKING',
        nextAppType: 'STORE_LANDING',
      });

      expect(prisma.store_apps.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: expect.objectContaining({
          config: { custom_domain_aliases: [{ domain_id: 78, previous_app_type: null }] },
        }),
      });
    });

    it("never records the app's own primary domain as an alias", async () => {
      prisma.store_apps.findFirst.mockResolvedValue({ id: 5, domain_settings_id: 40, config: {} });
      await syncAppDomainAssignment(prisma as any, {
        storeId: STORE_ID,
        domainId: 40,
        previousAppType: 'STORE_LANDING',
        nextAppType: 'STORE_BOOKING',
      });
      expect(prisma.store_apps.update).not.toHaveBeenCalled();
    });

    it('does nothing for the existing app types', async () => {
      await syncAppDomainAssignment(prisma as any, {
        storeId: STORE_ID,
        domainId: 77,
        previousAppType: 'STORE_ECOMMERCE',
        nextAppType: 'STORE_LANDING',
      });
      expect(prisma.store_apps.findFirst).not.toHaveBeenCalled();
      expect(prisma.store_apps.update).not.toHaveBeenCalled();
    });
  });
});
