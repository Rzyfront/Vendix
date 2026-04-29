import { DunningService } from './dunning.service';

describe('DunningService', () => {
  let service: DunningService;
  let prisma: any;
  let stateService: any;
  let notifications: any;
  let paymentRetryQueue: any;
  let resolverService: any;

  beforeEach(() => {
    prisma = {
      store_subscriptions: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
      },
      subscription_events: {
        create: jest.fn(),
      },
    };
    stateService = {
      transition: jest.fn(),
      isLegalTransition: jest.fn(),
    };
    notifications = { createAndBroadcast: jest.fn() };
    paymentRetryQueue = { add: jest.fn() };
    resolverService = { resolveSubscription: jest.fn() };
    service = new DunningService(
      prisma,
      stateService,
      notifications,
      paymentRetryQueue,
      resolverService,
    );
  });

  describe('findAll', () => {
    it('restricts to grace_soft/grace_hard/suspended/blocked states by default', async () => {
      prisma.store_subscriptions.findMany.mockResolvedValue([]);
      prisma.store_subscriptions.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 10 } as any);

      const args = prisma.store_subscriptions.findMany.mock.calls[0][0];
      expect(args.where.state).toEqual({
        in: ['grace_soft', 'grace_hard', 'suspended', 'blocked'],
      });
    });

    it('narrows to specific dunning state when provided', async () => {
      prisma.store_subscriptions.findMany.mockResolvedValue([]);
      prisma.store_subscriptions.count.mockResolvedValue(0);

      await service.findAll({ state: 'grace_hard' } as any);

      const args = prisma.store_subscriptions.findMany.mock.calls[0][0];
      expect(args.where.state).toBe('grace_hard');
    });

    it('includes overdue/draft invoices for oldest-due first', async () => {
      prisma.store_subscriptions.findMany.mockResolvedValue([]);
      prisma.store_subscriptions.count.mockResolvedValue(0);

      await service.findAll({} as any);

      const args = prisma.store_subscriptions.findMany.mock.calls[0][0];
      expect(args.include.invoices.where.state).toEqual({
        in: ['overdue', 'draft'],
      });
      expect(args.include.invoices.orderBy).toEqual({ due_at: 'asc' });
      expect(args.include.invoices.take).toBe(1);
    });
  });

  describe('getStats', () => {
    it('aggregates counts per dunning state and computes total', async () => {
      prisma.store_subscriptions.count
        .mockResolvedValueOnce(3) // grace_soft
        .mockResolvedValueOnce(2) // grace_hard
        .mockResolvedValueOnce(1) // suspended
        .mockResolvedValueOnce(4); // blocked

      const stats = await service.getStats();

      expect(stats).toEqual({
        grace_soft: 3,
        grace_hard: 2,
        suspended: 1,
        blocked: 4,
        total: 10,
      });
      expect(prisma.store_subscriptions.count).toHaveBeenCalledTimes(4);
    });

    it('returns zeros when no dunning rows exist', async () => {
      prisma.store_subscriptions.count.mockResolvedValue(0);
      const stats = await service.getStats();
      expect(stats.total).toBe(0);
    });
  });

  describe('previewTransition', () => {
    const baseSub = {
      id: 7,
      store_id: 42,
      state: 'grace_hard',
      currency: 'COP',
      plan: { id: 1, code: 'pro', name: 'Pro' },
      store: {
        id: 42,
        name: 'Acme',
        organization_id: 5,
        organizations: { id: 5, name: 'Acme Org', email: 'ops@acme.test' },
      },
      partner_override: null,
      invoices: [
        {
          id: 100,
          invoice_number: 'INV-100',
          state: 'overdue',
          total: '50000',
          partner_organization_id: null,
          commission: null,
        },
        {
          id: 101,
          invoice_number: 'INV-101',
          state: 'issued',
          total: '20000',
          partner_organization_id: 9,
          commission: {
            id: 200,
            partner_organization_id: 9,
            amount: '4000',
            state: 'accrued',
          },
        },
      ],
    };

    it('returns full side-effects for a legal cancellation transition', async () => {
      prisma.store_subscriptions.findUnique.mockResolvedValue(baseSub);
      stateService.isLegalTransition.mockReturnValue(true);
      resolverService.resolveSubscription.mockResolvedValue({
        features: {
          text_generation: { enabled: true },
          streaming_chat: { enabled: true },
          tool_agents: { enabled: false },
        },
      });

      const out = await service.previewTransition(7, 'cancelled');

      expect(out.legal).toBe(true);
      expect(out.current_state).toBe('grace_hard');
      expect(out.target_state).toBe('cancelled');
      expect(out.side_effects.emails_to_send.length).toBe(1);
      expect(out.side_effects.emails_to_send[0].key).toBe(
        'subscription.cancellation.email',
      );
      expect(out.side_effects.features_lost.sort()).toEqual([
        'streaming_chat',
        'text_generation',
      ]);
      expect(out.side_effects.features_gained).toEqual([]);
      expect(out.side_effects.invoices_affected.length).toBe(2);
      expect(out.side_effects.invoices_affected[0]).toMatchObject({
        id: 100,
        invoice_number: 'INV-100',
        state: 'overdue',
        total: 50000,
      });
      expect(out.side_effects.commissions_affected.length).toBe(1);
      expect(out.side_effects.commissions_affected[0]).toMatchObject({
        id: 200,
        partner_org_id: 9,
        amount: 4000,
        state: 'accrued',
      });
      expect(out.warnings.some((w) => w.includes('NO-REFUNDS'))).toBe(true);
      expect(out.warnings.some((w) => w.includes('irreversible'))).toBe(true);
    });

    it('returns legal=false with allowed-targets warning for an illegal transition', async () => {
      prisma.store_subscriptions.findUnique.mockResolvedValue({
        ...baseSub,
        state: 'cancelled',
        invoices: [],
      });
      // cancelled is terminal — every probe returns false
      stateService.isLegalTransition.mockReturnValue(false);

      const out = await service.previewTransition(7, 'active');

      expect(out.legal).toBe(false);
      expect(out.side_effects.emails_to_send).toEqual([]);
      expect(out.side_effects.features_lost).toEqual([]);
      expect(out.side_effects.invoices_affected).toEqual([]);
      expect(out.side_effects.commissions_affected).toEqual([]);
      expect(out.warnings[0]).toMatch(/Transición ilegal/i);
      // No resolver call when illegal
      expect(resolverService.resolveSubscription).not.toHaveBeenCalled();
    });

    it('emits a reactivation email for blocked → active', async () => {
      prisma.store_subscriptions.findUnique.mockResolvedValue({
        ...baseSub,
        state: 'blocked',
        invoices: [],
      });
      stateService.isLegalTransition.mockReturnValue(true);
      resolverService.resolveSubscription.mockResolvedValue({ features: {} });

      const out = await service.previewTransition(7, 'active');

      expect(out.legal).toBe(true);
      expect(out.side_effects.emails_to_send[0].key).toBe(
        'subscription.reactivation.email',
      );
      expect(out.side_effects.invoices_affected).toEqual([]);
      expect(out.side_effects.commissions_affected).toEqual([]);
    });
  });
});
