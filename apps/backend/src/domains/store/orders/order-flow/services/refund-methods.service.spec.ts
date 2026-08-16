import { Test, TestingModule } from '@nestjs/testing';
import { RefundMethodsService } from './refund-methods.service';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';

/**
 * REFUND OVERHAUL — Cubre el nuevo contrato de `RefundMethodsService`
 * tras la eliminación del gate de caja registradora y del gate de
 * `bank_accounts`. Estos specs son la red de seguridad mínima para
 * impedir que el incidente vuelva a colarse:
 *
 *   - `cash` siempre disponible (independiente de `pos.cash_register`)
 *   - `bank_transfer` siempre disponible (incluso con 0 cuentas activas)
 *   - `original_payment` requiere al menos un pago registrado
 *   - `store_credit` requiere `customer_id`
 *   - El servicio NO consulta `store_settings` (regression guard)
 *
 * Si alguien re-introduce el gate de caja registradora (PR-576) o el
 * gate de cuentas bancarias (PR-576), estos specs fallan con diff
 * observable en la salida de jest.
 */
describe('RefundMethodsService — refund overhaul availability', () => {
  let service: RefundMethodsService;
  let mockPrisma: any;

  /**
   * Helper para localizar un método por `value` en el array `methods`.
   * Centraliza el assert de "este método específico" y mejora los
   * mensajes de error cuando un assert falla.
   */
  const findMethod = (methods: any[], value: string) => {
    const found = methods.find((m) => m.value === value);
    if (!found) {
      throw new Error(`Método '${value}' no encontrado en el resultado`);
    }
    return found;
  };

  beforeEach(async () => {
    // Mock de Prisma: solo lo que el servicio consulta. Intencionalmente
    // NO mockeamos `store_settings` — el servicio post-overhaul NO debe
    // leerlo nunca. Cualquier spy sobre `store_settings` que detecte
    // lecturas rompe el assert del regression guard.
    mockPrisma = {
      orders: { findFirst: jest.fn() },
      bank_accounts: { findMany: jest.fn() },
    };
    mockPrisma.bank_accounts.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundMethodsService,
        { provide: StorePrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(RefundMethodsService);
  });

  describe('cash — siempre disponible (sin gate de caja registradora)', () => {
    it('cash.available === true aunque la tienda no tenga caja configurada', async () => {
      // ARRANGE: orden con pagos y cliente. El refund de efectivo debe
      // poder elegirse siempre, independientemente de si el operador
      // configuró `pos.cash_register.enabled` o no. El chequeo real de
      // caja se delega a `RefundFlowService` al ejecutar el refund.
      mockPrisma.orders.findFirst.mockResolvedValue({
        id: 1,
        store_id: 10,
        customer_id: 5,
        payments: [{ id: 100, state: 'succeeded' }],
      });

      const result = await service.getAvailableMethods(1);

      // ACT + ASSERT
      const cash = findMethod(result.methods, 'cash');
      expect(cash.available).toBe(true);
      expect(cash.reason_unavailable).toBeUndefined();
    });
  });

  describe('bank_transfer — siempre disponible (incluso sin cuentas)', () => {
    it('bank_transfer.available === true y bank_accounts === [] cuando no hay cuentas activas', async () => {
      // ARRANGE: bank_accounts.findMany devuelve [] (sin cuentas activas
      // configuradas para la tienda). El refund por transferencia debe
      // seguir siendo elegible; el selector del modal simplemente se
      // renderiza vacío.
      mockPrisma.orders.findFirst.mockResolvedValue({
        id: 1,
        store_id: 10,
        customer_id: 5,
        payments: [{ id: 100, state: 'succeeded' }],
      });
      mockPrisma.bank_accounts.findMany.mockResolvedValue([]);

      const result = await service.getAvailableMethods(1);

      const bankTransfer = findMethod(result.methods, 'bank_transfer');
      expect(bankTransfer.available).toBe(true);
      expect(bankTransfer.reason_unavailable).toBeUndefined();

      // `bank_accounts` se devuelve como [] (selector vacío), no se omite.
      expect(result.bank_accounts).toEqual([]);
    });

    it('bank_transfer.available === true y bank_accounts poblado cuando hay cuentas activas', async () => {
      // Contraparte positiva: si hay cuentas, se devuelven mapeadas a
      // `{id, label}` con el formato esperado por el modal.
      mockPrisma.orders.findFirst.mockResolvedValue({
        id: 1,
        store_id: 10,
        customer_id: 5,
        payments: [{ id: 100, state: 'succeeded' }],
      });
      mockPrisma.bank_accounts.findMany.mockResolvedValue([
        {
          id: 7,
          name: 'Bancolombia Empresarial',
          account_number: '123-456789-00',
          bank_name: 'Bancolombia',
        },
      ]);

      const result = await service.getAvailableMethods(1);

      expect(findMethod(result.methods, 'bank_transfer').available).toBe(true);
      expect(result.bank_accounts).toEqual([
        {
          id: 7,
          label: 'Bancolombia Empresarial — Bancolombia (123-456789-00)',
        },
      ]);
    });
  });

  describe('original_payment — requiere al menos un pago registrado', () => {
    it('original_payment.available === true cuando la orden tiene pagos', async () => {
      // El tipo de pago (wompi/cash/etc) NO importa para disponibilidad a
      // nivel UI — basta con que la orden tenga al menos un pago activo.
      // El processor concreto lo valida `RefundFlowService` al ejecutar.
      mockPrisma.orders.findFirst.mockResolvedValue({
        id: 1,
        store_id: 10,
        customer_id: 5,
        payments: [{ id: 100, state: 'succeeded' }],
      });

      const result = await service.getAvailableMethods(1);

      const originalPayment = findMethod(result.methods, 'original_payment');
      expect(originalPayment.available).toBe(true);
      expect(originalPayment.reason_unavailable).toBeUndefined();
    });

    it('original_payment.available === false con razón cuando la orden NO tiene pagos', async () => {
      // Orden sin pagos: el refund por "pago original" no aplica. La
      // razón debe mencionar "pagos registrados" para guiar al operador
      // en el modal.
      mockPrisma.orders.findFirst.mockResolvedValue({
        id: 1,
        store_id: 10,
        customer_id: 5,
        payments: [],
      });

      const result = await service.getAvailableMethods(1);

      const originalPayment = findMethod(result.methods, 'original_payment');
      expect(originalPayment.available).toBe(false);
      expect(originalPayment.reason_unavailable).toBeDefined();
      expect(originalPayment.reason_unavailable).toMatch(/pagos registrados/i);
    });
  });

  describe('store_credit — requiere cliente en la orden', () => {
    it('store_credit.available === true cuando la orden tiene cliente', async () => {
      mockPrisma.orders.findFirst.mockResolvedValue({
        id: 1,
        store_id: 10,
        customer_id: 5,
        payments: [{ id: 100, state: 'succeeded' }],
      });

      const result = await service.getAvailableMethods(1);

      const storeCredit = findMethod(result.methods, 'store_credit');
      expect(storeCredit.available).toBe(true);
      expect(storeCredit.reason_unavailable).toBeUndefined();
    });

    it('store_credit.available === false con razón cuando la orden NO tiene cliente', async () => {
      // Sin cliente no hay billetera destino para el saldo a favor.
      mockPrisma.orders.findFirst.mockResolvedValue({
        id: 1,
        store_id: 10,
        customer_id: null,
        payments: [{ id: 100, state: 'succeeded' }],
      });

      const result = await service.getAvailableMethods(1);

      const storeCredit = findMethod(result.methods, 'store_credit');
      expect(storeCredit.available).toBe(false);
      expect(storeCredit.reason_unavailable).toBeDefined();
      expect(storeCredit.reason_unavailable).toMatch(/cliente/i);
    });
  });

  describe('order not found — todos los métodos bloqueados', () => {
    it('original_payment, cash y bank_transfer devuelven disabled con razón "Order not found"', async () => {
      // Cuando la orden no existe, los 3 métodos que dependen del
      // contexto de la orden (pagos, caja, cuentas) deben venir disabled.
      // store_credit NO depende de la orden (su gate es solo el cliente)
      // y se mantiene enabled por diseño actual del servicio.
      mockPrisma.orders.findFirst.mockResolvedValue(null);

      const result = await service.getAvailableMethods(99999);

      // Verificamos los 3 que SÍ deben estar disabled.
      const originalPayment = findMethod(result.methods, 'original_payment');
      expect(originalPayment.available).toBe(false);
      expect(originalPayment.reason_unavailable).toMatch(/order not found/i);

      const cash = findMethod(result.methods, 'cash');
      expect(cash.available).toBe(false);
      expect(cash.reason_unavailable).toMatch(/order not found/i);

      const bankTransfer = findMethod(result.methods, 'bank_transfer');
      expect(bankTransfer.available).toBe(false);
      expect(bankTransfer.reason_unavailable).toMatch(/order not found/i);

      // bank_accounts se devuelve [] — sin orden no hay store_id para
      // filtrar cuentas.
      expect(result.bank_accounts).toEqual([]);
    });
  });

  describe('regression guard — el servicio NO consulta store_settings', () => {
    it('getAvailableMethods nunca lee store_settings', async () => {
      // REFUND OVERHAUL: el gate de caja registradora leía
      // `store_settings.settings.pos.cash_register.enabled`. Ese gate fue
      // eliminado porque dejaba a la tienda muda en producción. Este
      // assert protege contra re-introducción accidental.
      //
      // Setup: mockeamos `mockPrisma.store_settings` como spy. Si el
      // servicio lo invoca, el spy lo registra. Mockeamos la orden
      // para que el flujo recorra todos los gates.
      const storeSettingsSpy = jest.fn();
      mockPrisma.store_settings = { findFirst: storeSettingsSpy };

      mockPrisma.orders.findFirst.mockResolvedValue({
        id: 1,
        store_id: 10,
        customer_id: 5,
        payments: [{ id: 100, state: 'succeeded' }],
      });

      await service.getAvailableMethods(1);

      // El servicio solo debe consultar `orders.findFirst` y
      // `bank_accounts.findMany`. Cualquier lectura de `store_settings`
      // rompe este assert.
      expect(storeSettingsSpy).not.toHaveBeenCalled();
    });
  });
});