import { CustomersService } from './customers.service';

describe('CustomersService email identity', () => {
  const createService = () => {
    const prisma = {
      users: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockImplementation(async ({ data }) => data),
      },
    };
    const service = new CustomersService(prisma as never, {} as never);
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 10,
      organization_id: 3,
      document_type: null,
      document_number: null,
      first_name: 'Ana',
      last_name: 'Diaz',
      person_type: null,
    } as never);
    return { service, prisma };
  };

  it('matches legacy mixed-case email for agent upserts without crossing organizations', async () => {
    const { service, prisma } = createService();
    await service.findUserByEmailInOrganizationForAgent(
      '  ANA@Example.COM ',
      3,
      10,
    );

    expect(prisma.users.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: 'ana@example.com', mode: 'insensitive' },
        organization_id: 3,
        NOT: { id: 10 },
      },
      select: { id: true, first_name: true, last_name: true },
    });
  });

  it('checks email edits case-insensitively, excludes self, and saves lowercase', async () => {
    const { service, prisma } = createService();
    await service.update(2, 10, { email: '  ANA@Example.COM ' });

    expect(prisma.users.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: 'ana@example.com', mode: 'insensitive' },
        organization_id: 3,
        id: { not: 10 },
        state: { not: 'archived' },
      },
      select: { id: true },
    });
    expect(prisma.users.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'ana@example.com' }),
      }),
    );
  });

  it('rejects another active customer with the same email on edit', async () => {
    const { service, prisma } = createService();
    prisma.users.findFirst.mockResolvedValue({ id: 11 } as never);
    await expect(
      service.update(2, 10, { email: 'ANA@example.com' }),
    ).rejects.toMatchObject({
      errorCode: 'SYS_CONFLICT_001',
    });
    expect(prisma.users.update).not.toHaveBeenCalled();
  });

  it.each([null, '   '])(
    'preserves nullable email when clearing with %p',
    async (email) => {
      const { service, prisma } = createService();
      await service.update(2, 10, { email } as never);
      expect(prisma.users.findFirst).not.toHaveBeenCalled();
      expect(prisma.users.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: null }),
        }),
      );
    },
  );
});
