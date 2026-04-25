import { Prisma } from '@prisma/client';
import { PartnersService } from './partners.service';
import { VendixHttpException } from '../../../../common/errors';

describe('PartnersService', () => {
  let service: PartnersService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      organizations: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      subscription_plans: {
        findUnique: jest.fn(),
      },
      partner_plan_overrides: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new PartnersService(prisma as any);
  });

  function orgFixture(overrides: Partial<any> = {}) {
    return {
      id: 10,
      name: 'Partner Co',
      is_partner: false,
      partner_settings: {},
      ...overrides,
    };
  }

  function planFixture(overrides: Partial<any> = {}) {
    return {
      id: 5,
      code: 'pro',
      name: 'Pro',
      max_partner_margin_pct: new Prisma.Decimal(30),
      ...overrides,
    };
  }

  describe('togglePartner', () => {
    it('updates is_partner flag on organization', async () => {
      prisma.organizations.findUnique.mockResolvedValue(orgFixture());
      prisma.organizations.update.mockResolvedValue(orgFixture({ is_partner: true }));

      await service.togglePartner({ organization_id: 10, is_partner: true } as any);

      const args = prisma.organizations.update.mock.calls[0][0];
      expect(args.where.id).toBe(10);
      expect(args.data.is_partner).toBe(true);
      expect(args.data.updated_at).toBeInstanceOf(Date);
    });

    it('throws ORG_FIND_001 when organization missing', async () => {
      prisma.organizations.findUnique.mockResolvedValue(null);
      let err: any = null;
      try {
        await service.togglePartner({ organization_id: 99, is_partner: true } as any);
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(err instanceof VendixHttpException).toBe(true);
    });
  });

  describe('setMarginCap', () => {
    it('merges max_partner_margin_pct into partner_settings JSON', async () => {
      prisma.organizations.findUnique.mockResolvedValue(
        orgFixture({ partner_settings: { existing: true } }),
      );
      prisma.organizations.update.mockResolvedValue(orgFixture());

      await service.setMarginCap({
        organization_id: 10,
        max_partner_margin_pct: 25,
      } as any);

      const args = prisma.organizations.update.mock.calls[0][0];
      expect(args.data.partner_settings).toEqual({
        existing: true,
        max_partner_margin_pct: 25,
      });
    });
  });

  describe('createOverride', () => {
    it('creates override when margin within plan cap', async () => {
      prisma.partner_plan_overrides.findUnique.mockResolvedValue(null);
      prisma.subscription_plans.findUnique.mockResolvedValue(planFixture());
      prisma.partner_plan_overrides.create.mockResolvedValue({ id: 1 });

      await service.createOverride({
        organization_id: 10,
        base_plan_id: 5,
        margin_pct: 20,
      } as any);

      expect(prisma.partner_plan_overrides.create).toHaveBeenCalled();
      const args = prisma.partner_plan_overrides.create.mock.calls[0][0];
      expect(args.data.organization_id).toBe(10);
      expect(args.data.base_plan_id).toBe(5);
      expect(args.data.margin_pct).toBe(20);
      expect(args.data.is_active).toBe(true);
    });

    it('throws PARTNER_002 when margin exceeds plan cap', async () => {
      prisma.partner_plan_overrides.findUnique.mockResolvedValue(null);
      prisma.subscription_plans.findUnique.mockResolvedValue(
        planFixture({ max_partner_margin_pct: new Prisma.Decimal(15) }),
      );

      let err: any = null;
      try {
        await service.createOverride({
          organization_id: 10,
          base_plan_id: 5,
          margin_pct: 40,
        } as any);
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(err instanceof VendixHttpException).toBe(true);
      expect(prisma.partner_plan_overrides.create).not.toHaveBeenCalled();
    });

    it('throws SYS_CONFLICT_001 when override already exists', async () => {
      prisma.partner_plan_overrides.findUnique.mockResolvedValue({ id: 1 });
      let err: any = null;
      try {
        await service.createOverride({
          organization_id: 10,
          base_plan_id: 5,
          margin_pct: 20,
        } as any);
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(err instanceof VendixHttpException).toBe(true);
    });
  });

  describe('updateOverride', () => {
    it('applies partial updates to existing override', async () => {
      prisma.partner_plan_overrides.findUnique.mockResolvedValue({ id: 1 });
      prisma.partner_plan_overrides.update.mockResolvedValue({ id: 1 });

      await service.updateOverride(1, { margin_pct: 12, is_active: false } as any);

      const args = prisma.partner_plan_overrides.update.mock.calls[0][0];
      expect(args.data.margin_pct).toBe(12);
      expect(args.data.is_active).toBe(false);
      expect(args.data.custom_code).toBeUndefined();
    });
  });

  describe('removeOverride', () => {
    it('deletes override when it exists', async () => {
      prisma.partner_plan_overrides.findUnique.mockResolvedValue({ id: 1 });
      prisma.partner_plan_overrides.delete.mockResolvedValue({ id: 1 });

      await service.removeOverride(1);
      expect(prisma.partner_plan_overrides.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('throws SYS_NOT_FOUND_001 when override missing', async () => {
      prisma.partner_plan_overrides.findUnique.mockResolvedValue(null);
      let err: any = null;
      try {
        await service.removeOverride(999);
      } catch (e) {
        err = e;
      }
      expect(err).toBeTruthy();
      expect(err instanceof VendixHttpException).toBe(true);
    });
  });
});
