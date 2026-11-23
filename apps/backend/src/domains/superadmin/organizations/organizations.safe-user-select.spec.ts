import { OrganizationsService } from './organizations.service';
import { createPrismaMock } from '../../../testing/prisma-mock';
import {
  expectNoSensitiveUserFields,
  fullUserRow,
  projectUserRow,
} from '../../../testing/user-row-fixture';
import { vendixUserWhere } from '@common/utils/vendix-user.util';

/**
 * `GET /superadmin/organizations/slug/:slug` returns the organization with
 * its Vendix users: profile columns only, never credentials nor lockout
 * counters.
 */
describe('Superadmin OrganizationsService.findBySlug — minimal user columns', () => {
  const prisma = createPrismaMock({ organizations: ['findUnique'] });
  let service: OrganizationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organizations.findUnique.mockImplementation(async (args: any) => ({
      id: 3,
      slug: 'org',
      stores: [],
      addresses: [],
      users: [fullUserRow(5), fullUserRow(6)].map((row) =>
        projectUserRow(row, args.include.users.select),
      ),
    }));
    service = new OrganizationsService(prisma as never, {} as never);
  });

  it('returns the Vendix users without password, 2FA secret or lockout fields', async () => {
    const result: any = await service.findBySlug('org');

    expect(result.users).toHaveLength(2);
    for (const user of result.users) {
      expectNoSensitiveUserFields(user);
      expect(user).toEqual(
        expect.objectContaining({
          id: expect.any(Number),
          email: expect.any(String),
          first_name: 'Ana',
          state: 'active',
        }),
      );
    }
  });

  it('keeps listing Vendix users only', async () => {
    await service.findBySlug('org');

    const [args] = prisma.organizations.findUnique.mock.calls[0];
    expect(args.where).toEqual({ slug: 'org' });
    expect(args.include.users.where).toEqual(vendixUserWhere());
  });
});
