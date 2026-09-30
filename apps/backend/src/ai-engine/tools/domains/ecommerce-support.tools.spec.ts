import {
  createEcommerceSupportTools,
  EcommerceSupportToolDeps,
} from './ecommerce-support.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Track B paso 10 — contrato O-44 / O-45 (soporte ecommerce buyer-side).
 *
 * Patrón canónico T4: (a) happy/sad, (b) snapshot de salida, (c) forma
 * `{error, next_step}`, (d) permiso declarado, (e) `readOnly: true` en reads.
 * Diagnóstico merchant: cotizan sobre snapshots sin tocar carritos
 * persistidos ni crear órdenes.
 */
describe('ecommerce-support.tools · O-44 get_cart_summary / O-45 get_checkout_options', () => {
  const CONTEXT = { store_id: 7, organization_id: 3, user_id: 11, roles: [] };

  function buildTools(overrides: {
    cartService?: Record<string, any>;
    checkoutService?: Record<string, any>;
  } = {}) {
    const deps = {
      cartService: {
        getCartSummary: jest.fn(),
        ...overrides.cartService,
      } as any,
      checkoutService: {
        getDeliveryOptions: jest.fn(),
        getPaymentMethods: jest.fn(),
        previewCouponDiscount: jest.fn(),
        ...overrides.checkoutService,
      } as any,
    } satisfies EcommerceSupportToolDeps;
    return { deps, tools: createEcommerceSupportTools(deps) };
  }

  function getTool(tools: RegisteredTool[], name: string): RegisteredTool {
    const tool = tools.find((t) => t.name === name);
    if (!tool?.handler) throw new Error(`${name} sin handler`);
    return tool;
  }

  describe('contrato de familia', () => {
    it('declara version 1, readOnly y permiso ecommerce en ambos reads', () => {
      const { tools } = buildTools();
      for (const name of ['get_cart_summary', 'get_checkout_options']) {
        const tool = getTool(tools, name);
        expect(tool.version).toBe('1');
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation).toBeUndefined();
        expect(tool.requiredPermissions).toEqual(['store:ecommerce:read']);
      }
    });
  });

  describe('get_cart_summary (O-44)', () => {
    const SUMMARY = {
      subtotal: 50000,
      promotion_discount: 5000,
      promotional_subtotal: 45000,
      item_count: 2,
      applied_promotions: [
        {
          promotion_id: 3,
          name: 'Martes 10%',
          type: 'percentage',
          scope: 'order',
          discount_amount: 5000,
        },
      ],
      tier_progress: [],
    };

    it('happy: cotiza el snapshot sin tocar el carrito en sesión', async () => {
      const getCartSummary = jest.fn().mockResolvedValue(SUMMARY);
      const { tools } = buildTools({ cartService: { getCartSummary } });
      const tool = getTool(tools, 'get_cart_summary');
      const answer = JSON.parse(
        await tool.handler!(
          { items: [{ product_id: 9, quantity: 2 }] },
          CONTEXT,
        ),
      );

      expect(answer).toEqual({
        resumen:
          '2 línea(s): subtotal $50000, descuento promo $5000, a pagar $45000',
        subtotal: 50000,
        descuento_promocional: 5000,
        subtotal_promocional: 45000,
        lineas: 2,
        promociones_aplicadas: SUMMARY.applied_promotions,
        progreso_tiers: [],
        nota: 'Diagnóstico merchant sobre un snapshot: no tocó ningún carrito persistido. Precios CON impuesto, igual que la vista del carrito.',
      });
      expect(getCartSummary).toHaveBeenCalledWith([
        expect.objectContaining({ product_id: 9, quantity: 2 }),
      ]);
    });

    it('sad: items vacío no cotiza (evita leer el carrito propio)', async () => {
      const getCartSummary = jest.fn();
      const { tools } = buildTools({ cartService: { getCartSummary } });
      const tool = getTool(tools, 'get_cart_summary');
      const answer = JSON.parse(
        await tool.handler!({ items: [] }, CONTEXT),
      );

      expect(answer.error).toMatch(/snapshot del carrito/);
      expect(answer.next_step).toMatch(/comprador/);
      expect(getCartSummary).not.toHaveBeenCalled();
    });

    it('sad: línea sin quantity no llama al servicio', async () => {
      const getCartSummary = jest.fn();
      const { tools } = buildTools({ cartService: { getCartSummary } });
      const tool = getTool(tools, 'get_cart_summary');
      const answer = JSON.parse(
        await tool.handler!({ items: [{ product_id: 9 }] }, CONTEXT),
      );

      expect(answer.error).toMatch(/validación/);
      expect(getCartSummary).not.toHaveBeenCalled();
    });

    it('sad: sin tenant responde error acotado', async () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'get_cart_summary');
      const answer = JSON.parse(
        await tool.handler!({ items: [{ product_id: 9, quantity: 1 }] }, {}),
      );

      expect(answer.error).toMatch(/tienda/);
    });

    it('sad: fallo del dominio responde {error, next_step}', async () => {
      const { tools } = buildTools({
        cartService: {
          getCartSummary: jest
            .fn()
            .mockRejectedValue(new Error('producto inactivo')),
        },
      });
      const tool = getTool(tools, 'get_cart_summary');
      const answer = JSON.parse(
        await tool.handler!({ items: [{ product_id: 9, quantity: 1 }] }, CONTEXT),
      );

      expect(answer.error).toMatch(/producto inactivo/);
      expect(answer.next_step).toMatch(/ecommerce/);
    });
  });

  describe('get_checkout_options (O-45)', () => {
    const DELIVERY = [
      { method_id: 1, method_name: 'Recoger', delivery_type: 'pickup' },
      { method_id: 2, method_name: 'Domicilio', delivery_type: 'home_delivery' },
    ];
    const PAYMENTS = [
      { id: 5, name: 'Wompi', type: 'wompi', processing_mode: 'ONLINE' },
    ];

    it('happy: entrega + pagos en una sola respuesta', async () => {
      const { tools, deps } = buildTools({
        checkoutService: {
          getDeliveryOptions: jest.fn().mockResolvedValue(DELIVERY),
          getPaymentMethods: jest.fn().mockResolvedValue(PAYMENTS),
        },
      });
      const tool = getTool(tools, 'get_checkout_options');
      const answer = JSON.parse(
        await tool.handler!({ shipping_type: 'pickup' }, CONTEXT),
      );

      expect(answer.opciones_entrega).toEqual(DELIVERY);
      expect(answer.metodos_pago).toEqual(PAYMENTS);
      expect(answer.cupon).toBeUndefined();
      expect(answer.nota).toMatch(/sin crear órdenes/);
      expect(deps.checkoutService.getPaymentMethods).toHaveBeenCalledWith(
        'pickup',
      );
      expect(
        deps.checkoutService.previewCouponDiscount,
      ).not.toHaveBeenCalled();
    });

    it('happy: con cupón incluye el preview validado', async () => {
      const previewCouponDiscount = jest.fn().mockResolvedValue({
        valid: true,
        coupon_id: 12,
        code: 'BIENVENIDA10',
        discount_amount: 4500,
        subtotal: 45000,
      });
      const { tools } = buildTools({
        checkoutService: {
          getDeliveryOptions: jest.fn().mockResolvedValue(DELIVERY),
          getPaymentMethods: jest.fn().mockResolvedValue(PAYMENTS),
          previewCouponDiscount,
        },
      });
      const tool = getTool(tools, 'get_checkout_options');
      const answer = JSON.parse(
        await tool.handler!(
          {
            coupon_code: 'bienvenida10',
            coupon_items: [{ product_id: 9, quantity: 1 }],
          },
          CONTEXT,
        ),
      );

      expect(answer.cupon).toEqual(
        expect.objectContaining({ valid: true, code: 'BIENVENIDA10' }),
      );
      expect(previewCouponDiscount).toHaveBeenCalledWith(
        expect.objectContaining({ coupon_code: 'BIENVENIDA10' }),
      );
    });

    it('sad: cupón sin líneas no valida', async () => {
      const previewCouponDiscount = jest.fn();
      const { tools } = buildTools({
        checkoutService: {
          getDeliveryOptions: jest.fn().mockResolvedValue([]),
          getPaymentMethods: jest.fn().mockResolvedValue([]),
          previewCouponDiscount,
        },
      });
      const tool = getTool(tools, 'get_checkout_options');
      const answer = JSON.parse(
        await tool.handler!({ coupon_code: 'X10' }, CONTEXT),
      );

      expect(answer.error).toMatch(/sin coupon_items/);
      expect(answer.next_step).toMatch(/coupon_items/);
      expect(previewCouponDiscount).not.toHaveBeenCalled();
    });

    it('sad: cupón inválido propaga el veredicto del servicio', async () => {
      const { tools } = buildTools({
        checkoutService: {
          getDeliveryOptions: jest.fn().mockResolvedValue(DELIVERY),
          getPaymentMethods: jest.fn().mockResolvedValue(PAYMENTS),
          previewCouponDiscount: jest.fn().mockResolvedValue({
            valid: false,
            coupon_id: null,
            code: 'VENCIDO',
            discount_amount: 0,
            subtotal: 45000,
            reason: 'Cupón vencido',
          }),
        },
      });
      const tool = getTool(tools, 'get_checkout_options');
      const answer = JSON.parse(
        await tool.handler!(
          {
            coupon_code: 'VENCIDO',
            coupon_items: [{ product_id: 9, quantity: 1 }],
          },
          CONTEXT,
        ),
      );

      expect(answer.cupon.valid).toBe(false);
      expect(answer.cupon.reason).toMatch(/vencido/i);
    });

    it('sad: sin tenant responde error acotado', async () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'get_checkout_options');
      const answer = JSON.parse(await tool.handler!({}, {}));

      expect(answer.error).toMatch(/tienda/);
    });
  });
});
