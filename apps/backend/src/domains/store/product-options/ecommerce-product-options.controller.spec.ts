import { EcommerceProductOptionsController } from './ecommerce-product-options.controller';
import { RequestContextService } from '@common/context/request-context.service';

describe('EcommerceProductOptionsController (QUI-1001)', () => {
  const groups = [{ id: 1, name: 'Sabor' }];
  let productOptions: { applicableForProduct: jest.Mock };
  let globalPrisma: { stores: { findUnique: jest.Mock } };
  let controller: EcommerceProductOptionsController;
  const responseService = { success: jest.fn((data: unknown) => ({ data })) };

  beforeEach(() => {
    productOptions = { applicableForProduct: jest.fn().mockResolvedValue(groups) };
    globalPrisma = { stores: { findUnique: jest.fn() } };
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(7);
    controller = new EcommerceProductOptionsController(
      productOptions as any,
      responseService as any,
      globalPrisma as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns the groups for a restaurant store', async () => {
    globalPrisma.stores.findUnique.mockResolvedValue({ industries: ['restaurant'] });
    const res: any = await controller.forProduct(5);
    expect(res.data).toEqual(groups);
    expect(productOptions.applicableForProduct).toHaveBeenCalledWith(7, 5, { withCost: false });
  });

  it('returns an empty list for a retail store without reading the groups', async () => {
    globalPrisma.stores.findUnique.mockResolvedValue({ industries: ['retail'] });
    const res: any = await controller.forProduct(5);
    expect(res.data).toEqual([]);
    expect(productOptions.applicableForProduct).not.toHaveBeenCalled();
  });

  it('keeps the groups when the store also has the restaurant industry', async () => {
    globalPrisma.stores.findUnique.mockResolvedValue({ industries: ['retail', 'restaurant'] });
    const res: any = await controller.forProduct(5);
    expect(res.data).toEqual(groups);
  });
});
