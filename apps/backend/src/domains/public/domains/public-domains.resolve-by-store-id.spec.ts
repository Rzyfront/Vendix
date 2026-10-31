import { NotFoundException } from '@nestjs/common';
import { PublicDomainsService } from './public-domains.service';

describe('PublicDomainsService.resolveByStoreId', () => {
  const findFirst = jest.fn();
  const service = new PublicDomainsService(
    { stores: { findFirst } } as any,
    {} as any,
  );

  beforeEach(() => findFirst.mockReset());

  it('resuelve una tienda activa', async () => {
    findFirst.mockResolvedValue({ id: 9, organization_id: 1 });

    await expect(service.resolveByStoreId(9)).resolves.toEqual({
      store_id: 9,
      organization_id: 1,
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 9, is_active: true } }),
    );
  });

  it('rechaza una tienda inexistente o inactiva', async () => {
    findFirst.mockResolvedValue(null);

    await expect(service.resolveByStoreId(9)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
