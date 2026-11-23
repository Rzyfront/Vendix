import { StoresService } from './stores.service';
import { createPrismaMock } from '../../../testing/prisma-mock';
import {
  expectNoSensitiveUserFields,
  fullUserRow,
  projectUserRow,
} from '../../../testing/user-row-fixture';

/**
 * `GET /store/stores/:id` lists the store's staff: profile columns only for
 * each of them.
 */
describe('Store StoresService.findOne — staff with minimal user columns', () => {
  const prisma = createPrismaMock({ stores: ['findUnique'] });
  const s3Service = { signUrl: jest.fn(async (key: string | null) => key) };

  it('returns each store user without credentials nor lockout counters', async () => {
    prisma.stores.findUnique.mockImplementation(async (args: any) => ({
      id: 4,
      logo_url: null,
      store_users: [
        {
          user_id: 5,
          user: projectUserRow(
            fullUserRow(5),
            args.include.store_users.include.user.select,
          ),
        },
      ],
    }));
    const service = new StoresService(
      prisma as never,
      s3Service as never,
      {} as never,
      {} as never,
    );

    const store = await service.findOne(4);

    expectNoSensitiveUserFields(store.store_users[0].user);
    expect(store.store_users[0].user).toEqual(
      expect.objectContaining({ id: 5, email: 'user5@tienda.co' }),
    );
  });
});
