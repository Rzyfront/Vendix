import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { shipping_rate_type_enum } from '@prisma/client';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import {
  AddressDTO,
  CartItemDTO,
  ShippingCalculatorService,
} from '../../../domains/store/shipping/shipping-calculator.service';
import { ShippingDistanceService } from '../../../domains/store/shipping/services/shipping-distance.service';
import { StoreShippingMethodsService } from '../../../domains/store/shipping/services/store-shipping-methods.service';
import { StoreShippingZonesService } from '../../../domains/store/shipping/services/store-shipping-zones.service';
import {
  EnableShippingMethodDto,
  UpdateStoreShippingMethodDto,
} from '../../../domains/store/shipping/dto/store-shipping-method.dto';
import {
  CreateRateDto,
  CreateZoneDto,
  UpdateRateDto,
  UpdateZoneDto,
} from '../../../domains/store/shipping/dto/store-shipping-zones.dto';

export interface ShippingToolDeps {
  shippingCalculatorService: ShippingCalculatorService;
  shippingDistanceService: ShippingDistanceService;
  methodsService: StoreShippingMethodsService;
  zonesService: StoreShippingZonesService;
}

const METHOD_ACTIONS = ['enable', 'update', 'disable', 're-enable', 'remove'];
const RATE_ACTIONS = [
  'create-zone',
  'update-zone',
  'delete-zone',
  'create-rate',
  'update-rate',
  'delete-rate',
];
const RATE_TYPES = Object.values(shipping_rate_type_enum);

// Mensajes exactos de `CheckoutService.resolveConfirmShippingCost`: D-11 los
// replica para que la spec fije el contrato ECOM_CHECKOUT_003 byte a byte.
const BUYER_GEOCODE_FAILED_MESSAGE =
  'No pudimos ubicar la dirección de entrega. Marca la ubicación en el mapa para calcular el envío.';
const OUT_OF_RANGE_MESSAGE =
  'La tarifa de envío seleccionada ya no cubre la distancia a tu dirección; vuelve a cotizar el envío';

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

function guidedError(error: string, nextStep?: string): string {
  return JSON.stringify({
    error,
    ...(nextStep ? { next_step: nextStep } : {}),
  });
}

function previewError(target: string, message: string): ToolPreview {
  return { status: 'error', target, changes: [], message, domain: 'shipping' };
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
 * Espejo del `assertDistanceOriginPinned` del servicio: no se puede activar
 * el cobro por distancia sin origen pineado. Se valida sobre los valores YA
 * MEZCLADOS (args + existente) para cubrir updates parciales, igual que el
 * servicio. El servicio lo vuelve a exigir: esto es el borde en español.
 */
function assertOriginPinnedAtEdge(effective: {
  distance_pricing_enabled?: boolean | null;
  origin_latitude?: unknown;
  origin_longitude?: unknown;
}): string | null {
  if (
    effective.distance_pricing_enabled &&
    (effective.origin_latitude == null || effective.origin_longitude == null)
  ) {
    return 'Para activar el cobro por distancia el método necesita un origen pineado (origin_latitude/origin_longitude): marca el punto de despacho en el mapa y reintenta.';
  }
  return null;
}

/**
 * Espejo legible del `IsValidDistanceTiers`: escala contigua, ordenada,
 * desde 0 y con `to_km: null` solo al final (máx. 20 tramos). El DTO lo
 * vuelve a validar: esto es el borde con remedio en español.
 */
function validateTiersAtEdge(tiers: unknown): string | null {
  if (tiers === null || tiers === undefined) return null;
  if (!Array.isArray(tiers)) return 'distance_tiers debe ser una lista.';
  if (!tiers.length) return null;
  if (tiers.length > 20) return 'distance_tiers admite máximo 20 tramos.';
  let expectedFrom = 0;
  for (const [index, raw] of tiers.entries()) {
    const from = Number((raw as any)?.from_km);
    const toRaw = (raw as any)?.to_km;
    const price = Number((raw as any)?.price);
    if (!Number.isFinite(from) || from < 0) {
      return `Tramo ${index + 1}: from_km inválido.`;
    }
    if (from !== expectedFrom) {
      return (
        `Tramo ${index + 1}: la escala debe ser contigua (este tramo debe ` +
        `arrancar en ${expectedFrom}, sin huecos ni traslapes) y el primero en 0.`
      );
    }
    if (!Number.isFinite(price) || price < 0) {
      return `Tramo ${index + 1}: price inválido.`;
    }
    if (toRaw === null || toRaw === undefined) {
      if (index !== tiers.length - 1) {
        return `Tramo ${index + 1}: el tramo abierto (to_km null) solo puede ir al final.`;
      }
      return null;
    }
    const to = Number(toRaw);
    if (!Number.isFinite(to) || to <= from) {
      return `Tramo ${index + 1}: to_km debe ser mayor a from_km.`;
    }
    expectedFrom = to;
  }
  return null;
}

/**
 * D-8..D-11 — Envíos (paso 8 P0 D-8 + paso 13 D-9/D-10/D-11).
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
 *
 * D-11 `list_shipping_config` es la lectura habilitante de D-9/D-10 y, en
 * modo distance-check, replica la rama de confirmación del checkout tramo
 * por tramo con `toCoords` (ÚNICO normalizador) + `matchTier` puro: fuera
 * de tramos o sin punto del comprador, el veredicto porta el
 * `ECOM_CHECKOUT_003` exacto — rechazo estricto, sin tolerancia.
 */
export function createShippingTools(deps: ShippingToolDeps): RegisteredTool[] {
  const {
    shippingCalculatorService,
    shippingDistanceService,
    methodsService,
    zonesService,
  } = deps;

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

    // ─── D-9: manage_shipping_method (WRITE, exige D-11) ──────────
    {
      name: 'manage_shipping_method',
      version: '1',
      domain: 'shipping',
      description:
        'Gestiona métodos de envío de la tienda: enable (activa un método del sistema), update (nombre, topes, política y cobro por distancia), disable/re-enable y remove. Lee PRIMERO con list_shipping_config. Activar distance_pricing_enabled EXIGE origen pineado (origin_latitude/origin_longitude sobre lo ya mezclado): sin punto de despacho no hay cobro por km. El handler re-lee el método antes de mutar.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: METHOD_ACTIONS,
            description: 'enable, update, disable, re-enable o remove.',
          },
          method_id: {
            type: 'number',
            description:
              'ID del método de la tienda (requerido en todo salvo enable; en enable es el ID del método del sistema a activar).',
          },
          name: { type: 'string', description: 'Nombre visible.' },
          min_order_amount: {
            type: 'number',
            description: 'Monto mínimo de orden.',
          },
          max_order_amount: {
            type: 'number',
            description: 'Monto máximo de orden.',
          },
          distance_pricing_enabled: {
            type: 'boolean',
            description:
              'Activa el cobro por distancia real (exige origen pineado).',
          },
          origin_latitude: {
            type: 'number',
            description: 'Latitud del punto de despacho (-90 a 90).',
          },
          origin_longitude: {
            type: 'number',
            description: 'Longitud del punto de despacho (-180 a 180).',
          },
        },
        required: ['action', 'method_id'],
      },
      // No existe `store:shipping:*` en el seed (igual que D-8): la
      // configuración de envíos vive en el flujo de órdenes y se gatea con
      // su escritura.
      requiredPermissions: ['store:orders:update'],
      requiresConfirmation: true,
      preview: async (args, context) => {
        if (!context.store_id) {
          return previewError(
            'Método de envío',
            'Sin tienda en contexto: los métodos siempre viven dentro de una tienda.',
          );
        }
        const action = String(args.action ?? '');
        if (!METHOD_ACTIONS.includes(action)) {
          return previewError(
            'Método de envío',
            `action "${action}" inválida. Usa ${METHOD_ACTIONS.join(', ')}.`,
          );
        }
        const methodId = toPositiveInt(args.method_id);
        if (!methodId) {
          return previewError('Método de envío', 'method_id inválido.');
        }

        try {
          if (action === 'enable') {
            const problem = assertOriginPinnedAtEdge({
              distance_pricing_enabled:
                args.distance_pricing_enabled === true,
              origin_latitude: args.origin_latitude,
              origin_longitude: args.origin_longitude,
            });
            if (problem) {
              return previewError('Activación de método', problem);
            }
            return {
              status: 'ok',
              target: `Activar método del sistema #${methodId} en la tienda`,
              changes: [
                ...(args.distance_pricing_enabled === true
                  ? [
                      {
                        field: 'distance_pricing_enabled',
                        label: 'Cobro por distancia',
                        from: null,
                        to: `activo (origen ${args.origin_latitude}, ${args.origin_longitude})`,
                      },
                    ]
                  : []),
              ],
              domain: 'shipping',
            };
          }

          const method = await methodsService.findOne(methodId);
          const label = `Método "${(method as any)?.name ?? `#${methodId}`}"`;
          if (action === 'disable' || action === 're-enable') {
            return {
              status: 'warning',
              target: `${action === 'disable' ? 'Desactivación' : 'Reactivación'} — ${label}`,
              changes: [
                {
                  field: 'is_active',
                  label: 'Estado',
                  from: action === 'disable' ? 'activo' : 'inactivo',
                  to: action === 'disable' ? 'inactivo' : 'activo',
                },
              ],
              domain: 'shipping',
            };
          }
          if (action === 'remove') {
            return {
              status: 'warning',
              target: `Retiro — ${label}`,
              changes: [
                {
                  field: 'method',
                  label: 'Método',
                  from: (method as any)?.name ?? `#${methodId}`,
                  to: 'retirado de la tienda',
                },
              ],
              message: 'Retirar es irreversible.',
              domain: 'shipping',
            };
          }

          const fields = [
            'name',
            'min_order_amount',
            'max_order_amount',
            'distance_pricing_enabled',
            'origin_latitude',
            'origin_longitude',
          ].filter((field) => args[field] !== undefined);
          if (!fields.length) {
            return previewError(label, 'update exige al menos un campo.');
          }
          // Validación sobre lo YA MEZCLADO (args + existente): cubre
          // updates parciales que activan distancia sin re-pinear.
          const merged = {
            distance_pricing_enabled:
              args.distance_pricing_enabled !== undefined
                ? Boolean(args.distance_pricing_enabled)
                : (method as any)?.distance_pricing_enabled,
            origin_latitude:
              args.origin_latitude !== undefined
                ? args.origin_latitude
                : (method as any)?.origin_latitude,
            origin_longitude:
              args.origin_longitude !== undefined
                ? args.origin_longitude
                : (method as any)?.origin_longitude,
          };
          const problem = assertOriginPinnedAtEdge(merged);
          if (problem) {
            return previewError(label, problem);
          }
          return {
            status: 'ok',
            target: `Edición — ${label}`,
            changes: fields.map((field) => ({
              field,
              label: field,
              from: (method as any)?.[field] ?? null,
              to: args[field],
            })),
            domain: 'shipping',
          };
        } catch (error) {
          const info = describeError(error);
          return previewError('Método de envío', info.message);
        }
      },
      handler: async (args, context) => {
        if (!context.store_id) {
          return guidedError(
            'Sin tienda en contexto: los métodos siempre viven dentro de una tienda.',
          );
        }
        const action = String(args.action ?? '');
        const methodId = toPositiveInt(args.method_id);
        if (!methodId) {
          return guidedError(
            'method_id inválido.',
            'Lee los métodos con list_shipping_config y pasa su ID.',
          );
        }

        try {
          if (action === 'enable') {
            const problem = assertOriginPinnedAtEdge({
              distance_pricing_enabled:
                args.distance_pricing_enabled === true,
              origin_latitude: args.origin_latitude,
              origin_longitude: args.origin_longitude,
            });
            if (problem) return guidedError(problem);
            const checked = toValidatedDto(EnableShippingMethodDto, {
              ...(args.name ? { name: String(args.name) } : {}),
              ...(args.min_order_amount !== undefined
                ? { min_order_amount: Number(args.min_order_amount) }
                : {}),
              ...(args.max_order_amount !== undefined
                ? { max_order_amount: Number(args.max_order_amount) }
                : {}),
              ...(args.distance_pricing_enabled !== undefined
                ? {
                    distance_pricing_enabled: Boolean(
                      args.distance_pricing_enabled,
                    ),
                  }
                : {}),
              ...(args.origin_latitude !== undefined
                ? { origin_latitude: Number(args.origin_latitude) }
                : {}),
              ...(args.origin_longitude !== undefined
                ? { origin_longitude: Number(args.origin_longitude) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            const enabled = await methodsService.enableForStore(
              methodId,
              checked.dto,
            );
            return JSON.stringify({
              resumen: `Método "${(enabled as any)?.name ?? `#${methodId}`}" activado en la tienda (#${(enabled as any)?.id ?? '?'}).`,
              method_id: (enabled as any)?.id ?? methodId,
            });
          }

          // Re-verificación: el método pudo cambiar tras el preview.
          const current = await methodsService.findOne(methodId);
          const label = `Método "${(current as any)?.name ?? `#${methodId}`}"`;

          if (action === 'disable') {
            await methodsService.disableForStore(methodId);
            return JSON.stringify({
              resumen: `${label}: desactivado (ya no cotiza).`,
              method_id: methodId,
            });
          }
          if (action === 're-enable') {
            await methodsService.reEnableForStore(methodId);
            return JSON.stringify({
              resumen: `${label}: reactivado.`,
              method_id: methodId,
            });
          }
          if (action === 'remove') {
            await methodsService.removeFromStore(methodId);
            return JSON.stringify({
              resumen: `${label}: retirado de la tienda.`,
              method_id: methodId,
            });
          }
          if (action === 'update') {
            const merged = {
              distance_pricing_enabled:
                args.distance_pricing_enabled !== undefined
                  ? Boolean(args.distance_pricing_enabled)
                  : (current as any)?.distance_pricing_enabled,
              origin_latitude:
                args.origin_latitude !== undefined
                  ? args.origin_latitude
                  : (current as any)?.origin_latitude,
              origin_longitude:
                args.origin_longitude !== undefined
                  ? args.origin_longitude
                  : (current as any)?.origin_longitude,
            };
            const problem = assertOriginPinnedAtEdge(merged);
            if (problem) return guidedError(problem);
            const checked = toValidatedDto(UpdateStoreShippingMethodDto, {
              ...(args.name !== undefined
                ? { name: String(args.name) }
                : {}),
              ...(args.min_order_amount !== undefined
                ? { min_order_amount: Number(args.min_order_amount) }
                : {}),
              ...(args.max_order_amount !== undefined
                ? { max_order_amount: Number(args.max_order_amount) }
                : {}),
              ...(args.distance_pricing_enabled !== undefined
                ? {
                    distance_pricing_enabled: Boolean(
                      args.distance_pricing_enabled,
                    ),
                  }
                : {}),
              ...(args.origin_latitude !== undefined
                ? { origin_latitude: Number(args.origin_latitude) }
                : {}),
              ...(args.origin_longitude !== undefined
                ? { origin_longitude: Number(args.origin_longitude) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            await methodsService.updateStoreMethod(methodId, checked.dto);
            return JSON.stringify({
              resumen: `${label}: método actualizado.`,
              method_id: methodId,
            });
          }

          return guidedError(
            `action "${action}" inválida. Usa ${METHOD_ACTIONS.join(', ')}.`,
          );
        } catch (error) {
          const info = describeError(error);
          return guidedError(
            `No pude gestionar el método: ${info.message}`,
            'Lee los métodos con list_shipping_config para ver el estado actual y reintenta.',
          );
        }
      },
    },

    // ─── D-10: manage_shipping_rates (WRITE, exige D-11) ──────────
    {
      name: 'manage_shipping_rates',
      version: '1',
      domain: 'shipping',
      description:
        'Gestiona zonas y tarifas de envío: create-zone/update-zone/delete-zone (cobertura por país/región/ciudad) y create-rate/update-rate/delete-rate (precios por método, con escala distance_tiers opcional para cobro por km). Lee PRIMERO con list_shipping_config. La escala debe ser contigua, ordenada, desde 0 y con to_km null solo al final (máx. 20 tramos): si no, se rechaza en el borde con el tramo culpable.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: RATE_ACTIONS,
            description:
              'create-zone, update-zone, delete-zone, create-rate, update-rate o delete-rate.',
          },
          zone_id: {
            type: 'number',
            description:
              'ID de la zona (requerido en update/delete-zone y create-rate).',
          },
          rate_id: {
            type: 'number',
            description: 'ID de la tarifa (requerido en update/delete-rate).',
          },
          name: { type: 'string', description: 'Nombre (zona o tarifa).' },
          countries: {
            type: 'array',
            items: { type: 'string' },
            description: 'Países ISO de la zona (ej. ["CO"]).',
          },
          regions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Regiones/departamentos de la zona.',
          },
          cities: {
            type: 'array',
            items: { type: 'string' },
            description: 'Ciudades de la zona.',
          },
          shipping_method_id: {
            type: 'number',
            description: 'Método de la tarifa (requerido en create-rate).',
          },
          type: {
            type: 'string',
            enum: RATE_TYPES,
            description:
              'Tipo de cálculo: flat, weight_based, price_based, carrier_calculated o free.',
          },
          base_cost: {
            type: 'number',
            description: 'Costo base (requerido en create-rate).',
          },
          is_active: {
            type: 'boolean',
            description: 'Activa/desactiva la zona o tarifa.',
          },
          distance_tiers: {
            type: 'array',
            description:
              'Escala por km [{from_km, to_km|null, price}]: contigua, desde 0, abierto solo al final.',
            items: {
              type: 'object',
              properties: {
                from_km: { type: 'number' },
                to_km: { type: ['number', 'null'] },
                price: { type: 'number' },
              },
              required: ['from_km', 'price'],
            },
          },
        },
        required: ['action'],
      },
      // Igual que D-9: sin `store:shipping:*` en el seed, se gatea con la
      // escritura del flujo de órdenes.
      requiredPermissions: ['store:orders:update'],
      requiresConfirmation: true,
      preview: async (args, context) => {
        if (!context.store_id) {
          return previewError(
            'Zonas y tarifas',
            'Sin tienda en contexto: las zonas siempre viven dentro de una tienda.',
          );
        }
        const action = String(args.action ?? '');
        if (!RATE_ACTIONS.includes(action)) {
          return previewError(
            'Zonas y tarifas',
            `action "${action}" inválida. Usa ${RATE_ACTIONS.join(', ')}.`,
          );
        }
        if (
          (action === 'create-rate' || action === 'update-rate') &&
          args.distance_tiers !== undefined
        ) {
          const problem = validateTiersAtEdge(args.distance_tiers);
          if (problem) {
            return previewError('Escala por km', problem);
          }
        }

        try {
          if (action === 'create-zone') {
            const name = String(args.name ?? '').trim();
            if (!name || !Array.isArray(args.countries)) {
              return previewError(
                'Creación de zona',
                'create-zone exige name y countries (ej. ["CO"]).',
              );
            }
            return {
              status: 'ok',
              target: `Nueva zona — "${name}" (${(args.countries as string[]).join(', ')})`,
              changes: [],
              message:
                'Crea solo la zona: después agrega tarifas con create-rate.',
              domain: 'shipping',
            };
          }
          if (action === 'create-rate') {
            const zoneId = toPositiveInt(args.zone_id);
            const methodId = toPositiveInt(args.shipping_method_id);
            if (!zoneId || !methodId || !(Number(args.base_cost) >= 0)) {
              return previewError(
                'Creación de tarifa',
                'create-rate exige zone_id, shipping_method_id y base_cost. Lee la configuración con list_shipping_config primero.',
              );
            }
            const tiers = Array.isArray(args.distance_tiers)
              ? args.distance_tiers
              : [];
            return {
              status: 'ok',
              target: `Nueva tarifa — zona #${zoneId}, método #${methodId}: base ${args.base_cost}${tiers.length ? ` + ${tiers.length} tramo(s) por km` : ''}`,
              changes: tiers.length
                ? [
                    {
                      field: 'distance_tiers',
                      label: 'Escala por km',
                      from: null,
                      to: tiers
                        .map(
                          (tier: any) =>
                            `[${tier.from_km}–${tier.to_km ?? '∞'}) → ${tier.price}`,
                        )
                        .join('; '),
                    },
                  ]
                : [],
              domain: 'shipping',
            };
          }

          if (action.endsWith('-zone')) {
            const zoneId = toPositiveInt(args.zone_id);
            if (!zoneId) {
              return previewError(
                'Zonas y tarifas',
                `${action} exige zone_id.`,
              );
            }
            const zones = await zonesService.getStoreZones();
            const zone = (zones as any[]).find(
              (entry: any) => Number(entry.id) === zoneId,
            );
            const label = `Zona "${zone?.name ?? `#${zoneId}`}"`;
            if (action === 'delete-zone') {
              return {
                status: 'warning',
                target: `Eliminación — ${label}`,
                changes: [
                  {
                    field: 'zone',
                    label: 'Zona',
                    from: zone?.name ?? `#${zoneId}`,
                    to: 'eliminada',
                  },
                ],
                message: 'Eliminar es irreversible.',
                domain: 'shipping',
              };
            }
            const fields = [
              'name',
              'countries',
              'regions',
              'cities',
              'is_active',
            ].filter((field) => args[field] !== undefined);
            if (!fields.length) {
              return previewError(label, 'update-zone exige al menos un campo.');
            }
            return {
              status: 'ok',
              target: `Edición — ${label}`,
              changes: fields.map((field) => ({
                field,
                label: field,
                from: zone?.[field] ?? null,
                to: args[field],
              })),
              domain: 'shipping',
            };
          }

          const rateId = toPositiveInt(args.rate_id);
          if (!rateId) {
            return previewError(
              'Zonas y tarifas',
              `${action} exige rate_id. Lee las tarifas con list_shipping_config primero.`,
            );
          }
          if (action === 'delete-rate') {
            return {
              status: 'warning',
              target: `Eliminación — tarifa #${rateId}`,
              changes: [
                {
                  field: 'rate',
                  label: 'Tarifa',
                  from: `#${rateId}`,
                  to: 'eliminada',
                },
              ],
              message: 'Eliminar es irreversible.',
              domain: 'shipping',
            };
          }
          return {
            status: 'ok',
            target: `Edición — tarifa #${rateId}`,
            changes: [
              ...(args.base_cost !== undefined
                ? [
                    {
                      field: 'base_cost',
                      label: 'Costo base',
                      from: null,
                      to: Number(args.base_cost),
                    },
                  ]
                : []),
              ...(args.distance_tiers !== undefined
                ? [
                    {
                      field: 'distance_tiers',
                      label: 'Escala por km',
                      from: null,
                      to: Array.isArray(args.distance_tiers)
                        ? (args.distance_tiers as any[])
                            .map(
                              (tier: any) =>
                                `[${tier.from_km}–${tier.to_km ?? '∞'}) → ${tier.price}`,
                            )
                            .join('; ')
                        : 'sin escala (rige precio plano)',
                    },
                  ]
                : []),
            ],
            domain: 'shipping',
          };
        } catch (error) {
          const info = describeError(error);
          return previewError('Zonas y tarifas', info.message);
        }
      },
      handler: async (args, context) => {
        if (!context.store_id) {
          return guidedError(
            'Sin tienda en contexto: las zonas siempre viven dentro de una tienda.',
          );
        }
        const action = String(args.action ?? '');

        try {
          if (action === 'create-zone') {
            const checked = toValidatedDto(CreateZoneDto, {
              ...(args.name ? { name: String(args.name) } : {}),
              ...(Array.isArray(args.countries)
                ? { countries: args.countries.map(String) }
                : {}),
              ...(Array.isArray(args.regions)
                ? { regions: args.regions.map(String) }
                : {}),
              ...(Array.isArray(args.cities)
                ? { cities: args.cities.map(String) }
                : {}),
              ...(args.is_active !== undefined
                ? { is_active: Boolean(args.is_active) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            const created = await zonesService.createStoreZone(checked.dto);
            return JSON.stringify({
              resumen: `Zona "${(created as any)?.name}" creada (#${(created as any)?.id}). Agrega tarifas con create-rate.`,
              zone_id: (created as any)?.id,
            });
          }
          if (action === 'update-zone' || action === 'delete-zone') {
            const zoneId = toPositiveInt(args.zone_id);
            if (!zoneId) {
              return guidedError(
                `${action} exige zone_id.`,
                'Lee las zonas con list_shipping_config y pasa su ID.',
              );
            }
            if (action === 'delete-zone') {
              await zonesService.deleteStoreZone(zoneId);
              return JSON.stringify({
                resumen: `Zona #${zoneId} eliminada.`,
                zone_id: zoneId,
              });
            }
            const checked = toValidatedDto(UpdateZoneDto, {
              ...(args.name !== undefined
                ? { name: String(args.name) }
                : {}),
              ...(args.countries !== undefined
                ? { countries: (args.countries as any[]).map(String) }
                : {}),
              ...(args.regions !== undefined
                ? { regions: (args.regions as any[]).map(String) }
                : {}),
              ...(args.cities !== undefined
                ? { cities: (args.cities as any[]).map(String) }
                : {}),
              ...(args.is_active !== undefined
                ? { is_active: Boolean(args.is_active) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            await zonesService.updateStoreZone(zoneId, checked.dto);
            return JSON.stringify({
              resumen: `Zona #${zoneId} actualizada.`,
              zone_id: zoneId,
            });
          }

          if (action === 'create-rate' || action === 'update-rate') {
            if (args.distance_tiers !== undefined) {
              const problem = validateTiersAtEdge(args.distance_tiers);
              if (problem) return guidedError(problem);
            }
          }
          if (action === 'create-rate') {
            const checked = toValidatedDto(CreateRateDto, {
              ...(args.zone_id !== undefined
                ? { shipping_zone_id: Number(args.zone_id) }
                : {}),
              ...(args.shipping_method_id !== undefined
                ? { shipping_method_id: Number(args.shipping_method_id) }
                : {}),
              ...(args.name ? { name: String(args.name) } : {}),
              ...(args.type ? { type: String(args.type) } : {}),
              ...(args.base_cost !== undefined
                ? { base_cost: Number(args.base_cost) }
                : {}),
              ...(args.is_active !== undefined
                ? { is_active: Boolean(args.is_active) }
                : {}),
              ...(args.distance_tiers !== undefined
                ? { distance_tiers: args.distance_tiers }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            const created = await zonesService.createStoreRate(checked.dto);
            return JSON.stringify({
              resumen: `Tarifa #${(created as any)?.id} creada en la zona #${args.zone_id} (base ${args.base_cost}).`,
              rate_id: (created as any)?.id,
            });
          }
          if (action === 'update-rate') {
            const rateId = toPositiveInt(args.rate_id);
            if (!rateId) {
              return guidedError(
                'update-rate exige rate_id.',
                'Lee las tarifas con list_shipping_config y pasa su ID.',
              );
            }
            const checked = toValidatedDto(UpdateRateDto, {
              ...(args.name !== undefined
                ? { name: String(args.name) }
                : {}),
              ...(args.type !== undefined
                ? { type: String(args.type) }
                : {}),
              ...(args.base_cost !== undefined
                ? { base_cost: Number(args.base_cost) }
                : {}),
              ...(args.is_active !== undefined
                ? { is_active: Boolean(args.is_active) }
                : {}),
              ...(args.distance_tiers !== undefined
                ? { distance_tiers: args.distance_tiers }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            await zonesService.updateStoreRate(rateId, checked.dto);
            return JSON.stringify({
              resumen: `Tarifa #${rateId} actualizada.`,
              rate_id: rateId,
            });
          }
          if (action === 'delete-rate') {
            const rateId = toPositiveInt(args.rate_id);
            if (!rateId) {
              return guidedError(
                'delete-rate exige rate_id.',
                'Lee las tarifas con list_shipping_config y pasa su ID.',
              );
            }
            await zonesService.deleteStoreRate(rateId);
            return JSON.stringify({
              resumen: `Tarifa #${rateId} eliminada.`,
              rate_id: rateId,
            });
          }

          return guidedError(
            `action "${action}" inválida. Usa ${RATE_ACTIONS.join(', ')}.`,
          );
        } catch (error) {
          const info = describeError(error);
          return guidedError(
            `No pude gestionar zonas/tarifas: ${info.message}`,
            'Lee la configuración con list_shipping_config para ver el estado actual y reintenta.',
          );
        }
      },
    },

    // ─── D-11: list_shipping_config (READ + distance-check) ────────
    {
      name: 'list_shipping_config',
      version: '1',
      domain: 'shipping',
      readOnly: true,
      description:
        'Lee la configuración de envíos: métodos (con política y origen de distancia), zonas con sus tarifas y escalas por km, o el detalle de UN método/zona. Con check_buyer verifica tramo por tramo qué cobraría un método para un comprador (pin o dirección escrita): replica la rama de confirmación del checkout con toCoords + matchTier puros, y el veredicto fuera-de-tramos o sin-punto porta el ECOM_CHECKOUT_003 exacto. Es la lectura habilitante antes de manage_shipping_method y manage_shipping_rates.',
      parameters: {
        type: 'object',
        properties: {
          method_id: {
            type: 'number',
            description:
              'Detalle de UN método: política efectiva, origen y zonas donde tiene tarifa.',
          },
          zone_id: {
            type: 'number',
            description: 'Detalle de UNA zona con sus tarifas.',
          },
          include_rates: {
            type: 'boolean',
            description:
              'Incluye las tarifas de cada zona en el listado (por defecto true).',
          },
          check_buyer: {
            type: 'object',
            description:
              'Verifica qué cobraría method_id para este comprador (replica la confirmación del checkout).',
            properties: {
              address_line1: { type: 'string' },
              city: { type: 'string' },
              state_province: { type: 'string' },
              country_code: { type: 'string' },
              latitude: { type: 'number' },
              longitude: { type: 'number' },
            },
          },
        },
      },
      // Igual que D-8: sin `store:shipping:*` en el seed, se gatea con la
      // lectura del flujo de órdenes.
      requiredPermissions: ['store:orders:read'],
      handler: async (args, context) => {
        const storeId = toPositiveInt(context.store_id);
        if (!storeId) {
          return JSON.stringify({
            error:
              'Sin tienda en contexto: la configuración de envíos vive dentro de una tienda.',
          });
        }

        try {
          const methodId =
            args.method_id !== undefined
              ? toPositiveInt(args.method_id)
              : null;
          if (args.method_id !== undefined && !methodId) {
            return JSON.stringify({ error: 'method_id inválido.' });
          }
          const zoneId =
            args.zone_id !== undefined ? toPositiveInt(args.zone_id) : null;
          if (args.zone_id !== undefined && !zoneId) {
            return JSON.stringify({ error: 'zone_id inválido.' });
          }

          // Modo distance-check: replica resolveConfirmShippingCost por tramo.
          if (args.check_buyer !== undefined) {
            if (!methodId) {
              return JSON.stringify({
                error:
                  'check_buyer exige method_id: el diagnóstico corre sobre UN método.',
              });
            }
            const method = await methodsService.findOne(methodId);
            const buyerInput = (args.check_buyer ?? {}) as Record<
              string,
              any
            >;
            const origin = ShippingDistanceService.toCoords(
              (method as any)?.origin_latitude,
              (method as any)?.origin_longitude,
              'method-origin',
            );
            if (!(method as any)?.distance_pricing_enabled) {
              return JSON.stringify({
                metodo: (method as any)?.name ?? `#${methodId}`,
                distancia_activa: false,
                nota: 'Este método no cobra por distancia: rige el precio de zona de cada tarifa.',
              });
            }
            if (!origin) {
              return JSON.stringify({
                metodo: (method as any)?.name ?? `#${methodId}`,
                distancia_activa: true,
                origen: null,
                nota: 'Método sin origen pineado: por infraestructura rige precio de zona (no es rechazo). Pinea el origen con manage_shipping_method(update).',
              });
            }
            const buyer =
              await shippingDistanceService.resolveBuyerCoords({
                address_line1: buyerInput.address_line1 ?? null,
                city: buyerInput.city ?? null,
                state_province: buyerInput.state_province ?? null,
                country_code: buyerInput.country_code ?? 'CO',
                latitude: buyerInput.latitude,
                longitude: buyerInput.longitude,
              });
            if (!buyer) {
              return JSON.stringify({
                metodo: (method as any)?.name ?? `#${methodId}`,
                distancia_km: null,
                veredicto: {
                  error_code: 'ECOM_CHECKOUT_003',
                  error: BUYER_GEOCODE_FAILED_MESSAGE,
                  next_step:
                    'Pide la ubicación en el mapa (pin) o la dirección escrita completa y repite el diagnóstico.',
                },
              });
            }
            let distanceKm: number | null = null;
            try {
              distanceKm =
                await shippingDistanceService.resolveDistanceKm(
                  origin,
                  buyer,
                );
            } catch {
              distanceKm = null;
            }
            if (distanceKm === null) {
              return JSON.stringify({
                metodo: (method as any)?.name ?? `#${methodId}`,
                distancia_km: null,
                nota: 'El motor de ruteo no respondió: por infraestructura rige precio de zona (no es rechazo).',
              });
            }
            const zones = zoneId
              ? [{ id: zoneId }]
              : ((await zonesService.getStoreZones()) as any[]);
            const verdicts: Record<string, unknown>[] = [];
            for (const zone of zones) {
              const rates = (await zonesService.getStoreZoneRates(
                Number(zone.id),
              )) as any[];
              for (const rate of rates) {
                if (Number(rate.shipping_method_id) !== methodId) continue;
                const tiers = ShippingDistanceService.parseTiers(
                  rate.distance_tiers,
                );
                if (!tiers) {
                  verdicts.push({
                    rate_id: rate.id,
                    zona: zone.id,
                    resultado: 'zona',
                    precio_zona: Number(rate.base_cost ?? 0),
                    nota: 'Sin escala: rige el precio plano.',
                  });
                  continue;
                }
                const tier = ShippingDistanceService.matchTier(
                  tiers,
                  distanceKm,
                );
                verdicts.push(
                  tier
                    ? {
                        rate_id: rate.id,
                        zona: zone.id,
                        resultado: 'tramo',
                        tramo: {
                          from_km: tier.from_km,
                          to_km: tier.to_km,
                        },
                        precio: tier.price,
                      }
                    : {
                        rate_id: rate.id,
                        zona: zone.id,
                        resultado: 'excluida',
                        error_code: 'ECOM_CHECKOUT_003',
                        error: OUT_OF_RANGE_MESSAGE,
                      },
                );
              }
            }
            return JSON.stringify({
              metodo: (method as any)?.name ?? `#${methodId}`,
              distancia_km: distanceKm,
              medido_desde: {
                latitud: buyer.latitude,
                longitud: buyer.longitude,
                origen:
                  (buyer as any).source === 'client'
                    ? 'pin del comprador'
                    : `geocode (${(buyer as any).precision ?? 'sin precisión'})`,
              },
              veredictos: verdicts,
            });
          }

          if (methodId) {
            const [method, policy] = await Promise.all([
              methodsService.findOne(methodId),
              methodsService.getEffectivePolicy(methodId),
            ]);
            return JSON.stringify({
              metodo: {
                method_id: methodId,
                name: (method as any)?.name,
                is_active: (method as any)?.is_active ?? null,
                distance_pricing_enabled:
                  (method as any)?.distance_pricing_enabled ?? false,
                origin_latitude: (method as any)?.origin_latitude ?? null,
                origin_longitude: (method as any)?.origin_longitude ?? null,
                min_order_amount:
                  (method as any)?.min_order_amount ?? null,
                max_order_amount:
                  (method as any)?.max_order_amount ?? null,
              },
              politica: policy ?? null,
              next_step:
                'Para mutarlo usa manage_shipping_method; para verificar cobertura usa check_buyer con este method_id.',
            });
          }

          if (zoneId) {
            const [zones, rates] = await Promise.all([
              zonesService.getStoreZones(),
              zonesService.getStoreZoneRates(zoneId),
            ]);
            const zone = (zones as any[]).find(
              (entry: any) => Number(entry.id) === zoneId,
            );
            return JSON.stringify({
              zona: {
                zone_id: zoneId,
                name: zone?.name ?? null,
                countries: zone?.countries ?? null,
                regions: zone?.regions ?? null,
                cities: zone?.cities ?? null,
                is_active: zone?.is_active ?? null,
              },
              tarifas: ((rates as any[]) ?? []).map((rate: any) => ({
                rate_id: rate.id,
                method_id: rate.shipping_method_id,
                name: rate.name ?? null,
                type: rate.type,
                base_cost: Number(rate.base_cost ?? 0),
                is_active: rate.is_active ?? null,
                distance_tiers: rate.distance_tiers ?? null,
              })),
            });
          }

          const [methods, zones, stats] = await Promise.all([
            methodsService.getEnabledForStore(),
            zonesService.getStoreZones(),
            zonesService.getStats(),
          ]);
          const withRates = args.include_rates !== false;
          const zonesOut: Record<string, unknown>[] = [];
          for (const zone of (zones as any[]) ?? []) {
            const rates = withRates
              ? (((await zonesService.getStoreZoneRates(
                  Number(zone.id),
                )) as any[]) ?? [])
              : [];
            zonesOut.push({
              zone_id: zone.id,
              name: zone.name,
              countries: zone.countries ?? null,
              is_active: zone.is_active ?? null,
              tarifas: rates.map((rate: any) => ({
                rate_id: rate.id,
                method_id: rate.shipping_method_id,
                type: rate.type,
                base_cost: Number(rate.base_cost ?? 0),
                has_distance_tiers: Boolean(
                  Array.isArray(rate.distance_tiers) &&
                    rate.distance_tiers.length,
                ),
              })),
            });
          }
          return JSON.stringify({
            metodos: ((methods as any[]) ?? []).map((method: any) => ({
              method_id: method.id,
              name: method.name,
              distance_pricing_enabled:
                method.distance_pricing_enabled ?? false,
              origin_pinado: Boolean(
                method.origin_latitude != null &&
                  method.origin_longitude != null,
              ),
            })),
            zonas: zonesOut,
            stats: stats ?? null,
            next_step:
              'Para cotizar usa quote_shipping; para mutar usa manage_shipping_method / manage_shipping_rates.',
          });
        } catch (error) {
          const info = describeError(error);
          return JSON.stringify({
            error: `No pude leer la configuración: ${info.message}`,
            next_step:
              'Verifica los IDs con list_shipping_config sin filtros.',
          });
        }
      },
    },
  ];
}
