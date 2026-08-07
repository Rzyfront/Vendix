import { VendixHttpException } from 'src/common/errors';
import { MembershipsService } from './memberships.service';

/**
 * Focused tests for QUI-646 (archive / unarchive member flow). The rest of the
 * MembershipsService surface is large and already covered by integration tests
 * in this repo; this spec isolates the soft-delete behavior so a regression on
 * the guard (active plan) or the idempotency rules is caught early.
 */
describe('MembershipsService.archiveMember / unarchiveMember (QUI-646)', () => {
  // Captured calls. The service goes through `withoutScope()` for users reads/
  // writes and through the scoped prisma for memberships counts; we mock both.
  let withoutScope: {
    users: {
      findFirst: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let memberships: { count: jest.Mock };
  let service: MembershipsService;
  const STORE_ID = 1;
  const CUSTOMER_ID = 42;

  beforeEach(() => {
    jest.clearAllMocks();
    withoutScope = {
      users: {
        findFirst: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    memberships = { count: jest.fn() };

    // The service reads `RequestContextService.getContext()` for the store id.
    jest
      .spyOn(require('@common/context/request-context.service').RequestContextService, 'getContext')
      .mockReturnValue({ store_id: STORE_ID, is_super_admin: false, is_owner: false });

    // The service has 4 constructor dependencies (StorePrismaService +
    // MembershipPlansService + PaymentsService + OrderFlowService). Only the
    // prisma client is exercised by archive/unarchive; the rest can be `any`.
    service = new MembershipsService(
      {
        withoutScope: () => withoutScope,
        memberships,
      } as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('archiveMember', () => {
    it('stamps archived_at when the customer is not archived and has no active plans', async () => {
      const now = new Date('2026-08-06T10:00:00Z');
      jest.useFakeTimers().setSystemTime(now);

      withoutScope.users.findFirst.mockResolvedValue({
        id: CUSTOMER_ID,
        archived_at: null,
      });
      memberships.count.mockResolvedValue(0);
      withoutScope.users.update.mockResolvedValue({ archived_at: now });

      const result = await service.archiveMember(CUSTOMER_ID);

      expect(result.archived_at).toEqual(now);
      // WHERE must scope by store — withoutScope() is global otherwise.
      expect(withoutScope.users.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: CUSTOMER_ID, main_store_id: STORE_ID }),
        }),
      );
      // Guard: must count active plans BEFORE updating.
      expect(memberships.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            store_id: STORE_ID,
            customer_id: CUSTOMER_ID,
            status: 'active',
          }),
        }),
      );
      expect(withoutScope.users.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CUSTOMER_ID },
          data: expect.objectContaining({ archived_at: now }),
        }),
      );

      jest.useRealTimers();
    });

    it('rejects when the customer has at least one active plan (409)', async () => {
      withoutScope.users.findFirst.mockResolvedValue({
        id: CUSTOMER_ID,
        archived_at: null,
      });
      memberships.count.mockResolvedValue(1); // one active plan

      await expect(service.archiveMember(CUSTOMER_ID)).rejects.toMatchObject({
        code: 'MEMBERSHIP_ARCHIVE_BLOCKED_ACTIVE_PLAN_001',
        httpStatus: 409,
      });

      // Crucially: the UPDATE must NOT have run.
      expect(withoutScope.users.update).not.toHaveBeenCalled();
    });

    it('rejects double-archive (409) — idempotency guard', async () => {
      withoutScope.users.findFirst.mockResolvedValue({
        id: CUSTOMER_ID,
        archived_at: new Date('2026-07-01T00:00:00Z'),
      });

      await expect(service.archiveMember(CUSTOMER_ID)).rejects.toMatchObject({
        code: 'MEMBERSHIP_ALREADY_ARCHIVED_001',
        httpStatus: 409,
      });
      expect(withoutScope.users.update).not.toHaveBeenCalled();
      // The active-plans query must NOT run either (no point counting if the
      // member is already archived).
      expect(memberships.count).not.toHaveBeenCalled();
    });

    it('returns SYS_NOT_FOUND_001 when the customer does not exist in this store', async () => {
      withoutScope.users.findFirst.mockResolvedValue(null);

      await expect(service.archiveMember(CUSTOMER_ID)).rejects.toBeInstanceOf(
        VendixHttpException,
      );
    });
  });

  describe('unarchiveMember', () => {
    it('clears archived_at when the customer is currently archived', async () => {
      withoutScope.users.findFirst.mockResolvedValue({
        id: CUSTOMER_ID,
        archived_at: new Date('2026-07-01T00:00:00Z'),
      });
      withoutScope.users.update.mockResolvedValue({ archived_at: null });

      const result = await service.unarchiveMember(CUSTOMER_ID);

      expect(result.archived_at).toBeNull();
      expect(withoutScope.users.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CUSTOMER_ID },
          data: expect.objectContaining({ archived_at: null }),
        }),
      );
    });

    it('rejects unarchive on a non-archived member (409)', async () => {
      withoutScope.users.findFirst.mockResolvedValue({
        id: CUSTOMER_ID,
        archived_at: null,
      });

      await expect(service.unarchiveMember(CUSTOMER_ID)).rejects.toMatchObject({
        code: 'MEMBERSHIP_NOT_ARCHIVED_001',
        httpStatus: 409,
      });
      expect(withoutScope.users.update).not.toHaveBeenCalled();
    });
  });
});
