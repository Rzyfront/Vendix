import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  createPaymentTools,
  PaymentToolDeps,
} from './payments.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Track B paso 5 — contrato O-30 / O-31 / O-32 (POS y pagos).
 *
 * Patrón canónico T4: (a) happy/sad, (b) snapshot de salida, (c) forma
 * `{error, next_step}`, (d) permiso declarado, (e) requiresConfirmation +
 * preview con sujeto humano en writes, con re-verificación en el handler.
 */
describe('payments.tools · O-30 create_pos_payment / O-31 get_payment_status / O-32 refund_payment', () => {
  const CONTEXT = { store_id: 7, organization_id: 3, user_id: 11, roles: [] };

  function buildTools(overrides: {
    paymentsService?: Record<string, any>;
    storePaymentMethodsService?: Record<string, any>;
  } = {}) {
    const deps = {
      paymentsService: {
        getPaymentStatus: jest.fn(),
        processPayment: jest.fn(),
        processPaymentWithOrder: jest.fn(),
        refundPayment: jest.fn(),
        ...overrides.paymentsService,
      } as any,
      storePaymentMethodsService: {
        findOne: jest.fn(),
        ...overrides.storePaymentMethodsService,
      } as any,
    } satisfies PaymentToolDeps;
    return { deps, tools: createPaymentTools(deps) };
  }

  function getTool(tools: RegisteredTool[], name: string): RegisteredTool {
    const tool = tools.find((t) => t.name === name);
    if (!tool?.handler) throw new Error(`${name} sin handler`);
    return tool;
  }

  const CASH_METHOD = {
    id: 5,
    name: 'Efectivo caja 1',
    system_payment_method: { name: 'Efectivo', type: 'cash' },
  };

  describe('contrato de familia', () => {
    it('declara version 1 y permiso store:pos:access en las tres', () => {
      const { tools } = buildTools();
      for (const name of [
        'get_payment_status',
        'create_pos_payment',
        'refund_payment',
      ]) {
        const tool = getTool(tools, name);
        expect(tool.version).toBe('1');
        expect(tool.requiredPermissions).toEqual(['store:pos:access']);
      }
    });

    it('el read es readOnly y los writes exigen confirmación con preview', () => {
      const { tools } = buildTools();
      const read = getTool(tools, 'get_payment_status');
      expect(read.readOnly).toBe(true);
      expect(read.requiresConfirmation).toBeUndefined();

      for (const name of ['create_pos_payment', 'refund_payment']) {
        const write = getTool(tools, name);
        expect(write.requiresConfirmation).toBe(true);
        expect(typeof write.preview).toBe('function');
      }
    });
  });

  describe('get_payment_status (O-31, read habilitante)', () => {
    it('happy: compacta estado, monto y reembolsabilidad', async () => {
      const { tools } = buildTools({
        paymentsService: {
          getPaymentStatus: jest.fn().mockResolvedValue({
            success: true,
            data: {
              status: 'succeeded',
              transactionId: 'TX-100',
              amount: 85000,
              paidAt: '2026-09-20T10:00:00.000Z',
            },
          }),
        },
      });
      const tool = getTool(tools, 'get_payment_status');
      const answer = JSON.parse(
        await tool.handler!({ payment_id: 'TX-100' }, CONTEXT),
      );

      expect(answer).toEqual({
        payment_id: 'TX-100',
        estado: 'succeeded',
        monto: 85000,
        transaction_id: 'TX-100',
        pagado_en: '2026-09-20T10:00:00.000Z',
        reembolsable: true,
      });
    });

    it('happy: un pago reembolsado viaja como no reembolsable', async () => {
      const { tools } = buildTools({
        paymentsService: {
          getPaymentStatus: jest.fn().mockResolvedValue({
            success: true,
            data: { status: 'refunded', transactionId: 'TX-9' },
          }),
        },
      });
      const tool = getTool(tools, 'get_payment_status');
      const answer = JSON.parse(
        await tool.handler!({ payment_id: 'TX-9' }, CONTEXT),
      );

      expect(answer.reembolsable).toBe(false);
    });

    it('sad: pago inexistente responde {error, next_step}', async () => {
      const { tools, deps } = buildTools({
        paymentsService: {
          getPaymentStatus: jest
            .fn()
            .mockRejectedValue(
              new VendixHttpException(ErrorCodes.PAY_FIND_001),
            ),
        },
      });
      const tool = getTool(tools, 'get_payment_status');
      const answer = JSON.parse(
        await tool.handler!({ payment_id: 'TX-404' }, CONTEXT),
      );

      expect(answer.error).toMatch(/TX-404/);
      expect(answer.next_step).toMatch(/transaction_id/);
      // El user se reconstruye desde el contexto del turno.
      expect(deps.paymentsService.getPaymentStatus).toHaveBeenCalledWith(
        'TX-404',
        { id: 11, store_id: 7, organization_id: 3, roles: [] },
      );
    });

    it('sad: payment_id vacío no llama al servicio', async () => {
      const { tools, deps } = buildTools();
      const tool = getTool(tools, 'get_payment_status');
      const answer = JSON.parse(
        await tool.handler!({ payment_id: '  ' }, CONTEXT),
      );

      expect(answer.error).toMatch(/vacío/);
      expect(deps.paymentsService.getPaymentStatus).not.toHaveBeenCalled();
    });
  });

  describe('create_pos_payment (O-30)', () => {
    const EXISTING_ARGS = {
      mode: 'existing_order',
      order_id: 412,
      amount: 85000,
      store_payment_method_id: 5,
    };

    it('preview existing_order nombra orden, monto y medio humano', async () => {
      const { tools } = buildTools({
        storePaymentMethodsService: {
          findOne: jest.fn().mockResolvedValue(CASH_METHOD),
        },
      });
      const tool = getTool(tools, 'create_pos_payment');
      const preview = await tool.preview!(EXISTING_ARGS, CONTEXT);

      expect(preview).toEqual({
        status: 'warning',
        target: 'Cobro $85000 — orden #412 vía Efectivo',
        changes: [
          { field: 'order', label: 'Orden', from: null, to: '#412' },
          { field: 'amount', label: 'Monto', from: null, to: '$85000 COP' },
          { field: 'method', label: 'Medio', from: null, to: 'Efectivo' },
        ],
        message:
          'El servidor valida el monto contra el saldo de la orden (compuerta anti-sobrepago) y bloquea sin stock salvo sobreventa explícita.',
        domain: 'payments',
      });
      expect(preview.status).toBe('warning');
      expect(preview.target).toBe('Cobro $85000 — orden #412 vía Efectivo');
      expect(preview.domain).toBe('payments');
    });

    it('preview new_order nombra cliente e items', async () => {
      const { tools } = buildTools({
        storePaymentMethodsService: {
          findOne: jest.fn().mockResolvedValue(CASH_METHOD),
        },
      });
      const tool = getTool(tools, 'create_pos_payment');
      const preview = await tool.preview!(
        {
          mode: 'new_order',
          amount: 12000,
          store_payment_method_id: 5,
          customer_email: 'luis@correo.co',
          customer_name: 'Luis Pérez',
          items: [
            {
              product_id: 9,
              product_name: 'Café 500g',
              quantity: 2,
              unit_price: 6000,
              total_price: 12000,
            },
          ],
        },
        CONTEXT,
      );

      expect(preview.status).toBe('warning');
      expect(preview.target).toMatch(/Luis Pérez/);
      expect(preview.target).toMatch(/Efectivo/);
      expect(JSON.stringify(preview.changes)).toMatch(/Café 500g x2/);
    });

    it('preview con medio inexistente aborta sin acuñar token', async () => {
      const { tools } = buildTools({
        storePaymentMethodsService: {
          findOne: jest.fn().mockRejectedValue(new Error('not found')),
        },
      });
      const tool = getTool(tools, 'create_pos_payment');
      const preview = await tool.preview!(EXISTING_ARGS, CONTEXT);

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/medio de pago 5/);
    });

    it('handler existing_order valida DTO real y delega en processPayment', async () => {
      const { tools, deps } = buildTools({
        paymentsService: {
          processPayment: jest
            .fn()
            .mockResolvedValue({ success: true, data: { id: 1 } }),
        },
        storePaymentMethodsService: {
          findOne: jest.fn().mockResolvedValue(CASH_METHOD),
        },
      });
      const tool = getTool(tools, 'create_pos_payment');
      const answer = JSON.parse(
        await tool.handler!(EXISTING_ARGS, CONTEXT),
      );

      expect(answer.resumen).toMatch(/orden #412/);
      expect(answer.medio).toBe('Efectivo');
      expect(deps.paymentsService.processPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 412,
          amount: 85000,
          currency: 'COP',
          storePaymentMethodId: 5,
          storeId: 7,
        }),
        expect.objectContaining({ id: 11 }),
      );
    });

    it('handler new_order crea+cobra vía processPaymentWithOrder', async () => {
      const { tools, deps } = buildTools({
        paymentsService: {
          processPaymentWithOrder: jest
            .fn()
            .mockResolvedValue({ success: true, data: { id: 2 } }),
        },
        storePaymentMethodsService: {
          findOne: jest.fn().mockResolvedValue(CASH_METHOD),
        },
      });
      const tool = getTool(tools, 'create_pos_payment');
      const answer = JSON.parse(
        await tool.handler!(
          {
            mode: 'new_order',
            amount: 12000,
            store_payment_method_id: 5,
            customer_email: 'luis@correo.co',
            customer_name: 'Luis Pérez',
            items: [
              {
                product_id: 9,
                product_name: 'Café 500g',
                quantity: 2,
                unit_price: 6000,
                total_price: 12000,
              },
            ],
          },
          CONTEXT,
        ),
      );

      expect(answer.resumen).toMatch(/Luis Pérez/);
      expect(
        deps.paymentsService.processPaymentWithOrder,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          customerEmail: 'luis@correo.co',
          storeId: 7,
        }),
        expect.objectContaining({ id: 11 }),
      );
    });

    it('handler re-verifica el medio: si se deshabilitó, no cobra', async () => {
      const { tools, deps } = buildTools({
        storePaymentMethodsService: {
          findOne: jest.fn().mockRejectedValue(new Error('disabled')),
        },
      });
      const tool = getTool(tools, 'create_pos_payment');
      const answer = JSON.parse(
        await tool.handler!(EXISTING_ARGS, CONTEXT),
      );

      expect(answer.error).toMatch(/ya no está habilitado/);
      expect(deps.paymentsService.processPayment).not.toHaveBeenCalled();
    });

    it('handler traduce el fallo del dominio a {error, next_step}', async () => {
      const { tools } = buildTools({
        paymentsService: {
          processPayment: jest
            .fn()
            .mockRejectedValue(new Error('Monto excede el saldo')),
        },
        storePaymentMethodsService: {
          findOne: jest.fn().mockResolvedValue(CASH_METHOD),
        },
      });
      const tool = getTool(tools, 'create_pos_payment');
      const answer = JSON.parse(
        await tool.handler!(EXISTING_ARGS, CONTEXT),
      );

      expect(answer.error).toMatch(/Monto excede/);
      expect(answer.next_step).toMatch(/saldo/);
    });
  });

  describe('refund_payment (O-32)', () => {
    const STATUS = {
      success: true,
      data: { status: 'succeeded', transactionId: 'TX-100', amount: 85000 },
    };

    it('preview cita cobertura y destino (total vs parcial)', async () => {
      const { tools } = buildTools({
        paymentsService: {
          getPaymentStatus: jest.fn().mockResolvedValue(STATUS),
        },
      });
      const tool = getTool(tools, 'refund_payment');
      const preview = await tool.preview!(
        { payment_id: 'TX-100', amount: 20000 },
        CONTEXT,
      );

      expect(preview).toEqual({
        status: 'warning',
        target: 'Reembolso de pago TX-100 ($85000)',
        changes: [
          {
            field: 'payment_status',
            label: 'Estado del pago',
            from: 'succeeded',
            to: 'partially_refunded',
          },
          {
            field: 'amount',
            label: 'Monto a reembolsar',
            from: null,
            to: '$20000',
          },
        ],
        message:
          'Mueve dinero de vuelta al cliente. No toca el estado de la orden: si hay que devolver la orden completa, usa refund_order.',
        domain: 'payments',
      });
      expect(preview.status).toBe('warning');
      expect(preview.target).toBe('Reembolso de pago TX-100 ($85000)');
      expect(preview.changes).toContainEqual(
        expect.objectContaining({ to: 'partially_refunded' }),
      );
    });

    it('preview sobre pago ya reembolsado aborta sin token', async () => {
      const { tools } = buildTools({
        paymentsService: {
          getPaymentStatus: jest.fn().mockResolvedValue({
            success: true,
            data: { status: 'refunded', transactionId: 'TX-9' },
          }),
        },
      });
      const tool = getTool(tools, 'refund_payment');
      const preview = await tool.preview!({ payment_id: 'TX-9' }, CONTEXT);

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/refunded/);
    });

    it('handler re-verifica el estado antes de reembolsar', async () => {
      const getPaymentStatus = jest
        .fn()
        .mockResolvedValueOnce(STATUS) // preview implícito del flujo
        .mockResolvedValueOnce({
          success: true,
          data: { status: 'refunded', transactionId: 'TX-100' },
        });
      const refundPayment = jest.fn();
      const { tools } = buildTools({
        paymentsService: { getPaymentStatus, refundPayment },
      });
      const tool = getTool(tools, 'refund_payment');

      // El mundo se movió entre el preview y el apply: otro operador reembolsó.
      await tool.preview!({ payment_id: 'TX-100' }, CONTEXT);
      const answer = JSON.parse(
        await tool.handler!({ payment_id: 'TX-100' }, CONTEXT),
      );

      expect(answer.error).toMatch(/ya está en/);
      expect(refundPayment).not.toHaveBeenCalled();
    });

    it('handler happy delega en refundPayment con DTO validado', async () => {
      const { tools, deps } = buildTools({
        paymentsService: {
          getPaymentStatus: jest.fn().mockResolvedValue(STATUS),
          refundPayment: jest
            .fn()
            .mockResolvedValue({ success: true, data: { id: 3 } }),
        },
      });
      const tool = getTool(tools, 'refund_payment');
      const answer = JSON.parse(
        await tool.handler!(
          { payment_id: 'TX-100', reason: 'Producto defectuoso' },
          CONTEXT,
        ),
      );

      expect(answer.resumen).toMatch(/TX-100/);
      expect(deps.paymentsService.refundPayment).toHaveBeenCalledWith(
        'TX-100',
        expect.objectContaining({
          paymentId: 'TX-100',
          reason: 'Producto defectuoso',
        }),
        expect.objectContaining({ id: 11 }),
      );
    });
  });
});
