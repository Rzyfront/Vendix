import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { TemplatesService } from './templates.service';

describe('TemplatesService checkin blocks', () => {
  let service: TemplatesService;
  let prisma: Record<string, any>;

  beforeEach(() => {
    prisma = {
      data_collection_templates: {
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 5, ...data })),
        findUnique: jest.fn().mockResolvedValue({ id: 5, name: 'T' }),
        update: jest.fn().mockResolvedValue({ id: 5 }),
      },
      data_collection_tabs: { create: jest.fn(), deleteMany: jest.fn() },
      data_collection_sections: { create: jest.fn(), deleteMany: jest.fn() },
      data_collection_items: { create: jest.fn() },
    };
    service = new TemplatesService(prisma as unknown as StorePrismaService, { emit: jest.fn() } as any);
  });

  it('createTemplate persiste los bloques enviados y deja visibles los demás', async () => {
    await service.createTemplate({ name: 'Taller', checkin_show_budget: false } as any);

    expect(prisma.data_collection_templates.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        checkin_show_budget: false,
        checkin_show_products: true,
        checkin_show_notes: true,
      }),
    });
  });

  it('updateTemplate solo toca los bloques enviados', async () => {
    await service.updateTemplate(5, { name: 'T2', checkin_show_notes: false } as any);

    expect(prisma.data_collection_templates.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({ checkin_show_notes: false }),
    });
    const data = prisma.data_collection_templates.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('checkin_show_budget');
    expect(data).not.toHaveProperty('checkin_show_products');
  });
});
