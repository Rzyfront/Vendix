import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisteredTool } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { CartService } from '../../../domains/ecommerce/cart/cart.service';
import { CartSummaryDto } from '../../../domains/ecommerce/cart/dto/cart.dto';
import { CheckoutService } from '../../../domains/ecommerce/checkout/checkout.service';
import { CouponPreviewDto } from '../../../domains/ecommerce/checkout/dto/checkout.dto';

export interface EcommerceSupportToolDeps {
  cartService: CartService;
  checkoutService: CheckoutService;
}

const SHIPPING_TYPES = [
  'pickup',
  'own_fleet',
  'carrier',
  'custom',
  'third_party_provider',
] as const;

function describeError(error: unknown): { code?: string; message: string } {
  if (error instanceof VendixHttpException) {
    const response = error.getResponse() as { message?: string } | string;
    const message =
      typeof response === 'string'
        ? response
        : (response?.message ?? error.message);
    return { code: error.errorCode, message };
  }
  if (error instanceof HttpException) {
    const response = error.getResponse() as
      | { message?: unknown; error_code?: string }
      | string;
    if (typeof response === 'string') return { message: response };
    const raw = response?.message;
    const message = Array.isArray(raw)
      ? raw.join('; ')
      : typeof raw === 'string'
        ? raw
        : error.message;
    return {
      ...(response?.error_code && { code: response.error_code }),
      message,
    };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: 'Error desconocido' };
}

function toValidatedDto<T extends object>(
  DtoClass: new () => T,
  plain: Record<string, unknown>,
): { ok: true; dto: T } | { ok: false; message: string } {
  const dto = plainToInstance(DtoClass, plain, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (!errors.length) return { ok: true, dto };
  const details = errors
    .flatMap((entry) => Object.values(entry.constraints ?? {}))
    .join('; ');
  return {
    ok: false,
    message: `Los datos no pasaron la validación: ${details || 'revisa los campos enviados'}.`,
  };
}

/**
 * O-44 / O-45 — Soporte ecommerce buyer-side, solo diagnóstico merchant (P2).
 *
 * El merchant pregunta "¿por qué no cierra la venta?": estas dos lecturas
 * cotizan un carrito ajeno y listan las opciones de checkout SIN tocar
 * carritos persistidos ni crear órdenes. `items` es un snapshot que dicta el
 * comprador (o que el merchant copia del reclamo): con líneas, `getCartSummary`
 * cotiza sobre el DTO y nunca lee el carrito en sesión — por eso `items` es
 * obligatorio aquí, para no cotizar por accidente el carrito propio del
 * merchant autenticado.
 */
export function createEcommerceSupportTools(
  deps: EcommerceSupportToolDeps,
): RegisteredTool[] {
  const { cartService, checkoutService } = deps;

  return [
    // ─── O-44: get_cart_summary (READ) ─────────────────────────────────
    {
      name: 'get_cart_summary',
      version: '1',
      domain: 'ecommerce-support',
      readOnly: true,
      description:
        'Diagnóstico merchant del carrito de UN COMPRADOR: cotiza subtotal, descuentos promocionales automáticos y progreso de tiers sobre un snapshot de líneas. Nunca toca carritos persistidos ni crea órdenes. items es obligatorio: sin él cotizarías tu propio carrito.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description:
              'Snapshot del carrito del comprador: product_id, quantity y product_variant_id/price_tier_id opcionales.',
            items: {
              type: 'object',
              properties: {
                product_id: { type: 'number' },
                product_variant_id: { type: 'number' },
                quantity: { type: 'number' },
                price_tier_id: { type: 'number' },
              },
              required: ['product_id', 'quantity'],
            },
          },
        },
        required: ['items'],
      },
      requiredPermissions: ['store:ecommerce:read'],
      handler: async (args, context) => {
        if (!context.store_id && !context.organization_id) {
          return JSON.stringify({
            error:
              'Sin tienda ni organización en contexto: el diagnóstico de carrito está acotado por tenant.',
          });
        }

        const rawItems = Array.isArray(args.items) ? args.items : [];
        if (!rawItems.length) {
          return JSON.stringify({
            error:
              'items vacío: pasa el snapshot del carrito del comprador (product_id + quantity por línea).',
            next_step:
              'Pídele al comprador qué lleva en el carrito o cópialo del reclamo.',
          });
        }

        const checked = toValidatedDto(CartSummaryDto, {
          items: rawItems.map((line: any) => ({
            product_id: Number(line?.product_id),
            ...(line?.product_variant_id !== undefined &&
            line?.product_variant_id !== null
              ? { product_variant_id: Number(line.product_variant_id) }
              : {}),
            quantity: Number(line?.quantity),
            ...(line?.price_tier_id !== undefined &&
            line?.price_tier_id !== null
              ? { price_tier_id: Number(line.price_tier_id) }
              : {}),
          })),
        });
        if (!checked.ok) {
          return JSON.stringify({
            error: checked.message,
            next_step:
              'Cada línea necesita product_id (entero ≥1) y quantity (entero ≥1).',
          });
        }

        try {
          const summary = await cartService.getCartSummary(checked.dto.items);
          return JSON.stringify({
            resumen: `${summary.item_count} línea(s): subtotal $${summary.subtotal}, descuento promo $${summary.promotion_discount}, a pagar $${summary.promotional_subtotal}`,
            subtotal: summary.subtotal,
            descuento_promocional: summary.promotion_discount,
            subtotal_promocional: summary.promotional_subtotal,
            lineas: summary.item_count,
            promociones_aplicadas: summary.applied_promotions,
            progreso_tiers: summary.tier_progress,
            nota: 'Diagnóstico merchant sobre un snapshot: no tocó ningún carrito persistido. Precios CON impuesto, igual que la vista del carrito.',
          });
        } catch (error) {
          const info = describeError(error);
          return JSON.stringify({
            error: `No se pudo cotizar el carrito: ${info.message}`,
            next_step:
              'Verifica que los productos existan y estén activos para ecommerce.',
          });
        }
      },
    },

    // ─── O-45: get_checkout_options (READ) ─────────────────────────────
    {
      name: 'get_checkout_options',
      version: '1',
      domain: 'ecommerce-support',
      readOnly: true,
      description:
        'Diagnóstico merchant de las opciones de checkout: métodos de entrega activos, métodos de pago habilitados (filtrados por tipo de envío) y validación opcional de un cupón sobre un snapshot de líneas. Nunca crea órdenes ni pagos.',
      parameters: {
        type: 'object',
        properties: {
          shipping_type: {
            type: 'string',
            enum: SHIPPING_TYPES,
            description:
              'Filtra los métodos de pago como los vería el comprador con ese envío (pickup excluye contra-entrega). Sin él, lista todos los habilitados.',
          },
          coupon_code: {
            type: 'string',
            description:
              'Cupón a validar (opcional; exige coupon_items).',
          },
          coupon_items: {
            type: 'array',
            description:
              'Snapshot de líneas para validar el cupón: product_id, quantity y product_variant_id opcional.',
            items: {
              type: 'object',
              properties: {
                product_id: { type: 'number' },
                product_variant_id: { type: 'number' },
                quantity: { type: 'number' },
              },
              required: ['product_id', 'quantity'],
            },
          },
        },
      },
      requiredPermissions: ['store:ecommerce:read'],
      handler: async (args, context) => {
        if (!context.store_id && !context.organization_id) {
          return JSON.stringify({
            error:
              'Sin tienda ni organización en contexto: las opciones de checkout están acotadas por tenant.',
          });
        }

        const couponCode =
          args.coupon_code !== undefined && args.coupon_code !== null
            ? String(args.coupon_code).trim()
            : '';
        const couponItems = Array.isArray(args.coupon_items)
          ? args.coupon_items
          : [];
        if (couponCode && !couponItems.length) {
          return JSON.stringify({
            error:
              'coupon_code sin coupon_items: para validar un cupón pasa el snapshot de líneas del comprador.',
            next_step:
              'Repite con coupon_items (product_id + quantity por línea) o sin coupon_code.',
          });
        }

        let couponDto: CouponPreviewDto | null = null;
        if (couponCode) {
          const checked = toValidatedDto(CouponPreviewDto, {
            coupon_code: couponCode,
            items: couponItems.map((line: any) => ({
              product_id: Number(line?.product_id),
              ...(line?.product_variant_id !== undefined &&
              line?.product_variant_id !== null
                ? { product_variant_id: Number(line.product_variant_id) }
                : {}),
              quantity: Number(line?.quantity),
            })),
          });
          if (!checked.ok) {
            return JSON.stringify({
              error: checked.message,
              next_step:
                'Cada línea necesita product_id (entero ≥1) y quantity (entero ≥1).',
            });
          }
          couponDto = checked.dto;
        }

        try {
          const [deliveryOptions, paymentMethods, coupon] = await Promise.all([
            checkoutService.getDeliveryOptions(),
            checkoutService.getPaymentMethods(
              args.shipping_type !== undefined
                ? String(args.shipping_type)
                : undefined,
            ),
            couponDto
              ? checkoutService.previewCouponDiscount(couponDto)
              : Promise.resolve(null),
          ]);

          return JSON.stringify({
            opciones_entrega: deliveryOptions,
            metodos_pago: paymentMethods,
            ...(coupon ? { cupon: coupon } : {}),
            nota: 'Diagnóstico merchant: lista opciones sin crear órdenes ni pagos.',
          });
        } catch (error) {
          const info = describeError(error);
          return JSON.stringify({
            error: `No se pudieron leer las opciones de checkout: ${info.message}`,
            next_step:
              'Verifica que la tienda tenga métodos de entrega y pago activos.',
          });
        }
      },
    },
  ];
}
