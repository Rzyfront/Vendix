import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { LocationsService } from '../../../domains/store/inventory/locations/locations.service';
import { StockTransfersService } from '../../../domains/store/orders/stock-transfers/stock-transfers.service';
import { CreateTransferDto } from '../../../domains/store/orders/stock-transfers/dto/create-transfer.dto';
import { TRANSFER_SUPPORT_DOCUMENT_TYPES } from '../../../domains/store/orders/stock-transfers/transfer-transport';
import { transferLineKey } from '../../../domains/store/orders/stock-transfers/transfer-item-rules';

/**
 * Transferencias multi-producto para Vexi/Vex (P4 de «transferencias
 * multi-producto», decisiones D1–D9 del plan).
 *
 * - `find_transfer_products` (lectura): resuelve en una sola llamada varios
 *   productos pedidos en lenguaje natural a filas producto + variante con el
 *   disponible en origen y destino. Sin esto el modelo tendría que adivinar la
 *   variante, y una línea sin variante de un producto con variantes falla.
 * - `create_stock_transfer` (escritura con confirmación): varias líneas en una
 *   sola orden, en dos modos:
 *     · `quick` (D1/D9) — mueve al instante entre bodegas propias, mismo
 *       camino que el modal rápido (`StockTransfersService.createAndComplete`,
 *       endpoint `POST store/stock-transfers/complete`).
 *     · `draft` (D3/D8) — deja la orden avanzada pendiente de aprobar, sin
 *       mover nada (`StockTransfersService.create`, endpoint
 *       `POST store/stock-transfers`). Es el único modo que admite un destino
 *       externo, y entonces siempre con remisión.
 *
 * Permisos: los mismos que los endpoints. Ambos endpoints de creación aceptan
 * `store:stock-transfers:create` (el de movimiento rápido lo acepta junto a
 * `update`, en OR), así que la tool exige `create`. Aprobar, despachar y
 * recibir siguen en `manage_stock_transfers`, con sus propios permisos.
 *
 * Stock: la tool no toca `stock_levels`. El servicio valida alcance tienda u
 * organización (D7), líneas sin repetidos, disponible por variante y mueve con
 * `StockLevelManager` dentro de su transacción.
 *
 * Textos: lo que la persona ve (vista previa y resumen) va en español de
 * comerciante, con nombres de productos y bodegas; nunca IDs, nombres de
 * herramientas ni estados internos.
 */

export interface InventoryTransferToolServices {
  locationsService: LocationsService;
  transfersService: StockTransfersService;
}

export const TRANSFER_TOOL_MAX_LINES = 100;
const MAX_SEARCHES = 20;
const MODES = ['quick', 'draft'] as const;
type TransferToolMode = (typeof MODES)[number];
const DOCUMENT_MODES = ['none', 'dispatch_notes'] as const;

const SUPPORT_DOCUMENT_LABELS: Record<string, string> = {
  sales_order: 'orden de venta',
  invoice: 'factura',
  purchase_order: 'orden de compra',
  return_order: 'devolución',
  other: 'otro documento',
};

interface ToolLine {
  product_id: number;
  product_variant_id: number | null;
  quantity: number;
  batch_id: number | null;
}

interface ExternalDestination {
  name: string;
  tax_id?: string;
  address?: string;
  support_document_type?: string;
  support_document_id?: string;
  exit_reason?: string;
}

interface StockRow {
  product_id: number;
  product_variant_id: number | null;
  name: string;
  variant_name: string | null;
  sku: string | null;
  stock_at_origin: { quantity_available: number };
  stock_at_destination: { quantity_available: number };
}

function toolError(message: string, nextStep?: string, code?: string): string {
  return JSON.stringify({
    error: message,
    ...(nextStep ? { next_step: nextStep } : {}),
    ...(code ? { code } : {}),
  });
}

function previewError(target: string, message: string): ToolPreview {
  return { status: 'error', target, changes: [], message, domain: 'inventory' };
}

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
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
  return { message: 'No se pudo completar la operación.' };
}

/**
 * El servicio responde en inglés y con vocabulario de sistema (alcance, cross-store).
 * La persona ve la frase en español; el texto original queda como guía para el modelo.
 */
function humanizeServiceError(error: unknown): {
  code?: string;
  message: string;
  detail?: string;
} {
  const info = describeError(error);
  const raw = info.message ?? '';
  const known: Array<[RegExp, string]> = [
    [
      /cross-store stock transfers/i,
      'No puedes mover inventario entre tiendas desde el alcance de una sola tienda. Hazlo desde la organización.',
    ],
    [
      /organization context is required/i,
      'Necesitas elegir la organización desde la que trabajas.',
    ],
    [
      /source and destination locations must be different/i,
      'La bodega de origen y la de destino no pueden ser la misma.',
    ],
    [
      /insufficient stock/i,
      'No hay existencias suficientes en la bodega de origen para esa cantidad.',
    ],
  ];
  for (const [pattern, spanish] of known) {
    if (pattern.test(raw)) {
      return { code: info.code, message: spanish, detail: raw };
    }
  }
  // Los mensajes que ya escribe el dominio en español se muestran tal cual:
  // traducirlos perdería el detalle útil (producto, bodega, cantidades).
  const spanish =
    /[áéíóúñ¿¡]/i.test(raw) ||
    /\b(no|sin|falta|stock insuficiente|no hay|bodega|producto|permiso)\b/i.test(
      raw,
    );
  return {
    code: info.code,
    message: spanish || !raw ? raw : 'No se pudo completar el movimiento de inventario.',
    detail: raw,
  };
  return { message: 'Error desconocido' };
}

/** Normaliza y valida los argumentos comunes de preview y handler. */
export function parseTransferRequest(args: Record<string, any>):
  | {
      ok: true;
      mode: TransferToolMode;
      fromId: number;
      toId: number | null;
      lines: ToolLine[];
      external: ExternalDestination | null;
      withDispatchNotes: boolean;
    }
  | { ok: false; message: string } {
  const mode = String(args.mode ?? '') as TransferToolMode;
  if (!MODES.includes(mode)) {
    return {
      ok: false,
      message:
        'Dime si el movimiento se hace ahora entre tus bodegas o si se prepara como orden pendiente de aprobar.',
    };
  }

  const fromId = toPositiveInt(args.from_location_id);
  if (!fromId) {
    return { ok: false, message: 'Falta la bodega de origen.' };
  }

  const rawExternal = args.external_destination;
  const external: ExternalDestination | null =
    rawExternal && typeof rawExternal === 'object'
      ? {
          name: cleanText(rawExternal.name, 255) ?? '',
          tax_id: cleanText(rawExternal.tax_id, 50),
          address: cleanText(rawExternal.address, 1000),
          support_document_type: cleanText(
            rawExternal.support_document_type,
            40,
          ),
          support_document_id: cleanText(rawExternal.support_document_id, 100),
          exit_reason: cleanText(rawExternal.exit_reason, 1000),
        }
      : null;

  if (external) {
    // D9: el movimiento rápido solo opera entre bodegas propias.
    if (mode === 'quick') {
      return {
        ok: false,
        message:
          'El movimiento inmediato solo funciona entre tus propias bodegas. Un envío a un destino externo queda como orden pendiente, con remisión de salida.',
      };
    }
    if (!external.name) {
      return { ok: false, message: 'Falta el nombre del destino externo.' };
    }
    if (
      external.support_document_type &&
      !(TRANSFER_SUPPORT_DOCUMENT_TYPES as readonly string[]).includes(
        external.support_document_type,
      )
    ) {
      return {
        ok: false,
        message: 'Ese tipo de soporte no lo reconozco: dime si es orden de venta, factura, orden de compra, devolución u otro.',
      };
    }
  }

  const toId = external ? null : toPositiveInt(args.to_location_id);
  if (!external && !toId) {
    return { ok: false, message: 'Falta la bodega de destino.' };
  }
  if (toId && toId === fromId) {
    return {
      ok: false,
      message: 'La bodega de origen y la de destino no pueden ser la misma.',
    };
  }

  const documents = args.documents ?? 'none';
  if (!(DOCUMENT_MODES as readonly string[]).includes(String(documents))) {
    return {
      ok: false,
      message: 'Dime si el traslado lleva remisión de salida o no la lleva.',
    };
  }
  if (mode === 'quick' && documents === 'dispatch_notes') {
    return {
      ok: false,
      message:
        'El movimiento inmediato no genera remisiones. Si necesitas remisión, déjalo como orden pendiente.',
    };
  }

  const rawItems = Array.isArray(args.items) ? args.items : [];
  if (!rawItems.length) {
    return { ok: false, message: 'Agrega al menos un producto a mover.' };
  }
  if (rawItems.length > TRANSFER_TOOL_MAX_LINES) {
    return {
      ok: false,
      message: `Una orden admite hasta ${TRANSFER_TOOL_MAX_LINES} productos; divide el movimiento en varias.`,
    };
  }

  const lines: ToolLine[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    const productId = toPositiveInt(raw?.product_id);
    const quantity = Number(raw?.quantity);
    if (!productId) {
      return { ok: false, message: 'Hay una línea sin producto identificado.' };
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return {
        ok: false,
        message:
          'Las cantidades deben ser números enteros mayores que cero (unidades de inventario).',
      };
    }
    const variantId =
      raw?.product_variant_id === undefined || raw?.product_variant_id === null
        ? null
        : toPositiveInt(raw.product_variant_id);
    if (raw?.product_variant_id != null && !variantId) {
      return { ok: false, message: 'Hay una línea con una variante no válida.' };
    }
    const batchId =
      raw?.batch_id === undefined || raw?.batch_id === null
        ? null
        : toPositiveInt(raw.batch_id);
    if (raw?.batch_id != null && !batchId) {
      return { ok: false, message: 'Hay una línea con un lote no válido.' };
    }
    if (batchId && mode === 'quick') {
      return {
        ok: false,
        message:
          'El movimiento inmediato no elige lotes. Para escoger el lote por producto, déjalo como orden pendiente.',
      };
    }
    const line: ToolLine = {
      product_id: productId,
      product_variant_id: variantId,
      quantity,
      batch_id: batchId,
    };
    const key = transferLineKey(line);
    if (seen.has(key)) {
      return {
        ok: false,
        message:
          'Un mismo producto (y variante) aparece dos veces: junta las cantidades en una sola línea.',
      };
    }
    seen.add(key);
    lines.push(line);
  }

  return {
    ok: true,
    mode,
    fromId,
    toId,
    lines,
    external,
    // D8: una salida externa siempre lleva remisión de salida.
    withDispatchNotes: !!external || documents === 'dispatch_notes',
  };
}

function rowLabel(row: Pick<StockRow, 'name' | 'variant_name'>): string {
  return row.variant_name ? `${row.name} (${row.variant_name})` : row.name;
}

function findRow(rows: StockRow[], line: ToolLine): StockRow | undefined {
  return rows.find(
    (row) =>
      row.product_id === line.product_id &&
      (row.product_variant_id ?? null) === line.product_variant_id,
  );
}

async function locationNames(
  services: InventoryTransferToolServices,
): Promise<Map<number, string>> {
  const locations = await services.locationsService
    .findAll({ is_active: true, limit: 100 } as any)
    .catch(() => ({ data: [] }));
  return new Map(
    ((locations as any)?.data ?? []).map((loc: any) => [
      Number(loc.id),
      String(loc.name),
    ]),
  );
}

export function createInventoryTransferTools(
  services: InventoryTransferToolServices,
): RegisteredTool[] {
  return [
    // ─── find_transfer_products (READ) ─────────────────────────────────
    {
      name: 'find_transfer_products',
      version: '1',
      domain: 'inventory',
      readOnly: true,
      description:
        'Busca en una sola llamada varios productos que el usuario quiere mover entre bodegas (por nombre o SKU) y devuelve, para cada búsqueda, las filas producto + variante con lo disponible en la bodega de origen y en la de destino. Úsala antes de create_stock_transfer para obtener product_id y product_variant_id exactos; si una búsqueda trae varias variantes y el usuario no dijo cuál, pregúntale.',
      parameters: {
        type: 'object',
        properties: {
          from_location_id: {
            type: 'number',
            description: 'Bodega de origen (resuélvela con get_inventory_locations).',
          },
          to_location_id: {
            type: 'number',
            description:
              'Bodega de destino, para mostrar también su disponible (opcional).',
          },
          searches: {
            type: 'array',
            description: `Textos a buscar, uno por producto pedido (máximo ${MAX_SEARCHES}).`,
            items: { type: 'string' },
          },
        },
        required: ['from_location_id', 'searches'],
      },
      requiredPermissions: ['store:stock-transfers:read'],
      discovery: {
        synonyms: ['trasladar', 'pasar mercancía', 'mover entre bodegas'],
        dependencies: ['get_inventory_locations'],
      },
      handler: async (args) => {
        const fromId = toPositiveInt(args.from_location_id);
        if (!fromId) {
          return toolError(
            'Falta la bodega de origen.',
            'Resuelve la bodega de origen con get_inventory_locations.',
          );
        }
        const toId = toPositiveInt(args.to_location_id);
        const searches = (Array.isArray(args.searches) ? args.searches : [])
          .map((value: unknown) => cleanText(value, 120))
          .filter((value: string | undefined): value is string => !!value);
        if (!searches.length) {
          return toolError('Indica al menos un producto a buscar.');
        }
        if (searches.length > MAX_SEARCHES) {
          return toolError(
            `Puedo buscar hasta ${MAX_SEARCHES} productos por llamada.`,
            'Divide la búsqueda en grupos más pequeños.',
          );
        }
        try {
          const results = [] as Array<Record<string, unknown>>;
          for (const search of searches) {
            const rows = (await services.transfersService.searchTransferableProducts(
              search,
              fromId,
              // Sin destino (salida externa) se consulta el origen: el
              // disponible en destino se omite abajo.
              toId ?? fromId,
              10,
            )) as StockRow[];
            results.push({
              busqueda: search,
              coincidencias: rows.map((row) => ({
                product_id: row.product_id,
                product_variant_id: row.product_variant_id ?? null,
                producto: rowLabel(row),
                sku: row.sku ?? null,
                disponible_origen: Number(
                  row.stock_at_origin?.quantity_available ?? 0,
                ),
                ...(toId
                  ? {
                      disponible_destino: Number(
                        row.stock_at_destination?.quantity_available ?? 0,
                      ),
                    }
                  : {}),
              })),
            });
          }
          return JSON.stringify({ resultados: results });
        } catch (error) {
          const info = describeError(error);
          return toolError(
            info.message,
            'Verifica las bodegas con get_inventory_locations.',
            info.code,
          );
        }
      },
    },

    // ─── create_stock_transfer (WRITE) ─────────────────────────────────
    {
      name: 'create_stock_transfer',
      version: '1',
      domain: 'inventory',
      description:
        'Crea una transferencia de inventario con uno o varios productos (cada uno con su variante y cantidad) en una sola orden. mode=quick mueve el inventario al instante entre bodegas propias (resta en origen, suma en destino) y deja el registro de quién lo hizo; no admite destino externo, transporte, lotes ni remisiones. mode=draft prepara la orden pendiente de aprobar sin mover nada (documents=none para solo el movimiento masivo, dispatch_notes para remisión de salida y de entrada); es el único modo para un destino externo (external_destination), que siempre lleva remisión de salida. Resuelve bodegas con get_inventory_locations y productos/variantes con find_transfer_products antes de proponer. Para aprobar, despachar, recibir o cancelar una orden existente usa manage_stock_transfers.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: [...MODES],
            description:
              'quick: mover ya entre bodegas propias. draft: orden pendiente de aprobar.',
          },
          from_location_id: { type: 'number', description: 'Bodega de origen.' },
          to_location_id: {
            type: 'number',
            description: 'Bodega de destino (no aplica con destino externo).',
          },
          items: {
            type: 'array',
            description: `Productos a mover (máximo ${TRANSFER_TOOL_MAX_LINES}): product_id, product_variant_id si el producto maneja variantes, quantity en unidades enteras de inventario y batch_id opcional (solo draft).`,
            items: {
              type: 'object',
              properties: {
                product_id: { type: 'number' },
                product_variant_id: { type: 'number' },
                quantity: { type: 'number' },
                batch_id: { type: 'number' },
              },
              required: ['product_id', 'quantity'],
            },
          },
          documents: {
            type: 'string',
            enum: [...DOCUMENT_MODES],
            description:
              'Solo draft: none (solo movimiento masivo) o dispatch_notes (con remisiones). Por defecto none.',
          },
          external_destination: {
            type: 'object',
            description:
              'Solo draft: destino fuera de la organización (tercero o tienda ajena). Solo se registra la salida.',
            properties: {
              name: { type: 'string' },
              tax_id: { type: 'string' },
              address: { type: 'string' },
              support_document_type: {
                type: 'string',
                enum: [...TRANSFER_SUPPORT_DOCUMENT_TYPES],
              },
              support_document_id: { type: 'string' },
              exit_reason: { type: 'string' },
            },
          },
          expected_date: {
            type: 'string',
            description:
              'Solo draft: fecha límite de entrega (YYYY-MM-DD), opcional.',
          },
          notes: { type: 'string', description: 'Nota de la transferencia.' },
        },
        required: ['mode', 'from_location_id', 'items'],
      },
      requiredPermissions: ['store:stock-transfers:create'],
      requiresConfirmation: true,
      discovery: {
        synonyms: [
          'trasladar',
          'traslado',
          'pasar mercancía',
          'mover inventario',
          'mover entre bodegas',
          'transferencia masiva',
        ],
        dependencies: ['get_inventory_locations', 'find_transfer_products'],
      },
      preview: async (args, context) => {
        const target = 'Transferencia de inventario';
        if (!context.store_id && !context.organization_id) {
          return previewError(target, 'No hay una tienda activa.');
        }
        const parsed = parseTransferRequest(args);
        if (!parsed.ok) return previewError(target, parsed.message);

        try {
          const names = await locationNames(services);
          const from = names.get(parsed.fromId) ?? 'la bodega de origen';
          const to = parsed.external
            ? `${parsed.external.name} (destino externo)`
            : (names.get(parsed.toId!) ?? 'la bodega de destino');

          // Misma lectura que la vista avanzada: valida el alcance tienda u
          // organización (D7) y trae disponible en origen y destino por
          // producto + variante.
          const page = (await services.transfersService.getLocationStock(
            parsed.fromId,
            parsed.toId,
            null,
            500,
            [...new Set(parsed.lines.map((line) => line.product_id))],
          )) as { rows: StockRow[] };
          const rows = page?.rows ?? [];

          const changes: ToolPreview['changes'] = [
            { field: 'route', label: 'Ruta', from, to },
          ];
          let totalUnits = 0;
          for (const line of parsed.lines) {
            const row = findRow(rows, line);
            if (!row) {
              const withVariants =
                line.product_variant_id == null &&
                rows.some(
                  (r) =>
                    r.product_id === line.product_id &&
                    r.product_variant_id != null,
                );
              const sample = rows.find((r) => r.product_id === line.product_id);
              return previewError(
                `${target}: ${from} → ${to}`,
                withVariants
                  ? `${sample?.name ?? 'Uno de los productos'} maneja variantes: hay que elegir cuál se mueve.`
                  : `${sample ? rowLabel(sample) : 'Uno de los productos'} no tiene existencias en ${from}.`,
              );
            }
            const available = Number(row.stock_at_origin?.quantity_available ?? 0);
            if (available < line.quantity) {
              return previewError(
                `${target}: ${from} → ${to}`,
                `No alcanza ${rowLabel(row)} en ${from}: hay ${available} disponibles y se piden ${line.quantity}.`,
              );
            }
            totalUnits += line.quantity;
            const destination = Number(
              row.stock_at_destination?.quantity_available ?? 0,
            );
            changes.push({
              field: `line_${transferLineKey(line)}`,
              label: rowLabel(row),
              from: parsed.external
                ? `${available} en ${from}`
                : `${available} en ${from} · ${destination} en ${to}`,
              to:
                parsed.mode === 'quick'
                  ? `${available - line.quantity} en ${from} · ${destination + line.quantity} en ${to} (mueve ${line.quantity})`
                  : `${line.quantity} por enviar`,
            });
          }

          changes.push({
            field: 'summary',
            label: 'Total',
            from: null,
            to: `${parsed.lines.length} ${parsed.lines.length === 1 ? 'producto' : 'productos'}, ${totalUnits} unidades`,
          });

          if (parsed.mode === 'quick') {
            return {
              status: 'warning',
              target: `Mover ahora: ${from} → ${to}`,
              changes,
              message:
                'Al confirmar, el inventario se mueve de inmediato: se resta en el origen y se suma en el destino, y queda registrado quién lo hizo.',
              domain: 'inventory',
            };
          }

          changes.push({
            field: 'documents',
            label: 'Manejo',
            from: null,
            to: parsed.withDispatchNotes
              ? parsed.external
                ? 'Con remisión de salida (sin recepción)'
                : 'Con remisión de salida y de entrada'
              : 'Solo movimiento masivo, sin remisiones',
          });
          if (parsed.external) {
            const doc = parsed.external.support_document_type
              ? `${SUPPORT_DOCUMENT_LABELS[parsed.external.support_document_type] ?? 'documento'}${parsed.external.support_document_id ? ` ${parsed.external.support_document_id}` : ''}`
              : null;
            changes.push({
              field: 'support',
              label: 'Soporte de la salida',
              from: null,
              to: doc ?? parsed.external.exit_reason ?? 'sin documento ni motivo',
            });
          }
          const noSupport =
            !!parsed.external &&
            !parsed.external.support_document_type &&
            !parsed.external.exit_reason;
          return {
            status: noSupport ? 'warning' : 'ok',
            target: `Orden pendiente: ${from} → ${to}`,
            changes,
            message: noSupport
              ? 'La salida a un destino externo sin documento ni motivo queda marcada con alerta. Todavía no se mueve inventario: la orden queda pendiente de aprobar y despachar.'
              : 'Todavía no se mueve inventario: la orden queda pendiente de aprobar y despachar desde Inventario → Transferencias.',
            domain: 'inventory',
          };
        } catch (error) {
          return previewError(target, humanizeServiceError(error).message);
        }
      },
      handler: async (args) => {
        // El preview es una proyección: se re-valida todo y el servicio vuelve
        // a comprobar alcance y disponible dentro de su transacción.
        const parsed = parseTransferRequest(args);
        if (!parsed.ok) return toolError(parsed.message);

        const notes = cleanText(args.notes, 1000);
        const expected =
          parsed.mode === 'draft' && typeof args.expected_date === 'string'
            ? new Date(args.expected_date)
            : undefined;
        if (typeof args.expected_date === 'string' && parsed.mode === 'draft') {
          const raw = args.expected_date.trim();
          const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
          const real =
            !!match &&
            (() => {
              const [, y, m, d] = match;
              const date = new Date(`${y}-${m}-${d}T00:00:00Z`);
              return (
                date.getUTCFullYear() === Number(y) &&
                date.getUTCMonth() + 1 === Number(m) &&
                date.getUTCDate() === Number(d)
              );
            })();
          if (!real) {
            return toolError(
              'La fecha límite no es válida: usa una fecha real en formato AAAA-MM-DD.',
            );
          }
        }

        const plain: Record<string, unknown> = {
          from_location_id: parsed.fromId,
          ...(parsed.toId ? { to_location_id: parsed.toId } : {}),
          items: parsed.lines.map((line) => ({
            product_id: line.product_id,
            ...(line.product_variant_id
              ? { product_variant_id: line.product_variant_id }
              : {}),
            ...(line.batch_id ? { batch_id: line.batch_id } : {}),
            quantity: line.quantity,
          })),
          ...(notes ? { notes } : {}),
          ...(expected ? { expected_date: expected } : {}),
        };
        if (parsed.mode === 'quick') {
          plain.movement_mode = 'quick';
        } else {
          plain.movement_mode = parsed.withDispatchNotes
            ? 'with_dispatch_notes'
            : 'mass_only';
          if (parsed.external) {
            const ext = parsed.external;
            Object.assign(plain, {
              is_external_destination: true,
              external_destination_name: ext.name,
              ...(ext.tax_id && { external_destination_tax_id: ext.tax_id }),
              ...(ext.address && {
                external_destination_address: ext.address,
              }),
              ...(ext.support_document_type && {
                support_document_type: ext.support_document_type,
              }),
              ...(ext.support_document_id && {
                support_document_id: ext.support_document_id,
              }),
              ...(ext.exit_reason && { exit_reason: ext.exit_reason }),
            });
          }
        }

        const dto = plainToInstance(CreateTransferDto, plain, {
          enableImplicitConversion: true,
        });
        const errors = validateSync(dto, {
          whitelist: true,
          forbidNonWhitelisted: true,
        });
        if (errors.length) {
          const details = errors
            .flatMap((entry) => [
              ...Object.values(entry.constraints ?? {}),
              ...(entry.children ?? []).flatMap((child) =>
                Object.values(child.constraints ?? {}),
              ),
            ])
            .join('; ');
          return toolError(
            `Los datos de la transferencia no son válidos: ${details || 'revisa los productos y las bodegas'}.`,
          );
        }

        try {
          const result =
            parsed.mode === 'quick'
              ? await services.transfersService.createAndComplete(dto)
              : await services.transfersService.create(dto);
          const transfer = result as any;
          const number = transfer?.transfer_number ?? null;
          const numberText = number ? ` ${number}` : '';
          const units = parsed.lines.reduce((sum, l) => sum + l.quantity, 0);
          const products = `${parsed.lines.length} ${parsed.lines.length === 1 ? 'producto' : 'productos'}`;
          return JSON.stringify({
            resumen:
              parsed.mode === 'quick'
                ? `Transferencia${numberText} aplicada: se movieron ${units} unidades de ${products}.`
                : `Orden de transferencia${numberText} creada y pendiente de aprobar: todavía no se movió inventario.`,
            transfer_id: transfer?.id ?? null,
            transfer_number: number,
            // No inventar estado: si el servicio no lo devuelve, se omite.
            ...(transfer?.status ? { status: transfer.status } : {}),
            modo: parsed.mode === 'quick' ? 'inmediato' : 'orden pendiente',
            unidades: units,
            productos: parsed.lines.length,
            ...(parsed.mode === 'draft'
              ? {
                  siguiente_paso:
                    'La orden se aprueba y despacha desde Inventario → Transferencias.',
                }
              : {}),
          });
        } catch (error) {
          const info = humanizeServiceError(error);
          return toolError(
            info.message,
            'Revisa el disponible con find_transfer_products y vuelve a proponer; no repitas el movimiento sin confirmar que no quedó aplicado.',
            info.code,
          );
        }
      },
    },
  ];
}
