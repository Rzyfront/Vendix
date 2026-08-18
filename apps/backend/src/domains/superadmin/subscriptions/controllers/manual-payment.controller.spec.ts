// @ts-nocheck — la rama dev arrastra desajustes de tipos en servicios
// importados transitivamente (GlobalPrismaService vs cliente Prisma generado).
// Los specs vecinos del dominio fallan igual; no lo introduce este cambio.
/// <reference types="jest" />
import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { ManualPaymentController } from './manual-payment.controller';
import { SubscriptionManualPaymentService } from '../../../store/subscriptions/services/subscription-manual-payment.service';
import { SubscriptionPaymentService } from '../../../store/subscriptions/services/subscription-payment.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { ROLES_KEY } from '../../../auth/decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { UserRole } from '../../../auth/enums/user-role.enum';

/**
 * `POST /superadmin/subscriptions/invoices/:id/sync-from-gateway` es la
 * herramienta manual de recuperación que faltó el 17/08/2026: un pago Wompi
 * APPROVED cuyo webhook se perdió y cuya factura fue anulada por cron no tenía
 * ninguna vía de rescate desde el panel; hubo que tocar la base a mano.
 */
describe('ManualPaymentController', () => {
  let controller: ManualPaymentController;
  let syncInvoiceFromGateway: jest.Mock;
  let recordManualPayment: jest.Mock;

  beforeEach(async () => {
    syncInvoiceFromGateway = jest.fn();
    recordManualPayment = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ManualPaymentController],
      providers: [
        {
          provide: SubscriptionManualPaymentService,
          useValue: { recordManualPayment },
        },
        {
          provide: SubscriptionPaymentService,
          useValue: { syncInvoiceFromGateway },
        },
        ResponseService,
      ],
    }).compile();

    controller = module.get(ManualPaymentController);
  });

  describe('autorización', () => {
    it('exige el rol de superadmin en toda la superficie del controlador', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, ManualPaymentController);
      expect(roles).toEqual([UserRole.SUPER_ADMIN]);
    });

    it('monta los guards de rol y permiso', () => {
      const guards = Reflect.getMetadata('__guards__', ManualPaymentController);
      expect(guards).toEqual(
        expect.arrayContaining([PermissionsGuard, RolesGuard]),
      );
    });

    it('declara un permiso de escritura existente en el seed sobre el sync', () => {
      const permisos = Reflect.getMetadata(
        PERMISSIONS_KEY,
        ManualPaymentController.prototype.syncInvoiceFromGateway,
      );
      expect(permisos).toEqual(['superadmin:subscriptions:update']);
    });
  });

  describe('syncInvoiceFromGateway', () => {
    it('delega en el servicio y devuelve el resultado tal cual', async () => {
      syncInvoiceFromGateway.mockResolvedValue({
        status: 'paid',
        transaction_id: 'wompi_txn_ever',
        payment_status: 'succeeded',
      });

      const res = await controller.syncInvoiceFromGateway(300);

      expect(syncInvoiceFromGateway).toHaveBeenCalledWith(300);
      expect(res.success).toBe(true);
      expect(res.message).toBe('Pago confirmado');
      expect(res.data).toEqual({
        status: 'paid',
        transaction_id: 'wompi_txn_ever',
        payment_status: 'succeeded',
      });
    });

    it('no interpreta el veredicto de la pasarela: pending sigue siendo pending', async () => {
      syncInvoiceFromGateway.mockResolvedValue({ status: 'pending' });

      const res = await controller.syncInvoiceFromGateway(301);

      expect(res.message).toBe('Pago aún pendiente');
      expect(res.data).toEqual({ status: 'pending' });
    });

    it('distingue sin transacción de pago rechazado', async () => {
      syncInvoiceFromGateway.mockResolvedValue({ status: 'no_transaction' });
      expect((await controller.syncInvoiceFromGateway(302)).message).toBe(
        'Sin transacción asociada',
      );

      syncInvoiceFromGateway.mockResolvedValue({ status: 'failed' });
      expect((await controller.syncInvoiceFromGateway(303)).message).toBe(
        'Pago rechazado',
      );
    });

    it('propaga el error del servicio en vez de tragárselo', async () => {
      const boom = new Error('SUBSCRIPTION_001');
      syncInvoiceFromGateway.mockRejectedValue(boom);

      await expect(controller.syncInvoiceFromGateway(404)).rejects.toThrow(
        boom,
      );
    });
  });

  describe('recordManualPayment', () => {
    it('convierte el DTO validado al contrato del servicio', async () => {
      await controller.recordManualPayment('300', {
        bank_reference: 'BANCOLOMBIA-4472819',
        paid_at: '2026-08-17T14:47:00.000Z',
        amount: 69900,
      } as any);

      expect(recordManualPayment).toHaveBeenCalledTimes(1);
      const [invoiceId, opts] = recordManualPayment.mock.calls[0];
      expect(invoiceId).toBe(300);
      expect(opts.bankReference).toBe('BANCOLOMBIA-4472819');
      expect(opts.paidAt.toISOString()).toBe('2026-08-17T14:47:00.000Z');
      expect(opts.amount.toString()).toBe('69900');
    });

    it('rechaza un id de factura que no es entero positivo', async () => {
      await expect(
        controller.recordManualPayment('abc', {
          bank_reference: 'X',
          paid_at: '2026-08-17T14:47:00.000Z',
          amount: 1,
        } as any),
      ).rejects.toBeDefined();
      expect(recordManualPayment).not.toHaveBeenCalled();
    });
  });
});
