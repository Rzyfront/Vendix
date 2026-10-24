import { LocationsService } from './locations.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

describe('LocationsService.getDefaultLocation', () => {
  it('prioriza is_default y luego id en todos los fallbacks, sin depender del orden físico', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 18 });
    const prisma = {
      inventory_locations: { findFirst },
      stores: {
        findUnique: jest.fn().mockResolvedValue({ organization_id: 3 }),
      },
    };
    const service = new LocationsService(
      prisma as unknown as StorePrismaService,
    );

    await expect(service.getDefaultLocation(7)).resolves.toEqual({ id: 18 });
    expect(findFirst).toHaveBeenCalledTimes(4);
    for (const [query] of findFirst.mock.calls) {
      expect(query.orderBy).toEqual([{ is_default: 'desc' }, { id: 'asc' }]);
    }
    expect(findFirst.mock.calls[0][0].where).toMatchObject({
      store_id: 7,
      type: 'warehouse',
    });
    expect(findFirst.mock.calls[2][0].where).toMatchObject({
      organization_id: 3,
      store_id: null,
      type: 'warehouse',
    });
  });
});
