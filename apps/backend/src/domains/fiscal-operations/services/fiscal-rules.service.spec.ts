import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { FiscalRulesService } from './fiscal-rules.service';

describe('FiscalRulesService', () => {
  const requestContext = {
    user_id: 9,
    organization_id: 1,
    store_id: 10,
    is_super_admin: false,
    is_owner: true,
  };

  const draftRow = {
    id: 5,
    organization_id: 1,
    accounting_entity_id: null,
    country_code: 'CO',
    year: 2026,
    rule_type: 'vat',
    status: 'draft',
    name: 'IVA custom',
    version: '1',
  };

  const createService = (overrides: any = {}) => {
    const tx = {
      fiscal_rule_sets: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest
          .fn()
          .mockImplementation(({ where, data }) =>
            Promise.resolve({ id: where.id, ...data }),
          ),
      },
    };
    const prisma = {
      fiscal_rule_sets: {
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 5, ...data })),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest
          .fn()
          .mockImplementation(({ where, data }) =>
            Promise.resolve({ id: where.id, ...data }),
          ),
        ...overrides.fiscal_rule_sets,
      },
      withoutScope: jest.fn(() => ({
        accounting_entities: {
          findFirst: jest.fn().mockResolvedValue({ id: 77 }),
        },
        ...overrides.unscoped,
      })),
      $transaction: jest.fn((callback: any) => callback(tx)),
    };

    return { service: new FiscalRulesService(prisma as any), prisma, tx };
  };

  const run = <T>(fn: () => Promise<T>) =>
    RequestContextService.run(requestContext as any, fn);

  describe('createRuleSet', () => {
    it('creates a draft rule set scoped to the context organization', async () => {
      const { service, prisma } = createService();

      const result = await run(() =>
        service.createRuleSet({
          name: 'IVA custom',
          rule_type: 'vat',
          year: 2026,
          rules: { rates: [19, 5] },
        } as any),
      );

      expect(prisma.fiscal_rule_sets.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organization_id: 1,
          accounting_entity_id: null,
          country_code: 'CO',
          year: 2026,
          rule_type: 'vat',
          status: 'draft',
          version: '1',
          rules: { rates: [19, 5] },
          created_by_user_id: 9,
        }),
      });
      expect(result).toMatchObject({ id: 5, status: 'draft' });
    });

    it('rejects an empty rules object', async () => {
      const { service, prisma } = createService();

      await expect(
        run(() =>
          service.createRuleSet({
            name: 'IVA custom',
            rule_type: 'vat',
            year: 2026,
            rules: {},
          } as any),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.fiscal_rule_sets.create).not.toHaveBeenCalled();
    });

    it('maps unique-constraint violations to BadRequest', async () => {
      const { service } = createService({
        fiscal_rule_sets: {
          create: jest.fn().mockRejectedValue({ code: 'P2002' }),
        },
      });

      await expect(
        run(() =>
          service.createRuleSet({
            name: 'IVA custom',
            rule_type: 'vat',
            year: 2026,
            rules: { rates: [19] },
          } as any),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateRuleSet', () => {
    it('rejects updates on non-draft rule sets', async () => {
      const { service, prisma } = createService({
        fiscal_rule_sets: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ ...draftRow, status: 'active' }),
        },
      });

      await expect(
        run(() => service.updateRuleSet(5, { name: 'nuevo' } as any)),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.fiscal_rule_sets.update).not.toHaveBeenCalled();
    });

    it('updates a draft rule set', async () => {
      const { service, prisma } = createService({
        fiscal_rule_sets: {
          findFirst: jest.fn().mockResolvedValue({ ...draftRow }),
        },
      });

      await run(() =>
        service.updateRuleSet(5, {
          name: 'nuevo',
          rules: { rates: [19] },
        } as any),
      );

      expect(prisma.fiscal_rule_sets.findFirst).toHaveBeenCalledWith({
        where: { id: 5, organization_id: 1 },
      });
      expect(prisma.fiscal_rule_sets.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { name: 'nuevo', rules: { rates: [19] } },
      });
    });

    it('throws NotFound when the rule set does not belong to the organization', async () => {
      const { service } = createService();

      await expect(
        run(() => service.updateRuleSet(99, { name: 'x' } as any)),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('activateRuleSet', () => {
    it('archives the previous active rule set of the same scope/year/type in the same transaction', async () => {
      const { service, prisma, tx } = createService({
        fiscal_rule_sets: {
          findFirst: jest.fn().mockResolvedValue({ ...draftRow }),
        },
      });

      const result = await run(() => service.activateRuleSet(5));

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.fiscal_rule_sets.updateMany).toHaveBeenCalledWith({
        where: {
          id: { not: 5 },
          organization_id: 1,
          accounting_entity_id: null,
          country_code: 'CO',
          year: 2026,
          rule_type: 'vat',
          status: 'active',
        },
        data: { status: 'archived', effective_to: expect.any(Date) },
      });
      expect(tx.fiscal_rule_sets.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { status: 'active', effective_to: null },
      });
      expect(result).toMatchObject({ id: 5, status: 'active' });
    });

    it('rejects activating a non-draft rule set', async () => {
      const { service, prisma } = createService({
        fiscal_rule_sets: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ ...draftRow, status: 'archived' }),
        },
      });

      await expect(run(() => service.activateRuleSet(5))).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('archiveRuleSet', () => {
    it('archives an active rule set setting effective_to', async () => {
      const { service, prisma } = createService({
        fiscal_rule_sets: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ ...draftRow, status: 'active' }),
        },
      });

      await run(() => service.archiveRuleSet(5));

      expect(prisma.fiscal_rule_sets.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { status: 'archived', effective_to: expect.any(Date) },
      });
    });

    it('rejects archiving an already archived rule set', async () => {
      const { service, prisma } = createService({
        fiscal_rule_sets: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ ...draftRow, status: 'archived' }),
        },
      });

      await expect(run(() => service.archiveRuleSet(5))).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.fiscal_rule_sets.update).not.toHaveBeenCalled();
    });
  });
});
