import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Piezas compartidas del P2 de transferencias (D2–D9): transporte, vehículo
 * inline, lote por fila, remisiones ligadas (`transfer_out` / `transfer_in`),
 * destino externo y regla de la alerta por falta de documento soporte.
 *
 * Todo corre dentro de la transacción del servicio que llama (`tx`): las
 * remisiones se crean en la MISMA transacción que mueve el stock, así que si
 * algo falla no queda documento huérfano (ni stock movido sin remisión).
 *
 * No se usa `DispatchNotesService.createTransfer` porque ese método escribe con
 * su propio cliente Prisma y exige contexto de tienda; acá la transferencia
 * puede ser de organización (cross-store) y el documento tiene que ser parte de
 * la transacción. Se replican sus invariantes esenciales: dirección/subtipo
 * válidos, numeración `REM…` por tienda y `store_id` resuelto.
 */

export const TRANSFER_MOVEMENT_MODES = [
  'quick',
  'mass_only',
  'with_dispatch_notes',
] as const;

export const TRANSFER_TRANSPORT_METHODS = [
  'none',
  'internal_carrier',
  'internal_vehicle',
  'internal_shipping_method',
  'external_shipping_method',
] as const;

export const TRANSFER_SUPPORT_DOCUMENT_TYPES = [
  'sales_order',
  'invoice',
  'purchase_order',
  'return',
  'other',
] as const;

export type TransferMovementMode =
  (typeof TRANSFER_MOVEMENT_MODES)[number];
export type TransferTransportMethod =
  (typeof TRANSFER_TRANSPORT_METHODS)[number];
export type TransferSupportDocumentType =
  (typeof TRANSFER_SUPPORT_DOCUMENT_TYPES)[number];

export interface InlineVehicleInput {
  plate: string;
  type?: string | null;
  brand?: string | null;
  model_name?: string | null;
  capacity_kg?: number | null;
  capacity_units?: number | null;
  primary_driver_id?: number | null;
  notes?: string | null;
}

export interface TransferTransportInput {
  transport_method?: TransferTransportMethod | null;
  vehicle_id?: number | null;
  vehicle?: InlineVehicleInput | null;
  driver_user_id?: number | null;
  driver_name?: string | null;
  shipping_method_id?: number | null;
  carrier_name?: string | null;
  tracking_number?: string | null;
  shipping_cost?: number | null;
}

export interface TransferTransportContext {
  /** Tienda de la bodega de origen (null si es bodega central de la org). */
  store_id: number | null;
  user_id?: number | null;
}

export interface ResolvedTransferTransport {
  transport_method: TransferTransportMethod | null;
  vehicle_id: number | null;
  driver_user_id: number | null;
  driver_name: string | null;
  shipping_method_id: number | null;
  carrier_name: string | null;
  tracking_number: string | null;
  shipping_cost: number;
}

const EMPTY_TRANSPORT: Omit<ResolvedTransferTransport, 'shipping_cost'> = {
  transport_method: null,
  vehicle_id: null,
  driver_user_id: null,
  driver_name: null,
  shipping_method_id: null,
  carrier_name: null,
  tracking_number: null,
};

export function cleanText(value?: string | null): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
}

/** Anexa una nota sin pisar la existente (mismo patrón que la organización). */
export function appendTransferNote(
  existing: string | null | undefined,
  addition?: string | null,
): string | null {
  const text = cleanText(addition);
  if (!text) return existing ?? null;
  return existing ? `${existing}\n${text}` : text;
}

export interface DispatchPlanEntry {
  line: any;
  quantity_dispatched: number;
  batch_id: number | null;
}

/**
 * Conteo de salida por línea (D3). Sin `items` se despacha la cantidad pedida;
 * con `items` cada línea puede salir completa, parcial o en cero. Una línea
 * repetida o ajena a la transferencia se rechaza antes de tocar stock.
 */
export function buildDispatchPlan(
  lines: any[],
  requested?: Array<{
    id: number;
    quantity_dispatched?: number;
    batch_id?: number;
  }>,
): DispatchPlanEntry[] {
  const lineById = new Map<number, any>(lines.map((line) => [line.id, line]));
  const requestedById = new Map<
    number,
    { quantity_dispatched?: number; batch_id?: number }
  >();

  for (const item of requested ?? []) {
    if (requestedById.has(item.id)) {
      throw new BadRequestException(
        `La línea #${item.id} está repetida en el despacho`,
      );
    }
    if (!lineById.has(item.id)) {
      throw new BadRequestException(
        `La línea #${item.id} no pertenece a esta transferencia`,
      );
    }
    requestedById.set(item.id, item);
  }

  const plan = lines.map((line) => {
    const requestedLine = requestedById.get(line.id);
    const quantity = requestedLine?.quantity_dispatched ?? line.quantity;
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new BadRequestException(
        `La cantidad despachada de la línea #${line.id} debe ser un entero mayor o igual a cero`,
      );
    }
    if (quantity > line.quantity) {
      throw new BadRequestException(
        `No puedes despachar ${quantity} de la línea #${line.id}: se pidieron ${line.quantity}`,
      );
    }
    return {
      line,
      quantity_dispatched: quantity,
      batch_id: requestedLine?.batch_id ?? line.batch_id ?? null,
    };
  });

  if (plan.every((entry) => entry.quantity_dispatched === 0)) {
    throw new BadRequestException(
      'No hay unidades para despachar: todas las líneas quedaron en cero',
    );
  }

  return plan;
}

/** Costo de transporte: solo registro (D6), nunca toca el costo del stock. */
export function normalizeShippingCost(value?: number | null): number {
  if (value == null) return 0;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new BadRequestException(
      'El costo de transporte no puede ser negativo',
    );
  }
  return Math.round(amount * 100) / 100;
}

/**
 * Resuelve el vehículo de la transferencia. Si llega un id, se valida que sea
 * de la tienda; si llega `vehicle` inline (sin id), se crea en `vehicles` de la
 * misma tienda y, si la placa ya existe, se reutiliza (D6).
 */
export async function resolveTransferVehicle(
  tx: any,
  storeId: number | null,
  input: {
    vehicle_id?: number | null;
    vehicle?: InlineVehicleInput | null;
  },
): Promise<number> {
  if (input.vehicle_id != null) {
    const vehicle = await tx.vehicles.findFirst({
      where: { id: input.vehicle_id },
      select: { id: true, store_id: true },
    });
    if (!vehicle) {
      throw new BadRequestException(
        `El vehículo #${input.vehicle_id} no existe`,
      );
    }
    if (storeId != null && vehicle.store_id !== storeId) {
      throw new BadRequestException(
        'El vehículo seleccionado pertenece a otra tienda',
      );
    }
    return vehicle.id;
  }

  const inline = input.vehicle;
  if (!inline?.plate?.trim()) {
    throw new BadRequestException(
      'Elige un vehículo o escribe la placa para registrarlo',
    );
  }
  if (storeId == null) {
    throw new BadRequestException(
      'El vehículo se registra por tienda: la bodega de origen debe pertenecer a una tienda',
    );
  }

  const plate = inline.plate.trim().toUpperCase();
  if (plate.length > 20) {
    throw new BadRequestException(
      'La placa del vehículo no puede tener más de 20 caracteres',
    );
  }

  const existing = await tx.vehicles.findUnique({
    where: { store_id_plate: { store_id: storeId, plate } },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await tx.vehicles.create({
    data: {
      store_id: storeId,
      plate,
      ...(inline.type ? { type: inline.type as any } : {}),
      ...(cleanText(inline.brand)
        ? { brand: cleanText(inline.brand) }
        : {}),
      ...(cleanText(inline.model_name)
        ? { model_name: cleanText(inline.model_name) }
        : {}),
      ...(inline.capacity_kg != null
        ? { capacity_kg: new Prisma.Decimal(inline.capacity_kg) }
        : {}),
      ...(inline.capacity_units != null
        ? { capacity_units: inline.capacity_units }
        : {}),
      ...(inline.primary_driver_id != null
        ? { primary_driver_id: inline.primary_driver_id }
        : {}),
      ...(cleanText(inline.notes) ? { notes: cleanText(inline.notes) } : {}),
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Valida y normaliza el bloque de transporte según el método elegido (D6).
 * El costo de transporte es opcional y por defecto 0: es un dato logístico,
 * no una revalorización del inventario.
 */
export async function resolveTransferTransport(
  tx: any,
  input: TransferTransportInput,
  context: TransferTransportContext,
): Promise<ResolvedTransferTransport> {
  const base: ResolvedTransferTransport = {
    ...EMPTY_TRANSPORT,
    shipping_cost: normalizeShippingCost(input.shipping_cost),
  };

  const method = input.transport_method ?? null;
  if (method == null || method === 'none') {
    return base;
  }

  switch (method) {
    case 'internal_vehicle': {
      const vehicle_id = await resolveTransferVehicle(tx, context.store_id, {
        vehicle_id: input.vehicle_id,
        vehicle: input.vehicle,
      });
      return {
        ...base,
        transport_method: method,
        vehicle_id,
        driver_user_id: input.driver_user_id ?? null,
        driver_name: cleanText(input.driver_name),
      };
    }

    case 'internal_carrier': {
      let driver_user_id = input.driver_user_id ?? null;
      let driver_name = cleanText(input.driver_name);

      if (driver_user_id == null && driver_name == null) {
        throw new BadRequestException(
          'Selecciona al conductor o escribe su nombre',
        );
      }

      if (driver_user_id != null) {
        const driver = await tx.users.findFirst({
          where: { id: driver_user_id },
          select: { id: true, first_name: true, last_name: true },
        });
        if (!driver) {
          throw new BadRequestException(
            `El conductor #${driver_user_id} no existe`,
          );
        }
        if (driver_name == null) {
          driver_name =
            `${driver.first_name ?? ''} ${driver.last_name ?? ''}`.trim() ||
            null;
        }
      }

      return {
        ...base,
        transport_method: method,
        driver_user_id,
        driver_name,
      };
    }

    case 'internal_shipping_method':
    case 'external_shipping_method': {
      const carrierName = cleanText(input.carrier_name);

      if (input.shipping_method_id == null) {
        if (method === 'external_shipping_method' && carrierName) {
          return {
            ...base,
            transport_method: method,
            carrier_name: carrierName,
            tracking_number: cleanText(input.tracking_number),
          };
        }
        throw new BadRequestException(
          'Selecciona el método de envío (transportadora) o escribe su nombre',
        );
      }

      const shippingMethod = await tx.shipping_methods.findFirst({
        where: { id: input.shipping_method_id },
        select: { id: true, name: true, store_id: true, is_active: true },
      });
      if (!shippingMethod || shippingMethod.is_active === false) {
        throw new BadRequestException(
          `El método de envío #${input.shipping_method_id} no existe o está inactivo`,
        );
      }
      if (
        context.store_id != null &&
        shippingMethod.store_id != null &&
        shippingMethod.store_id !== context.store_id
      ) {
        throw new BadRequestException(
          'El método de envío seleccionado pertenece a otra tienda',
        );
      }

      return {
        ...base,
        transport_method: method,
        shipping_method_id: shippingMethod.id,
        carrier_name:
          method === 'external_shipping_method'
            ? (carrierName ?? shippingMethod.name)
            : carrierName,
        tracking_number: cleanText(input.tracking_number),
      };
    }

    default:
      throw new BadRequestException(
        `Método de transporte no válido: ${String(method)}`,
      );
  }
}

/**
 * D8 — alerta de salida externa sin documento soporte NI motivo. No bloquea:
 * se marca en la transferencia y en la remisión para que quede visible.
 */
export function computeNoSupportAlert(params: {
  is_external_destination?: boolean | null;
  support_document_type?: string | null;
  exit_reason?: string | null;
}): boolean {
  if (!params.is_external_destination) return false;
  return (
    cleanText(params.support_document_type) == null &&
    cleanText(params.exit_reason) == null
  );
}

/**
 * D4 — el saldo pendiente solo puede cerrarse como pérdida cuando ya pasó la
 * fecha límite de entrega. Se compara contra el FIN DEL DÍA UTC de
 * `expected_date` para que "vence hoy" todavía no permita cerrar.
 */
export function hasDeliveryDeadlinePassed(
  expectedDate: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!expectedDate) return false;
  const deadline = Date.UTC(
    expectedDate.getUTCFullYear(),
    expectedDate.getUTCMonth(),
    expectedDate.getUTCDate(),
    23,
    59,
    59,
    999,
  );
  return now.getTime() > deadline;
}

/** Unidades que realmente salieron del origen (D3). NULL = fila histórica. */
export function dispatchedQuantity(line: {
  quantity: number;
  quantity_dispatched?: number | null;
}): number {
  return line.quantity_dispatched ?? line.quantity;
}

/** Saldo pendiente de recibir o dar de baja (no incluye lo ya perdido). */
export function pendingQuantity(line: {
  quantity: number;
  quantity_dispatched?: number | null;
  quantity_received: number;
  quantity_lost?: number | null;
}): number {
  return Math.max(
    0,
    dispatchedQuantity(line) -
      Number(line.quantity_received ?? 0) -
      Number(line.quantity_lost ?? 0),
  );
}

/**
 * Lote de una línea. Si el usuario eligió uno, se valida producto/variante y
 * bodega; si no, se elige el más antiguo con saldo (FEFO: primero el que
 * vence antes; sin fecha de vencimiento, el creado antes), que es el criterio
 * que ya usa `InventoryBatchesService` para ordenar lotes. No existía una
 * configuración FIFO/FEFO por tienda, así que se adopta FEFO (D5).
 *
 * Nota de alcance: el lote queda ligado a la fila, pero este PR no descuenta
 * `inventory_batches.quantity_used` — ningún flujo de stock lo hace hoy
 * (ventas incluidas). Llevar el saldo por lote es una decisión de producto
 * aparte.
 */
export async function resolveLineBatch(
  tx: any,
  line: {
    product_id: number;
    product_variant_id?: number | null;
  },
  fromLocationId: number,
  explicitBatchId?: number | null,
  options: { defaultToFefo?: boolean } = {},
): Promise<number | null> {
  if (explicitBatchId != null) {
    const batch = await tx.inventory_batches.findFirst({
      where: { id: explicitBatchId },
      select: {
        id: true,
        product_id: true,
        product_variant_id: true,
        location_id: true,
      },
    });
    if (!batch) {
      throw new BadRequestException(`El lote #${explicitBatchId} no existe`);
    }
    if (
      batch.product_id !== line.product_id ||
      (batch.product_variant_id ?? null) !==
        (line.product_variant_id ?? null)
    ) {
      throw new BadRequestException(
        `El lote #${explicitBatchId} no corresponde al producto de la línea`,
      );
    }
    if (batch.location_id != null && batch.location_id !== fromLocationId) {
      throw new BadRequestException(
        `El lote #${explicitBatchId} no está en la bodega de origen`,
      );
    }
    return batch.id;
  }

  if (options.defaultToFefo === false) return null;

  const candidates = await tx.inventory_batches.findMany({
    where: {
      product_id: line.product_id,
      product_variant_id: line.product_variant_id ?? null,
      OR: [{ location_id: fromLocationId }, { location_id: null }],
    },
    select: {
      id: true,
      quantity: true,
      quantity_used: true,
    },
    orderBy: [{ expiration_date: 'asc' }, { created_at: 'asc' }],
    take: 25,
  });

  const oldestWithStock = candidates.find(
    (batch: any) =>
      Number(batch.quantity ?? 0) - Number(batch.quantity_used ?? 0) > 0,
  );
  return oldestWithStock?.id ?? null;
}

/**
 * Tienda a la que pertenece la remisión. El documento se numera por tienda, así
 * que se usa la del origen y, si es bodega central de la organización, la del
 * destino. Sin ninguna de las dos no hay secuencia posible.
 */
export function resolveTransferNoteStoreId(
  fromStoreId: number | null | undefined,
  toStoreId: number | null | undefined,
): number {
  const storeId = fromStoreId ?? toStoreId;
  if (storeId == null) {
    throw new BadRequestException(
      'La remisión se numera por tienda: la bodega de origen o la de destino debe pertenecer a una tienda',
    );
  }
  return storeId;
}

async function nextDispatchNumber(
  tx: any,
  storeId: number,
): Promise<string> {
  const now = new Date();
  const year = now.getFullYear().toString().slice(-2);
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  const prefix = `REM${year}${month}${day}`;

  const last = await tx.dispatch_notes.findFirst({
    where: { store_id: storeId, dispatch_number: { startsWith: prefix } },
    orderBy: { dispatch_number: 'desc' },
    select: { dispatch_number: true },
  });

  let sequence = 1;
  if (last?.dispatch_number) {
    const parsed = parseInt(last.dispatch_number.slice(-4), 10);
    if (Number.isFinite(parsed)) sequence = parsed + 1;
  }
  return `${prefix}${String(sequence).padStart(4, '0')}`;
}

export interface TransferNoteLineInput {
  product_id: number;
  product_variant_id?: number | null;
  quantity: number;
  unit_price?: number | null;
  /** Texto libre del lote en la remisión (el modelo no tiene batch_id acá). */
  lot_serial?: string | null;
}

export interface CreateTransferNoteParams {
  store_id: number;
  direction: 'outbound' | 'inbound';
  subtype: 'transfer_out' | 'transfer_in';
  from_location_id: number;
  to_location_id: number | null;
  items: TransferNoteLineInput[];
  notes?: string | null;
  internal_notes?: string | null;
  /** Destino externo: viaja como nombre/documento/dirección de la remisión. */
  external?: {
    name?: string | null;
    tax_id?: string | null;
    address?: string | null;
  } | null;
  emission_date?: Date;
  user_id?: number | null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

/**
 * Crea una remisión en la transacción de la transferencia. `transfer_out` va
 * con el conteo de salida al despachar; `transfer_in` con el conteo de entrada
 * al recibir. Se emite en `draft` a propósito: marcar `delivered` dispararía el
 * listener de despacho y descontaría stock por segunda vez.
 */
export async function createTransferNoteInTx(
  tx: any,
  params: CreateTransferNoteParams,
): Promise<{ id: number; dispatch_number: string }> {
  if (params.items.length === 0) {
    throw new BadRequestException(
      'La remisión necesita al menos una línea con unidades',
    );
  }

  const subtotal = params.items.reduce(
    (sum, item) =>
      sum + Number(item.unit_price ?? 0) * Number(item.quantity ?? 0),
    0,
  );

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const dispatch_number = await nextDispatchNumber(tx, params.store_id);
    try {
      return await tx.dispatch_notes.create({
        data: {
          store_id: params.store_id,
          dispatch_number,
          status: 'draft',
          direction: params.direction,
          subtype: params.subtype,
          customer_id: null,
          customer_name: cleanText(params.external?.name),
          customer_tax_id: cleanText(params.external?.tax_id),
          ...(cleanText(params.external?.address)
            ? {
                customer_address: {
                  address: cleanText(params.external?.address),
                },
              }
            : {}),
          from_location_id: params.from_location_id,
          to_location_id: params.to_location_id,
          dispatch_location_id:
            params.direction === 'outbound'
              ? params.from_location_id
              : params.to_location_id,
          emission_date: params.emission_date ?? new Date(),
          subtotal_amount: subtotal,
          discount_amount: 0,
          tax_amount: 0,
          grand_total: subtotal,
          currency: 'COP',
          notes: cleanText(params.notes),
          internal_notes: cleanText(params.internal_notes),
          created_by_user_id: params.user_id ?? null,
          updated_at: new Date(),
          dispatch_note_items: {
            create: params.items.map((item) => ({
              product_id: item.product_id,
              product_variant_id: item.product_variant_id ?? null,
              location_id:
                params.direction === 'outbound'
                  ? params.from_location_id
                  : params.to_location_id,
              ordered_quantity: item.quantity,
              dispatched_quantity: item.quantity,
              unit_price: item.unit_price ?? 0,
              discount_amount: 0,
              tax_amount: 0,
              total_price:
                Number(item.unit_price ?? 0) * Number(item.quantity ?? 0),
              lot_serial: cleanText(item.lot_serial),
            })),
          },
        },
        select: { id: true, dispatch_number: true },
      });
    } catch (error) {
      lastError = error;
      if (!isUniqueViolation(error)) throw error;
    }
  }

  throw new ConflictException(
    `No se pudo generar un número de remisión único después de varios intentos${
      lastError instanceof Error ? `: ${lastError.message}` : ''
    }`,
  );
}

/**
 * Remisión de entrada: UNA sola por transferencia, actualizada con cada
 * recepción. Se eligió así porque `stock_transfers.receipt_note_id` es una FK
 * única y el comerciante espera un solo documento de recibido; las cantidades
 * van acumulando el conteo de entrada de cada recepción parcial (D3/D4).
 */
export async function accumulateTransferReceiptNoteInTx(
  tx: any,
  params: CreateTransferNoteParams & { existing_note_id: number | null },
): Promise<number> {
  if (params.existing_note_id == null) {
    const note = await createTransferNoteInTx(tx, params);
    return note.id;
  }

  const note = await tx.dispatch_notes.findFirst({
    where: { id: params.existing_note_id },
    include: { dispatch_note_items: true },
  });
  if (!note) {
    // La FK es SetNull: si el documento se borró, se emite uno nuevo en vez de
    // perder el conteo de entrada.
    const created = await createTransferNoteInTx(tx, params);
    return created.id;
  }

  for (const line of params.items) {
    const existing = note.dispatch_note_items.find(
      (item: any) =>
        item.product_id === line.product_id &&
        (item.product_variant_id ?? null) ===
          (line.product_variant_id ?? null),
    );
    if (existing) {
      const quantity =
        Number(existing.dispatched_quantity ?? 0) + Number(line.quantity);
      await tx.dispatch_note_items.update({
        where: { id: existing.id },
        data: {
          dispatched_quantity: quantity,
          total_price:
            Number(existing.unit_price ?? 0) * Number(quantity ?? 0),
        },
      });
    } else {
      await tx.dispatch_note_items.create({
        data: {
          dispatch_note_id: note.id,
          product_id: line.product_id,
          product_variant_id: line.product_variant_id ?? null,
          location_id: params.to_location_id,
          ordered_quantity: line.quantity,
          dispatched_quantity: line.quantity,
          unit_price: line.unit_price ?? 0,
          discount_amount: 0,
          tax_amount: 0,
          total_price: Number(line.unit_price ?? 0) * Number(line.quantity),
          lot_serial: cleanText(line.lot_serial),
        },
      });
    }
  }

  const items = await tx.dispatch_note_items.findMany({
    where: { dispatch_note_id: note.id },
    select: { dispatched_quantity: true, unit_price: true },
  });
  const subtotal = items.reduce(
    (sum: number, item: any) =>
      sum +
      Number(item.unit_price ?? 0) * Number(item.dispatched_quantity ?? 0),
    0,
  );

  await tx.dispatch_notes.update({
    where: { id: note.id },
    data: {
      subtotal_amount: subtotal,
      grand_total: subtotal,
      updated_at: new Date(),
    },
  });

  return note.id;
}

/**
 * Texto que deja rastro de la alerta D8 dentro de la remisión, sin migrar el
 * modelo de remisiones: `internal_notes` es el campo que ya usa el equipo para
 * advertencias internas.
 */
export function noSupportAlertNote(): string {
  return 'Salida de inventario sin documento soporte ni motivo: revisar antes de entregar.';
}
