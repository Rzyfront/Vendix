import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '../../../common/errors';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { TemplatesService } from './templates.service';

const STORE = 10;

/**
 * QUI-1043 H7: one CRM default template per store, only an active customer
 * template, independent from the booking fallback `is_default`.
 */
describe('TemplatesService CRM default', () => {
  let service: TemplatesService;
  let prisma: Record<string, any>;
  let tx: Record<string, any>;

  function existing(overrides: Record<string, unknown> = {}) {
    prisma.data_collection_templates.findUnique.mockResolvedValue({
      id: 5,
      name: 'T',
      entity_type: 'customer',
      status: 'active',
      is_default: false,
      is_crm_default: false,
      ...overrides,
    });
  }

  async function codeOf(promise: Promise<unknown>) {
    const error = await promise.then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(VendixHttpException);
    return (error as VendixHttpException).errorCode;
  }

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: STORE } as any);
    tx = {
      data_collection_templates: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma = {
      data_collection_templates: {
        create: jest
          .fn()
          .mockImplementation(({ data }: any) => Promise.resolve({ id: 5, ...data })),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 5 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      data_collection_tabs: { create: jest.fn(), deleteMany: jest.fn() },
      data_collection_sections: { create: jest.fn(), deleteMany: jest.fn() },
      data_collection_items: { create: jest.fn() },
      $transaction: jest.fn(async (fn: (client: any) => Promise<unknown>) => fn(tx)),
    };
    existing();
    service = new TemplatesService(
      prisma as unknown as StorePrismaService,
      { emit: jest.fn() } as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('marking one unmarks the previous CRM default of the store, in one transaction', async () => {
    await service.updateTemplate(5, { is_crm_default: true } as any);

    expect(tx.data_collection_templates.updateMany).toHaveBeenNthCalledWith(1, {
      where: { store_id: STORE, is_crm_default: true, id: { not: 5 } },
      data: { is_crm_default: false },
    });
    expect(tx.data_collection_templates.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 5, store_id: STORE },
      data: { is_crm_default: true },
    });
    // The booking fallback is not touched.
    expect(prisma.data_collection_templates.update.mock.calls[0][0].data.is_default).toBeUndefined();
  });

  it('a new customer template can be created as the CRM default', async () => {
    await service.createTemplate({
      name: 'Ficha',
      entity_type: 'customer',
      is_crm_default: true,
    } as any);

    expect(prisma.data_collection_templates.create).toHaveBeenCalledWith({
      data: expect.not.objectContaining({ is_crm_default: true }),
    });
    expect(tx.data_collection_templates.updateMany).toHaveBeenLastCalledWith({
      where: { id: 5, store_id: STORE },
      data: { is_crm_default: true },
    });
  });

  it('only an active customer template can be the CRM default, checked before any write', async () => {
    expect(
      await codeOf(
        service.createTemplate({ name: 'Reserva', is_crm_default: true } as any),
      ),
    ).toBe('DCOL_CRM_001');
    expect(prisma.data_collection_templates.create).not.toHaveBeenCalled();

    existing({ entity_type: 'booking' });
    expect(
      await codeOf(service.updateTemplate(5, { is_crm_default: true } as any)),
    ).toBe('DCOL_CRM_001');

    existing();
    expect(
      await codeOf(
        service.updateTemplate(5, {
          is_crm_default: true,
          status: 'inactive',
          sections: [],
        } as any),
      ),
    ).toBe('DCOL_CRM_001');
    expect(prisma.data_collection_sections.deleteMany).not.toHaveBeenCalled();
    expect(prisma.data_collection_templates.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('the CRM default loses the mark when it stops being an active customer template or is unmarked', async () => {
    existing({ is_crm_default: true });
    await service.updateTemplate(5, { status: 'archived' } as any);
    expect(prisma.data_collection_templates.updateMany).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { is_crm_default: false },
    });

    prisma.data_collection_templates.updateMany.mockClear();
    existing({ is_crm_default: true });
    await service.updateTemplate(5, { is_crm_default: false } as any);
    expect(prisma.data_collection_templates.updateMany).toHaveBeenCalledTimes(1);

    prisma.data_collection_templates.updateMany.mockClear();
    existing({ is_crm_default: true });
    await service.updateTemplate(5, { name: 'Solo nombre' } as any);
    expect(prisma.data_collection_templates.updateMany).not.toHaveBeenCalled();
  });

  it('is_default (booking fallback) keeps working as before', async () => {
    await service.updateTemplate(5, { is_default: true } as any);
    expect(prisma.data_collection_templates.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({ is_default: true }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
