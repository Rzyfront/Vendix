import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { RequestContext, RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ServiceBudgetsService, staffChangeNeedsCustomerProposal } from './service-budgets.service';
import { buildProposalSnapshotHash } from './utils/service-proposal-snapshot.util';

describe('staffChangeNeedsCustomerProposal', () => {
  const dec = (value: number) => new Prisma.Decimal(value);

  it('no exige propuesta sin límite previo, con límite del sistema o sin aprobación', () => {
    expect(staffChangeNeedsCustomerProposal(null, dec(100))).toBe(false);
    expect(
      staffChangeNeedsCustomerProposal({ amount: dec(50), approved_at: new Date(), is_system: true }, dec(100)),
    ).toBe(false);
    expect(
      staffChangeNeedsCustomerProposal({ amount: dec(50), approved_at: null, is_system: false }, dec(100)),
    ).toBe(false);
  });

  it('exige propuesta solo para subir un límite aprobado por el cliente', () => {
    const approved = { amount: dec(50), approved_at: new Date(), is_system: false };
    expect(staffChangeNeedsCustomerProposal(approved, dec(100))).toBe(true);
    expect(staffChangeNeedsCustomerProposal(approved, dec(50))).toBe(false);
    expect(staffChangeNeedsCustomerProposal(approved, dec(10))).toBe(false);
  });
});

describe('ServiceBudgetsService', () => {
  const context: RequestContext = { store_id: 1, is_super_admin: false, is_owner: false };
  let service: ServiceBudgetsService;
  let prisma: Record<string, any>;
  let tx: Record<string, any>;
  let notifications: { push: jest.Mock };

  const session = { id: 7, store_id: 1, order_id: 33, status: 'open' };

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 33, state: 'draft' }]),
      orders: { findFirst: jest.fn(), update: jest.fn() },
      payments: { findFirst: jest.fn() },
      products: { findFirst: jest.fn() },
      service_budgets: { findFirst: jest.fn(), create: jest.fn() },
      service_change_proposals: { findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
      service_proposal_decisions: { create: jest.fn(), findFirst: jest.fn() },
      service_progress_events: { create: jest.fn() },
      order_items: { create: jest.fn() },
      stores: { findUnique: jest.fn() },
      stock_levels: { findFirst: jest.fn(), update: jest.fn() },
      stock_reservations: { create: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn((fn: any) => fn(tx)),
      service_sessions: { findFirst: jest.fn().mockResolvedValue(session) },
      service_budgets: { findFirst: jest.fn() },
      service_change_proposals: { findMany: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
      service_proposal_decisions: { findMany: jest.fn() },
      service_session_tokens: { findFirst: jest.fn() },
      products: { findMany: jest.fn().mockResolvedValue([]) },
      product_variants: { findFirst: jest.fn() },
      product_tax_assignments: { findMany: jest.fn().mockResolvedValue([]) },
    };
    notifications = { push: jest.fn() };
    service = new ServiceBudgetsService(prisma as unknown as StorePrismaService, notifications as any);
  });

  const run = <T>(fn: () => Promise<T>) => RequestContextService.runIsolated(context, fn);

  describe('setBudget', () => {
    const dto = { amount: 50000, currency: 'COP' };

    beforeEach(() => {
      tx.payments.findFirst.mockResolvedValue(null);
      tx.orders.findFirst.mockResolvedValue({
        grand_total: new Prisma.Decimal(40000),
        tip_amount: new Prisma.Decimal(0),
        currency: 'COP',
      });
      tx.service_budgets.findFirst.mockResolvedValue(null);
      tx.service_budgets.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data }));
    });

    it('crea la versión siguiente sin marcar aprobación del cliente', async () => {
      tx.service_budgets.findFirst.mockResolvedValue({ version: 2 });
      const result = await run(() => service.setBudget(7, dto));
      expect(tx.service_budgets.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ version: 3, approved_at: null, currency: 'COP' }),
      });
      expect(result).toMatchObject({ version: 3 });
    });

    it('rechaza expectedVersion obsoleto', async () => {
      tx.service_budgets.findFirst.mockResolvedValue({ version: 2 });
      await expect(run(() => service.setBudget(7, { ...dto, expectedVersion: 1 }))).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tx.service_budgets.create).not.toHaveBeenCalled();
    });

    it('el staff no sube un límite aprobado por el cliente (SERVICE_BUDGET_001)', async () => {
      tx.service_budgets.findFirst.mockResolvedValue({
        version: 1,
        amount: new Prisma.Decimal(40000),
        approved_at: new Date(),
        is_system: false,
      });
      await expect(run(() => service.setBudget(7, dto))).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'SERVICE_BUDGET_001' }),
      });
      expect(tx.service_budgets.create).not.toHaveBeenCalled();
    });

    it('bloquea el cambio con un pago pendiente', async () => {
      tx.payments.findFirst.mockResolvedValue({ id: 9 });
      await expect(run(() => service.setBudget(7, dto))).rejects.toBeInstanceOf(ConflictException);
      expect(tx.service_budgets.create).not.toHaveBeenCalled();
    });

    it('exige la moneda de la orden y un límite sobre su total (SERVICE_BUDGET_001)', async () => {
      await expect(run(() => service.setBudget(7, { ...dto, currency: 'USD' }))).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'SERVICE_BUDGET_001' }),
      });
      await expect(run(() => service.setBudget(7, { ...dto, amount: 10000 }))).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'SERVICE_BUDGET_001' }),
      });
      expect(tx.service_budgets.create).not.toHaveBeenCalled();
    });
  });

  describe('createProposal', () => {
    const dto = {
      items: [{ quantity: 2, unit_price: 10000, tax_rate: 19, product_name: 'Pastillas' }],
    };

    beforeEach(() => {
      tx.orders.findFirst.mockResolvedValue({ service_version: 4, currency: 'COP' });
      tx.service_budgets.findFirst.mockResolvedValue({
        version: 2,
        amount: new Prisma.Decimal(40000),
        currency: 'COP',
      });
      tx.service_change_proposals.findFirst.mockImplementation((args: any) =>
        Promise.resolve(args?.where?.status === 'pending' ? null : { version: 1 }),
      );
      tx.service_change_proposals.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 11, ...data }),
      );
    });

    it('crea la propuesta versionada con snapshot firmable y evento público', async () => {
      const result = await run(() => service.createProposal(7, dto));
      expect(tx.service_change_proposals.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          store_id: 1,
          session_id: 7,
          version: 2,
          order_version: 4,
          currency: 'COP',
          status: 'pending',
          snapshot_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      });
      const stored = tx.service_change_proposals.create.mock.calls[0][0].data;
      expect(stored.lines).toMatchObject({
        items: [expect.objectContaining({ quantity: 2, unit_price: 10000, total: 23800 })],
        budget_snapshot: { version: 2 },
      });
      expect(stored.subtotal.toFixed(2)).toBe('20000.00');
      expect(stored.tax.toFixed(2)).toBe('3800.00');
      expect(stored.total.toFixed(2)).toBe('23800.00');
      expect(tx.service_progress_events.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ event_type: 'proposal_submitted' }),
      });
      expect(notifications.push).toHaveBeenCalledWith(1, expect.objectContaining({ title: 'Propuesta enviada' }));
      expect(result).toMatchObject({ id: 11, version: 2 });
    });

    it('rechaza sesión cerrada, sin orden, con pendiente o con producto ajeno', async () => {
      prisma.service_sessions.findFirst.mockResolvedValueOnce({ ...session, status: 'closed' });
      await expect(run(() => service.createProposal(7, dto))).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'STATION_006' }),
      });
      prisma.service_sessions.findFirst.mockResolvedValueOnce({ ...session, order_id: null });
      await expect(run(() => service.createProposal(7, dto))).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'SERVICE_BUDGET_002' }),
      });
      tx.service_change_proposals.findFirst.mockImplementation((args: any) =>
        Promise.resolve(args?.where?.status === 'pending' ? { id: 5 } : { version: 1 }),
      );
      await expect(run(() => service.createProposal(7, dto))).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'SERVICE_BUDGET_002' }),
      });
      expect(tx.service_change_proposals.create).not.toHaveBeenCalled();
    });

    it('valida productos, descuento y vencimiento antes de escribir', async () => {
      prisma.products.findMany.mockResolvedValueOnce([{ id: 1 }]);
      await expect(
        run(() => service.createProposal(7, { items: [{ quantity: 1, unit_price: 5, product_id: 2 }] })),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(run(() => service.createProposal(7, { ...dto, discount: 999999 }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        run(() => service.createProposal(7, { ...dto, expires_at: new Date(Date.now() - 1000).toISOString() })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.service_change_proposals.create).not.toHaveBeenCalled();
    });

    describe('compuerta de precio en líneas con producto (misma que addItems/POS)', () => {
      const product = {
        id: 2,
        name: 'Aceite',
        base_price: new Prisma.Decimal(10000),
        is_on_sale: false,
        sale_price: null,
        allow_pos_price_override: false,
      };
      const iva19 = [
        {
          product_id: 2,
          is_inclusive: false,
          tax_categories: {
            tax_type: 'IVA',
            tax_rates: [{ id: 1, name: 'IVA', rate: 0.19, is_inclusive: false }],
          },
        },
      ];

      beforeEach(() => {
        prisma.products.findMany.mockResolvedValue([product]);
        prisma.product_tax_assignments.findMany.mockResolvedValue(iva19);
      });

      it('acepta el precio de catálogo y resuelve el IVA en el servidor (ignora el tax_rate del DTO)', async () => {
        await run(() =>
          service.createProposal(7, {
            items: [{ quantity: 2, unit_price: 10000, tax_rate: 5, product_id: 2, product_name: 'Aceite' }],
          }),
        );
        const stored = tx.service_change_proposals.create.mock.calls[0][0].data;
        expect(stored.lines).toMatchObject({
          items: [
            expect.objectContaining({
              product_id: 2,
              quantity: 2,
              unit_price: 10000,
              tax_rate: 0.19,
              tax_amount_item: 1900,
              total_price: 20000,
              total: 23800,
            }),
          ],
        });
        expect(stored.subtotal.toFixed(2)).toBe('20000.00');
        expect(stored.tax.toFixed(2)).toBe('3800.00');
        expect(stored.total.toFixed(2)).toBe('23800.00');
      });

      it('rechaza precio distinto si el producto no permite override (POS_PRICE_OVERRIDE_NOT_ALLOWED_001)', async () => {
        await expect(
          run(() => service.createProposal(7, { items: [{ quantity: 1, unit_price: 1, product_id: 2 }] })),
        ).rejects.toMatchObject({
          response: expect.objectContaining({ error_code: 'POS_PRICE_OVERRIDE_NOT_ALLOWED_001' }),
        });
        expect(tx.service_change_proposals.create).not.toHaveBeenCalled();
      });

      it('rechaza precio distinto sin el permiso store:pos:price_override (AUTH_PERM_001)', async () => {
        prisma.products.findMany.mockResolvedValue([{ ...product, allow_pos_price_override: true }]);
        await expect(
          run(() => service.createProposal(7, { items: [{ quantity: 1, unit_price: 1, product_id: 2 }] })),
        ).rejects.toMatchObject({
          response: expect.objectContaining({ error_code: 'AUTH_PERM_001' }),
        });
        expect(tx.service_change_proposals.create).not.toHaveBeenCalled();
      });

      it('acepta precio distinto con flag + permiso, despejando el impuesto del precio publicado', async () => {
        prisma.products.findMany.mockResolvedValue([{ ...product, allow_pos_price_override: true }]);
        await RequestContextService.runIsolated({ ...context, permissions: ['store:pos:price_override'] }, () =>
          service.createProposal(7, { items: [{ quantity: 2, unit_price: 12000, product_id: 2 }] }),
        );
        const stored = tx.service_change_proposals.create.mock.calls[0][0].data;
        expect(stored.lines).toMatchObject({
          items: [
            expect.objectContaining({
              unit_price: 12000,
              tax_rate: 0.19,
              tax_amount_item: 2280,
              total_price: 24000,
              total: 28560,
            }),
          ],
        });
        expect(stored.total.toFixed(2)).toBe('28560.00');
      });
    });
  });

  describe('decideWithToken', () => {
    const token = 'a'.repeat(43);
    const proposal = {
      id: 11,
      version: 2,
      order_version: 4,
      snapshot_hash: 'b'.repeat(64),
      lines: { items: [], budget_snapshot: { version: 2 } },
      subtotal: new Prisma.Decimal(20000),
      tax: new Prisma.Decimal(3800),
      discount: new Prisma.Decimal(0),
      currency: 'COP',
      total: new Prisma.Decimal(23800),
      status: 'pending',
      expires_at: new Date(Date.now() + 3600_000),
    };

    beforeEach(() => {
      prisma.service_session_tokens.findFirst.mockResolvedValue({ id: 3, session_id: 7 });
      prisma.service_change_proposals.findFirst.mockResolvedValue(proposal);
      tx.orders.findFirst.mockResolvedValue({ service_version: 4, currency: 'COP' });
      tx.service_budgets.findFirst.mockResolvedValue({ version: 2 });
      tx.service_change_proposals.updateMany.mockResolvedValue({ count: 1 });
      tx.service_change_proposals.findFirst.mockResolvedValue({ ...proposal, status: 'approved' });
      tx.service_proposal_decisions.findFirst.mockResolvedValue({ id: 1, decision: 'approved' });
    });

    const decideDto = { decision: 'approved' as const, proposal_version: 2, snapshot_hash: 'b'.repeat(64) };

    it('aprueba: aplica líneas, crea presupuesto aprobado y registra la decisión', async () => {
      const result = await run(() => service.decideWithToken(token, decideDto));
      expect(tx.service_budgets.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ version: 3, currency: 'COP', approved_at: expect.any(Date) }),
      });
      expect(tx.service_proposal_decisions.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ decision: 'approved', actor_type: 'customer' }),
      });
      expect(tx.orders.update).toHaveBeenCalledWith({
        where: { id: 33 },
        data: expect.objectContaining({ grand_total: proposal.total }),
      });
      expect(notifications.push).toHaveBeenCalled();
      expect(result).toMatchObject({ status: 'approved' });
    });

    it('rechaza token inválido, propuesta ausente, hash distinto o vencida (003/004)', async () => {
      await expect(run(() => service.decideWithToken('corto', decideDto))).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'SERVICE_BUDGET_003' }),
      });
      prisma.service_change_proposals.findFirst.mockResolvedValueOnce(null);
      await expect(run(() => service.decideWithToken(token, decideDto))).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'SERVICE_BUDGET_003' }),
      });
      await expect(
        run(() => service.decideWithToken(token, { ...decideDto, snapshot_hash: 'c'.repeat(64) })),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'SERVICE_BUDGET_004' }),
      });
      prisma.service_change_proposals.findFirst.mockResolvedValueOnce({
        ...proposal,
        expires_at: new Date(Date.now() - 1000),
      });
      await expect(run(() => service.decideWithToken(token, decideDto))).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'SERVICE_BUDGET_003' }),
      });
      expect(tx.service_proposal_decisions.create).not.toHaveBeenCalled();
    });

    it('marca obsoleta si la orden o el presupuesto cambiaron, y no doble-decide (002)', async () => {
      tx.orders.findFirst.mockResolvedValueOnce({ service_version: 5, currency: 'COP' });
      await expect(run(() => service.decideWithToken(token, decideDto))).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'SERVICE_BUDGET_002' }),
      });
      tx.service_budgets.findFirst.mockResolvedValueOnce({ version: 3 });
      await expect(run(() => service.decideWithToken(token, decideDto))).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'SERVICE_BUDGET_002' }),
      });
      tx.service_change_proposals.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(run(() => service.decideWithToken(token, decideDto))).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'SERVICE_BUDGET_002' }),
      });
      expect(tx.service_proposal_decisions.create).not.toHaveBeenCalled();
    });

    it('usa el hash sha256 del token para resolver la sesión', async () => {
      await run(() => service.decideWithToken(token, decideDto));
      expect(prisma.service_session_tokens.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          token_hash: createHash('sha256').update(token).digest('hex'),
        }),
        select: { id: true, session_id: true },
      });
    });
  });
});

describe('buildProposalSnapshotHash', () => {
  const input = {
    items: [{ quantity: 2, unit_price: 10000, total: 23800 }],
    subtotal: '20000.00',
    tax: '3800.00',
    discount: '0.00',
    currency: 'COP',
    total: '23800.00',
    expires_at: '2026-10-27T00:00:00.000Z',
    budget_snapshot: { version: 2, amount: '40000.00', currency: 'COP' },
  };

  it('es determinista, 64 hex y sensible al total (contrato con verifyProposalSnapshot)', () => {
    const first = buildProposalSnapshotHash(input);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(buildProposalSnapshotHash(input)).toBe(first);
    expect(buildProposalSnapshotHash({ ...input, total: '23800.01' })).not.toBe(first);
  });
});
