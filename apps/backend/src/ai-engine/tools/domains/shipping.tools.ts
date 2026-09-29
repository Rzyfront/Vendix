import { HttpException } from '@nestjs/common';
import { RegisteredTool } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import {
  AddressDTO,
  CartItemDTO,
  ShippingCalculatorService,
} from '../../../domains/store/shipping/shipping-calculator.service';
import { ShippingDistanceService } from '../../../domains/store/shipping/services/shipping-distance.service';

export interface ShippingToolDeps {
  shippingCalculatorService: ShippingCalculatorService;
  shippingDistanceService: ShippingDistanceService;
}

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

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

function compactOption(o: any) {
  return {
    rate_id: o.rate_id ?? o.id,
    method_id: o.method_id,
    method: o.method_name,
    type: o.method_type,
    // Bruto: lo que paga el cliente (modo agregado ya trae impuesto sumado).
    cost: Number(o.cost ?? 0),
    base: o.base !== undefined ? Number(o.base) : undefined,
    currency: o.currency,
    estimated_days: o.estimated_days ?? null,
    zone_id: o.zone_id ?? null,
    is_fallback: o.is_fallback ?? false,
  };
}

/**
 * D-8 — Cotización de envío P0 (paso 8 reportes-ops, track B).
 *
 * Wrapper fino sobre el cotizador dueño (`ShippingCalculatorService`): la zona
 * autoriza (cobertura) y la distancia precio. La resolución de coords del
 * comprador usa el MISMO helper compartido que el cotizador y la confirmación
 * (`ShippingDistanceService.resolveBuyerCoords`), así la tool reporta desde
 * qué punto se midió en vez de adivinarlo.
 *
 * Regla de negocio 2026-09-27: sin coords del comprador (ni pin ni geocode),
 * las tarifas por distancia se EXCLUYEN — no degradan a zona. La tool lo
 * reporta con el remedio ("marca la ubicación en el mapa") en vez de un 0
 * engañoso. Nunca Haversine: la distancia es por calles (Valhalla/OSRM).
 */
export function createShippingTools(deps: ShippingToolDeps): RegisteredTool[] {
  const { shippingCalculatorService, shippingDistanceService } = deps;

  return [
    // ─── D-8: quote_shipping (READ) ────────────────────────────────────
    {
      name: 'quote_shipping',
      version: '1',
      domain: 'shipping',
      readOnly: true,
      description:
        'Cotiza el envío para una dirección y un carrito: devuelve las tarifas disponibles con su costo bruto, la moneda y los días estimados, más desde qué punto se midió la distancia (pin del comprador o geocode de la dirección escrita). Úsala para "¿cuánto cuesta enviar a X?" o "¿qué métodos cubren esta dirección?". Sin coords del comprador las tarifas por distancia no aparecen (regla de negocio): la respuesta lo dice y pide marcar el mapa.',
      parameters: {
        type: 'object',
        properties: {
          country_code: {
            type: 'string',
            description:
              'País ISO de la dirección de entrega (ej. "CO"). Requerido.',
          },
          state_province: {
            type: 'string',
            description: 'Departamento o estado (ej. "Cundinamarca").',
          },
          city: {
            type: 'string',
            description: 'Ciudad o municipio (ej. "Bogotá").',
          },
          address_line1: {
            type: 'string',
            description:
              'Dirección escrita (ej. "Calle 45 # 12-30"). Sin lat/lng, se geocodifica para medir la distancia.',
          },
          postal_code: { type: 'string', description: 'Código postal.' },
          latitude: {
            type: 'number',
            description:
              'Latitud del pin confirmado en el mapa. El pin siempre gana sobre el geocode.',
          },
          longitude: {
            type: 'number',
            description: 'Longitud del pin confirmado en el mapa.',
          },
          items: {
            type: 'array',
            description:
              'Carrito a cotizar: cada línea trae product_id + quantity; price (total de la línea) y weight (total de la línea) son opcionales y defaultean 0.',
            items: {
              type: 'object',
              properties: {
                product_id: { type: 'number' },
                quantity: { type: 'number' },
                price: { type: 'number' },
                weight: { type: 'number' },
                product_type: { type: 'string' },
              },
              required: ['product_id', 'quantity'],
            },
          },
          method_id: {
            type: 'number',
            description:
              'Limita la cotización a UN método de envío (para comparar o validar uno puntual).',
          },
          include_geocoding: {
            type: 'boolean',
            description:
              'Incluye el detalle de resolución del punto del comprador (por defecto true).',
          },
        },
        required: ['country_code', 'items'],
      },
      // No existe `store:shipping:*` en el seed: la cotización vive en el flujo
      // de órdenes (POS/edición/checkout) y se gatea con su lectura.
      requiredPermissions: ['store:orders:read'],
      handler: async (args, context) => {
        const storeId = toPositiveInt(context.store_id);
        if (!storeId) {
          return JSON.stringify({
            error:
              'Sin tienda en contexto: la cotización usa las zonas y métodos de la tienda.',
          });
        }

        const countryCode = String(args.country_code ?? '').trim();
        if (!countryCode) {
          return JSON.stringify({ error: 'country_code inválido.' });
        }

        const rawItems = Array.isArray(args.items) ? args.items : [];
        if (!rawItems.length) {
          return JSON.stringify({
            error: 'items vacío: pasa al menos una línea con product_id + quantity.',
          });
        }
        const cartItems: CartItemDTO[] = [];
        for (const [index, line] of rawItems.entries()) {
          const productId = toPositiveInt(line?.product_id);
          const quantity = toPositiveInt(line?.quantity);
          if (!productId || !quantity) {
            return JSON.stringify({
              error: `items[${index}] inválido: product_id y quantity deben ser enteros ≥1.`,
            });
          }
          cartItems.push({
            product_id: productId,
            quantity,
            price: Number(line?.price ?? 0) || 0,
            weight: Number(line?.weight ?? 0) || 0,
            ...(line?.product_type
              ? { product_type: String(line.product_type) }
              : {}),
          });
        }

        const methodId =
          args.method_id !== undefined
            ? toPositiveInt(args.method_id)
            : null;
        if (args.method_id !== undefined && !methodId) {
          return JSON.stringify({ error: 'method_id inválido.' });
        }

        const address: AddressDTO = {
          country_code: countryCode,
          ...(args.state_province
            ? { state_province: String(args.state_province) }
            : {}),
          ...(args.city ? { city: String(args.city) } : {}),
          ...(args.address_line1
            ? { address_line1: String(args.address_line1) }
            : {}),
          ...(args.postal_code
            ? { postal_code: String(args.postal_code) }
            : {}),
          ...(args.latitude !== undefined
            ? { latitude: Number(args.latitude) }
            : {}),
          ...(args.longitude !== undefined
            ? { longitude: Number(args.longitude) }
            : {}),
        };

        try {
          // Mismo helper que el cotizador y la confirmación: el pin mandado
          // siempre gana; sin coords se intenta el forward-geocode de la línea
          // escrita. Solo informativo: `calculateRates` resuelve por su cuenta.
          const buyer = await shippingDistanceService.resolveBuyerCoords({
            address_line1: address.address_line1 ?? null,
            city: address.city ?? null,
            state_province: address.state_province ?? null,
            country_code: address.country_code,
            latitude: address.latitude,
            longitude: address.longitude,
          });

          const options = await shippingCalculatorService.calculateRates(
            storeId,
            cartItems,
            address,
          );
          const filtered = methodId
            ? options.filter((o) => Number(o.method_id) === methodId)
            : options;

          const withGeocoding = args.include_geocoding !== false;
          const geocoding = !withGeocoding
            ? undefined
            : buyer
              ? {
                  resuelta: true,
                  latitud: buyer.latitude,
                  longitud: buyer.longitude,
                  origen:
                    buyer.source === 'client'
                      ? 'pin del comprador'
                      : `geocode (${buyer.precision ?? 'sin precisión'})`,
                }
              : {
                  resuelta: false,
                  nota: 'No pudimos ubicar la dirección de entrega: las tarifas por distancia no aparecen en las opciones. Marca la ubicación en el mapa para calcular el envío.',
                };

          if (!filtered.length) {
            return JSON.stringify({
              direccion: {
                country_code: countryCode,
                city: address.city ?? null,
                address_line1: address.address_line1 ?? null,
              },
              opciones: [],
              nota: methodId
                ? `El método ${methodId} no cubre esta dirección para este carrito.`
                : 'Ninguna zona cubre esta dirección para este carrito (o las candidatas por distancia quedaron excluidas sin punto del comprador).',
              next_step: buyer
                ? 'Revisa zonas y tarifas del método en la configuración de envíos.'
                : 'Pide la ubicación en el mapa (pin) o la dirección escrita completa y vuelve a cotizar.',
              ...(geocoding ? { geocodificacion: geocoding } : {}),
            });
          }

          return JSON.stringify({
            direccion: {
              country_code: countryCode,
              city: address.city ?? null,
              address_line1: address.address_line1 ?? null,
            },
            opciones: filtered.map(compactOption),
            ...(filtered.some((o) => o.is_fallback)
              ? {
                  nota: 'Alguna opción viene del fallback de retiro en tienda: no hay despacho a esta dirección para esos métodos.',
                }
              : {}),
            ...(geocoding ? { geocodificacion: geocoding } : {}),
          });
        } catch (error) {
          const info = describeError(error);
          return JSON.stringify({
            error: `No se pudo cotizar el envío: ${info.message}`,
            next_step:
              'Verifica la dirección (país, ciudad, línea escrita o pin) y que la tienda tenga zonas y métodos activos.',
          });
        }
      },
    },
  ];
}
