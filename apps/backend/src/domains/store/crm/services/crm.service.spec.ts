import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { CrmGenerationService } from './crm-generation.service';
import { CrmService } from './crm.service';

/**
 * apps-vistas-f1 S4: publishing or switching off the landing here keeps its
 * Apps card (`store_apps(landing)`) in step. A landing on its own domain is
 * owned by the Apps landing service and is never touched from here.
 */
describe('CrmService — store_apps(landing) sync', () => {
  const STORE_ID = 10;

  interface AppRow {
    id: number;
    status: string;
    domain_settings_id: number | null;
  }

  let appRow: AppRow | null;
  let prisma: {
    crm_landing_pages: { findFirst: jest.Mock; updateMany: jest.Mock };
    store_apps: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  };
  let service: CrmService;

  const landing = {
    id: 1,
    store_id: STORE_ID,
    enabled: true,
    generation_status: 'ready',
    content_json: { blocks: [] },
    published_json: null,
    published_at: null,
    version: 1,
    last_job_id: null,
  };

  beforeEach(() => {
    appRow = null;
    prisma = {
      crm_landing_pages: {
        findFirst: jest.fn().mockResolvedValue(landing),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      store_apps: {
        findFirst: jest.fn().mockImplementation(() => Promise.resolve(appRow)),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const settings = {
      getSettings: jest.fn().mockResolvedValue({ publication: {} }),
      updateSettings: jest.fn().mockResolvedValue({}),
    };
    service = new CrmService(
      prisma as unknown as StorePrismaService,
      { enqueueGeneration: jest.fn() } as unknown as CrmGenerationService,
      settings as unknown as SettingsService,
    );
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID);
  });

  afterEach(() => jest.restoreAllMocks());

  it('publish without an Apps row: creates the landing app as published', async () => {
    await service.publish();

    expect(prisma.store_apps.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { store_id: STORE_ID, kind: 'landing' } }),
    );
    expect(prisma.store_apps.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        store_id: STORE_ID,
        kind: 'landing',
        status: 'published',
      }),
    });
  });

  it('publish with a disabled row on the store domain: the card goes back to published', async () => {
    appRow = { id: 5, status: 'disabled', domain_settings_id: null };

    await service.publish();

    expect(prisma.store_apps.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({ status: 'published' }),
    });
  });

  it('deactivate: a published landing on the store domain shows as disabled', async () => {
    appRow = { id: 5, status: 'published', domain_settings_id: null };

    await service.deactivate();

    expect(prisma.store_apps.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({ status: 'disabled' }),
    });
  });

  it('a landing on its own domain is never touched from here', async () => {
    appRow = { id: 5, status: 'published', domain_settings_id: 900 };

    await service.deactivate();
    await service.publish();

    expect(prisma.store_apps.update).not.toHaveBeenCalled();
    expect(prisma.store_apps.create).not.toHaveBeenCalled();
  });

  it('a failed sync does not undo the landing action', async () => {
    prisma.store_apps.findFirst.mockRejectedValue(new Error('db down'));

    await expect(service.publish()).resolves.toBeDefined();
    expect(prisma.crm_landing_pages.updateMany).toHaveBeenCalled();
  });
});
