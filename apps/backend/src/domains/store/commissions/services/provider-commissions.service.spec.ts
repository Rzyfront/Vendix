import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProviderCommissionsService } from './provider-commissions.service';

/**
 * Tests del state machine de user_commissions (QUI-678).
 *
 * Cubre:
 *   - accrueForPayment idempotente
 *   - transitions válidas / inválidas
 *   - decline / markPaid / reopen con sus asserts
 *   - emisión de eventos en cada transition
 *
 * Se mockea StorePrismaService para no tocar DB.
 */
describe('ProviderCommissionsService — state machine', () => {
  let service: ProviderCommissionsService;
  let prisma: any;
  let eventEmitter: EventEmitter2;

  // Helper para crear un mock accrual
  const makeAccrual = (overrides: Partial<any> = {}) => ({
    id: 1,
    store_id: 10,
    organization_id: 1,
    employee_id: 5,
    provider_id: 2,
    booking_id: 100,
    order_id: 200,
    payment_id: 300,
    product_id: 7,
    base_amount: new (require('decimal.js') || globalThis).Decimal
      ? 0
      : 0,  // se setea abajo
    commission_pct: 20,
    commission_amount: 0,
    currency: 'COP',
    status: 'accrued',
    declined_reason: null,
    declined_at: null,
    declined_by_user_id: null,
    paid_at: null,
    paid_by_user_id: null,
    payment_reference: null,
    accounting_journal_id: null,
    notes: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      bookings: { findFirst: jest.fn() },
      products: { findUnique: jest.fn() },
      service_providers: { findUnique: jest.fn() },
      orders: { findUnique: jest.fn() },
      user_commissions: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
      },
      users: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderCommissionsService,
        { provide: 'StorePrismaService', useValue: prisma },
        EventEmitter2,
      ],
    }).compile();

    service = module.get(ProviderCommissionsService);
    eventEmitter = module.get(EventEmitter2);
    jest.spyOn(eventEmitter, 'emit');
  });

  // ─── State machine guards ─────────────────────────────────────────────

  describe('assertTransition (state machine)', () => {
    it('permite pending → accrued', () => {
      expect(() => (service as any).assertTransition('pending', 'accrued')).not.toThrow();
    });

    it('permite pending → reversed', () => {
      expect(() => (service as any).assertTransition('pending', 'reversed')).not.toThrow();
    });

    it('permite accrued → paid', () => {
      expect(() => (service as any).assertTransition('accrued', 'paid')).not.toThrow();
    });

    it('permite accrued → declined', () => {
      expect(() => (service as any).assertTransition('accrued', 'declined')).not.toThrow();
    });

    it('permite accrued → reversed', () => {
      expect(() => (service as any).assertTransition('accrued', 'reversed')).not.toThrow();
    });

    it('permite declined → accrued (reopen)', () => {
      expect(() => (service as any).assertTransition('declined', 'accrued')).not.toThrow();
    });

    it('rechaza paid → declined (líder dijo "no se puede declinar lo ya pagado")', () => {
      expect(() => (service as any).assertTransition('paid', 'declined')).toThrow(BadRequestException);
    });

    it('rechaza paid → reversed', () => {
      expect(() => (service as any).assertTransition('paid', 'reversed')).toThrow(BadRequestException);
    });

    it('rechaza reversed → cualquier otra', () => {
      expect(() => (service as any).assertTransition('reversed', 'accrued')).toThrow();
      expect(() => (service as any).assertTransition('reversed', 'paid')).toThrow();
    });
  });

  // ─── Accrual idempotencia ────────────────────────────────────────────

  describe('accrueForPayment — idempotencia', () => {
    it('retorna el accrual existente si ya hay uno para el booking', async () => {
      const existing = makeAccrual({ id: 99, status: 'accrued' });
      prisma.bookings.findFirst.mockResolvedValue({ id: 100, store_id: 10, product_id: 7, provider_id: 2, order_id: 200 });
      prisma.user_commissions.findUnique.mockResolvedValue(existing);

      const result = await service.accrueForPayment({
        payment_id: 300,
        order_id: 200,
        store_id: 10,
        organization_id: 1,
      });

      expect(result?.accrual_id).toBe(99);
      expect(prisma.user_commissions.create).not.toHaveBeenCalled();
    });

    it('retorna null si el producto no tiene owner_commission_pct', async () => {
      prisma.bookings.findFirst.mockResolvedValue({ id: 100, store_id: 10, product_id: 7, provider_id: 2, order_id: 200 });
      prisma.products.findUnique.mockResolvedValue({ id: 7, owner_commission_pct: null, base_price: 100 });
      prisma.service_providers.findUnique.mockResolvedValue({ id: 2, employee_id: 5 });

      const result = await service.accrueForPayment({
        payment_id: 300,
        order_id: 200,
        store_id: 10,
        organization_id: 1,
      });

      expect(result).toBeNull();
    });

    it('retorna null si no hay provider/empleado asignado (free_booking)', async () => {
      prisma.bookings.findFirst.mockResolvedValue({ id: 100, store_id: 10, product_id: 7, provider_id: null, order_id: 200 });
      prisma.products.findUnique.mockResolvedValue({ id: 7, owner_commission_pct: 20, base_price: 100 });
      prisma.service_providers.findUnique.mockResolvedValue(null);

      const result = await service.accrueForPayment({
        payment_id: 300,
        order_id: 200,
        store_id: 10,
        organization_id: 1,
      });

      expect(result).toBeNull();
    });

    it('crea el accrual cuando todo es válido y emite commission.accrued', async () => {
      prisma.bookings.findFirst.mockResolvedValue({ id: 100, store_id: 10, product_id: 7, provider_id: 2, order_id: 200 });
      prisma.products.findUnique.mockResolvedValue({ id: 7, owner_commission_pct: 20, base_price: 100 });
      prisma.service_providers.findUnique.mockResolvedValue({ id: 2, employee_id: 5 });
      prisma.orders.findUnique.mockResolvedValue({ subtotal_amount: 10000 });
      prisma.user_commissions.findUnique.mockResolvedValue(null);
      prisma.user_commissions.create.mockResolvedValue(makeAccrual({ id: 1, employee_id: 5, base_amount: 10000, commission_amount: 2000 }));

      const result = await service.accrueForPayment({
        payment_id: 300,
        order_id: 200,
        store_id: 10,
        organization_id: 1,
      });

      expect(result?.accrual_id).toBe(1);
      expect(result?.amount).toBe(2000);  // 20% de 10000
      expect(eventEmitter.emit).toHaveBeenCalledWith('commission.accrued', expect.objectContaining({
        accrual_id: 1,
        amount: 2000,
      }));
    });
  });

  // ─── Decline ──────────────────────────────────────────────────────────

  describe('decline', () => {
    it('rechaza reason vacío o muy corto', async () => {
      await expect(
        service.decline({ accrual_id: 1, reason: '', declined_by_user_id: 5 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.decline({ accrual_id: 1, reason: 'no', declined_by_user_id: 5 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza si el accrual no existe', async () => {
      prisma.user_commissions.findUnique.mockResolvedValue(null);
      await expect(
        service.decline({ accrual_id: 999, reason: 'cliente no pagó', declined_by_user_id: 5 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza transiciones inválidas (paid → declined)', async () => {
      prisma.user_commissions.findUnique.mockResolvedValue(makeAccrual({ status: 'paid' }));
      await expect(
        service.decline({ accrual_id: 1, reason: 'test', declined_by_user_id: 5 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('declina un accrual accrued correctamente', async () => {
      prisma.user_commissions.findUnique.mockResolvedValue(makeAccrual({ status: 'accrued' }));
      prisma.user_commissions.update.mockResolvedValue(makeAccrual({ status: 'declined' }));

      await service.decline({
        accrual_id: 1,
        reason: 'Cliente canceló sin pagar',
        declined_by_user_id: 5,
      });

      expect(eventEmitter.emit).toHaveBeenCalledWith('commission.declined', expect.objectContaining({
        accrual_id: 1,
        reason: 'Cliente canceló sin pagar',
      }));
    });
  });

  // ─── MarkPaid ────────────────────────────────────────────────────────

  describe('markPaid', () => {
    it('rechaza si el accrual no existe', async () => {
      prisma.user_commissions.findUnique.mockResolvedValue(null);
      await expect(
        service.markPaid({ accrual_id: 999, paid_by_user_id: 5 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza transición desde declined', async () => {
      prisma.user_commissions.findUnique.mockResolvedValue(makeAccrual({ status: 'declined' }));
      await expect(
        service.markPaid({ accrual_id: 1, paid_by_user_id: 5 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('marca como paid un accrual accrued y emite commission.paid', async () => {
      prisma.user_commissions.findUnique.mockResolvedValue(makeAccrual({ status: 'accrued' }));
      prisma.user_commissions.update.mockResolvedValue(makeAccrual({ status: 'paid' }));

      await service.markPaid({
        accrual_id: 1,
        paid_by_user_id: 5,
        payment_reference: 'TRF-12345',
      });

      expect(eventEmitter.emit).toHaveBeenCalledWith('commission.paid', expect.objectContaining({
        accrual_id: 1,
        payment_reference: 'TRF-12345',
      }));
    });
  });

  // ─── Reopen ──────────────────────────────────────────────────────────

  describe('reopen', () => {
    it('rechaza si no es declined (intenta reabrir un paid)', async () => {
      prisma.user_commissions.findUnique.mockResolvedValue(makeAccrual({ status: 'paid' }));
      await expect(
        service.reopen({ accrual_id: 1, user_id: 5 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('reabre un accrual declinado correctamente', async () => {
      prisma.user_commissions.findUnique.mockResolvedValue(makeAccrual({ status: 'declined' }));
      prisma.user_commissions.update.mockResolvedValue(makeAccrual({ status: 'accrued' }));

      await service.reopen({ accrual_id: 1, user_id: 5 });

      expect(eventEmitter.emit).toHaveBeenCalledWith('commission.accrued', expect.objectContaining({
        accrual_id: 1,
        reopened_by: 5,
      }));
    });
  });

  // ─── Reverse ─────────────────────────────────────────────────────────

  describe('reverseForBooking', () => {
    it('es idempotente: si no existe accrual, no hace nada', async () => {
      prisma.user_commissions.findUnique.mockResolvedValue(null);
      await service.reverseForBooking({ booking_id: 100, reason: 'cancelled' });
      expect(prisma.user_commissions.update).not.toHaveBeenCalled();
    });

    it('es idempotente: si ya está reversed, no hace nada', async () => {
      prisma.user_commissions.findUnique.mockResolvedValue(makeAccrual({ status: 'reversed' }));
      await service.reverseForBooking({ booking_id: 100, reason: 'cancelled' });
      expect(prisma.user_commissions.update).not.toHaveBeenCalled();
    });

    it('reversa un accrual accrued', async () => {
      prisma.user_commissions.findUnique.mockResolvedValue(makeAccrual({ status: 'accrued' }));
      prisma.user_commissions.update.mockResolvedValue(makeAccrual({ status: 'reversed' }));

      await service.reverseForBooking({ booking_id: 100, reason: 'cancelled' });

      expect(eventEmitter.emit).toHaveBeenCalledWith('commission.reversed', expect.objectContaining({
        accrual_id: 1,
        reason: 'cancelled',
      }));
    });
  });
});