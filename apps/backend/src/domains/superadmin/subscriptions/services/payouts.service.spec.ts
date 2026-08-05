import { PayoutsService } from './payouts.service';
import { VendixHttpException } from '../../../../common/errors';

describe('PayoutsService', () => {
  let service: PayoutsService;
  let prisma: any;
  let eventEmitter: { emit: jest.Mock };

  beforeEach(() => {
    prisma = {
      partner_payout_batches: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      partner_commissions: {
        updateMany: jest.fn(),
      },
    };
    // Marking a batch paid emits `partner_payout_batch.paid`, which is what makes
    // the platform's books settle the partner payable (DR 2335 / CR 1110).
    eventEmitter = { emit: jest.fn() };
    service = new PayoutsService(prisma, eventEmitter as any);
  });

  /**
   * `draft` is the batch's initial state. The fixture used to say `pending`, which
   * is not even a member of `partner_payout_batch_state_enum`
   * (draft → approved → sent → paid, plus rejected) — so every assertion built on
   * it was describing a state machine that does not exist.
   */
  function batchFixture(overrides: Partial<any> = {}) {
    return {
      id: 1,
      partner_organization_id: 10,
      state: 'draft',
      payout_method: 'bank_transfer',
      ...overrides,
    };
  }

  describe('findAll', () => {
    it('filters by partner_organization_id and state', async () => {
      prisma.partner_payout_batches.findMany.mockResolvedValue([]);
      prisma.partner_payout_batches.count.mockResolvedValue(0);

      await service.findAll({
        partner_organization_id: 10,
        state: 'draft',
      } as any);

      const args = prisma.partner_payout_batches.findMany.mock.calls[0][0];
      expect(args.where.partner_organization_id).toBe(10);
      expect(args.where.state).toBe('draft');
    });
  });

  describe('findOne', () => {
    it('includes commissions with nested invoice details', async () => {
      const batch = batchFixture();
      prisma.partner_payout_batches.findUnique.mockResolvedValue(batch);

      const result = await service.findOne(1);
      expect(result === batch).toBe(true);
      const args = prisma.partner_payout_batches.findUnique.mock.calls[0][0];
      expect(args.include.commissions).toBeDefined();
      expect(args.include.commissions.include.invoice).toBeDefined();
    });

    it('throws SYS_NOT_FOUND_001 when batch missing', async () => {
      prisma.partner_payout_batches.findUnique.mockResolvedValue(null);
      let err: any = null;
      try {
        await service.findOne(999);
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(err instanceof VendixHttpException).toBe(true);
    });
  });

  describe('approve', () => {
    it('transitions draft → approved and flips commissions to pending_payout', async () => {
      prisma.partner_payout_batches.findUnique.mockResolvedValue(
        batchFixture(),
      );
      prisma.partner_payout_batches.update.mockResolvedValue(
        batchFixture({ state: 'approved' }),
      );
      prisma.partner_commissions.updateMany.mockResolvedValue({ count: 3 });

      await service.approve(1, {
        payout_method: 'bank_transfer',
        reference: 'REF-42',
      } as any);

      const updateArgs = prisma.partner_payout_batches.update.mock.calls[0][0];
      expect(updateArgs.data.state).toBe('approved');
      expect(updateArgs.data.reference).toBe('REF-42');

      const commArgs = prisma.partner_commissions.updateMany.mock.calls[0][0];
      expect(commArgs.where.payout_batch_id).toBe(1);
      expect(commArgs.data.state).toBe('pending_payout');
    });

    it('throws PARTNER_004 when batch is not in draft state', async () => {
      prisma.partner_payout_batches.findUnique.mockResolvedValue(
        batchFixture({ state: 'paid' }),
      );
      let err: any = null;
      try {
        await service.approve(1, {} as any);
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(err instanceof VendixHttpException).toBe(true);
      expect(prisma.partner_payout_batches.update).not.toHaveBeenCalled();
    });
  });

  describe('markPaid', () => {
    it('transitions approved → paid and flips commissions to paid', async () => {
      prisma.partner_payout_batches.findUnique.mockResolvedValue(
        batchFixture({ state: 'approved' }),
      );
      prisma.partner_payout_batches.update.mockResolvedValue(
        batchFixture({ state: 'paid' }),
      );
      prisma.partner_commissions.updateMany.mockResolvedValue({ count: 3 });

      await service.markPaid(1);

      const updateArgs = prisma.partner_payout_batches.update.mock.calls[0][0];
      expect(updateArgs.data.state).toBe('paid');
      expect(updateArgs.data.paid_at).toBeInstanceOf(Date);

      const commArgs = prisma.partner_commissions.updateMany.mock.calls[0][0];
      expect(commArgs.data.state).toBe('paid');
      expect(commArgs.data.paid_at).toBeInstanceOf(Date);

      // RNC-MF-3: without this event the platform's books never settle the
      // partner payable, so the commission stays as an open liability forever.
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'partner_payout_batch.paid',
        expect.objectContaining({ batchId: 1 }),
      );
    });

    /**
     * The emit is wrapped in try/catch on purpose: an accounting listener that
     * throws must not undo an already-committed payout, and the admin must not see
     * a failure for a batch that IS paid.
     */
    it('completes the payout even if the accounting listener throws', async () => {
      prisma.partner_payout_batches.findUnique.mockResolvedValue(
        batchFixture({ state: 'approved' }),
      );
      prisma.partner_payout_batches.update.mockResolvedValue(
        batchFixture({ state: 'paid' }),
      );
      prisma.partner_commissions.updateMany.mockResolvedValue({ count: 3 });
      eventEmitter.emit.mockImplementation(() => {
        throw new Error('listener exploded');
      });

      await expect(service.markPaid(1)).resolves.toMatchObject({
        state: 'paid',
      });
    });

    it('throws PARTNER_004 when batch is not in approved state', async () => {
      prisma.partner_payout_batches.findUnique.mockResolvedValue(
        batchFixture({ state: 'draft' }),
      );
      let err: any = null;
      try {
        await service.markPaid(1);
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(err instanceof VendixHttpException).toBe(true);
    });
  });
});
