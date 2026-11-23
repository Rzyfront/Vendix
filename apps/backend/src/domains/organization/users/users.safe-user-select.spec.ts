import { UsersService } from './users.service';
import { createPrismaMock } from '../../../testing/prisma-mock';
import {
  expectNoSensitiveUserFields,
  fullUserRow,
  projectUserRow,
} from '../../../testing/user-row-fixture';

/**
 * Organization user management (`/organization/users/...`): every user it
 * returns carries profile columns only, never credentials nor lockout
 * counters, including the reset-password answer.
 */
describe('Organization UsersService — minimal user columns in responses', () => {
  const prisma = createPrismaMock({
    users: ['findFirst', 'findUnique', 'update'],
    email_verification_tokens: ['deleteMany'],
  });
  const auditService = { logUpdate: jest.fn() };
  const s3Service = { signUrl: jest.fn(async (url: string | null) => url) };
  let service: UsersService;

  const asPrisma = (state: string) => async (args: any) =>
    projectUserRow({ ...fullUserRow(5), state }, args?.select);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.users.findFirst.mockImplementation(asPrisma('active'));
    prisma.users.findUnique.mockImplementation(asPrisma('suspended'));
    prisma.users.update.mockImplementation(asPrisma('active'));
    prisma.email_verification_tokens.deleteMany.mockResolvedValue({ count: 0 });
    service = new UsersService(
      prisma as never,
      {} as never,
      auditService as never,
      s3Service as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('GET /organization/users/:id', async () => {
    expectNoSensitiveUserFields(await service.findOne(5));
  });

  it('GET /organization/users/:id/settings', async () => {
    expectNoSensitiveUserFields(await service.findUserSettings(5));
  });

  it('PATCH /organization/users/:id', async () => {
    const result = await service.update(5, { first_name: 'Ana' } as never);

    expectNoSensitiveUserFields(result);
    expect(result).toEqual(expect.objectContaining({ id: 5 }));
  });

  it('archive, reactivate and soft delete', async () => {
    expectNoSensitiveUserFields(await service.archive(5));
    expectNoSensitiveUserFields(await service.reactivate(5));
    expectNoSensitiveUserFields(await service.remove(5));
  });

  it('POST /organization/users/:id/verify-email', async () => {
    expectNoSensitiveUserFields(await service.verifyEmail(5));
  });

  it('POST /organization/users/:id/reset-password answers without the hash it just wrote', async () => {
    const result = await service.resetPassword(5, {
      new_password: 'Nueva-Clave-2026!',
      confirm_password: 'Nueva-Clave-2026!',
    });

    expectNoSensitiveUserFields(result);
    const [args] = prisma.users.update.mock.calls[0];
    expect(args.data.password).toEqual(expect.stringMatching(/^\$2[aby]\$/));
  });
});
