import {
  TransferDraftLine,
  TransferPickerRow,
  lineHasValidQuantity,
  pickerRowKey,
  pickerRowToLine,
  transferLineKey,
} from '../quick-move/transfer-draft';

/**
 * Lógica pura de la orden avanzada de transferencias (P3), común a tienda y
 * organización. Sin Angular: se prueba sola y la usan la vista dedicada y el
 * panel de despacho/recepción del detalle.
 *
 * Decisiones (plan §4): D3 modo con o sin remisiones, D4 cierre con pérdida
 * solo tras la fecha límite, D5 lote por fila (por defecto el más antiguo),
 * D6 transporte con costo opcional en 0, D8 destino externo con alerta si sale
 * sin documento ni motivo.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type AdvancedMovementMode = 'mass_only' | 'with_dispatch_notes';

export type AdvancedTransportMethod =
  | 'none'
  | 'internal_carrier'
  | 'internal_vehicle'
  | 'internal_shipping_method'
  | 'external_shipping_method';

export type SupportDocumentType =
  | 'sales_order'
  | 'invoice'
  | 'purchase_order'
  | 'return'
  | 'other';

export const SUPPORT_DOCUMENT_OPTIONS: Array<{
  value: SupportDocumentType;
  label: string;
}> = [
  { value: 'sales_order', label: 'Orden de venta' },
  { value: 'invoice', label: 'Factura' },
  { value: 'purchase_order', label: 'Orden de compra' },
  { value: 'return', label: 'Devolución' },
  { value: 'other', label: 'Otro documento' },
];

export const TRANSPORT_METHOD_OPTIONS: Array<{
  value: AdvancedTransportMethod;
  label: string;
}> = [
  { value: 'none', label: 'Sin transporte' },
  { value: 'internal_carrier', label: 'Transportador interno' },
  { value: 'internal_vehicle', label: 'Vehículo propio' },
  { value: 'internal_shipping_method', label: 'Forma de envío propia' },
  { value: 'external_shipping_method', label: 'Transportadora externa' },
];

export const VEHICLE_TYPE_OPTIONS = [
  { value: 'truck', label: 'Camión' },
  { value: 'van', label: 'Furgoneta' },
  { value: 'car', label: 'Carro' },
  { value: 'motorcycle', label: 'Moto' },
  { value: 'bicycle', label: 'Bicicleta' },
  { value: 'other', label: 'Otro' },
];

/** Lote de un producto en la bodega de origen (`GET .../batches`). */
export interface TransferBatchOption {
  id: number;
  product_id: number;
  product_variant_id: number | null;
  batch_number: string;
  expiration_date: string | null;
  available: number;
}

/** Opciones del origen (`GET .../advanced-options`). */
export interface TransferAdvancedOptions {
  vehicles: Array<{
    id: number;
    plate: string;
    type: string | null;
    brand: string | null;
    model_name: string | null;
    primary_driver_id: number | null;
  }>;
  drivers: Array<{ id: number; name: string }>;
  shipping_methods: Array<{
    id: number;
    name: string;
    type: string;
    provider_name: string | null;
    scope: 'internal' | 'external';
  }>;
  categories: Array<{ id: number; name: string }>;
}

export const EMPTY_ADVANCED_OPTIONS: TransferAdvancedOptions = {
  vehicles: [],
  drivers: [],
  shipping_methods: [],
  categories: [],
};

/** Línea de la orden avanzada: la del modal rápido más el lote (D5). */
export interface AdvancedLine extends TransferDraftLine {
  /** `null` = el despacho toma el más antiguo con saldo. */
  batch_id: number | null;
}

export interface AdvancedTransportForm {
  method: AdvancedTransportMethod;
  driver_user_id: number | null;
  driver_name: string;
  vehicle_id: number | null;
  /** Alta inline: si hay placa y no se eligió vehículo, se registra. */
  new_vehicle_plate: string;
  new_vehicle_type: string;
  shipping_method_id: number | null;
  carrier_name: string;
  tracking_number: string;
  shipping_cost: number | null;
}

export interface AdvancedExternalForm {
  name: string;
  tax_id: string;
  address: string;
  support_document_type: SupportDocumentType | '';
  support_document_id: string;
  exit_reason: string;
}

export interface AdvancedOrderForm {
  mode: AdvancedMovementMode;
  from_location_id: number | null;
  to_location_id: number | null;
  is_external: boolean;
  external: AdvancedExternalForm;
  transport: AdvancedTransportForm;
  /** `YYYY-MM-DD` (fecha límite de entrega). */
  expected_date: string;
  notes: string;
  lines: AdvancedLine[];
}

/** Payload de `POST` (tienda u organización) para crear la orden avanzada. */
export interface AdvancedTransferPayload {
  from_location_id: number;
  to_location_id?: number;
  movement_mode: AdvancedMovementMode;
  expected_date?: string;
  notes?: string;
  is_external_destination?: boolean;
  external_destination_name?: string;
  external_destination_tax_id?: string;
  external_destination_address?: string;
  support_document_type?: SupportDocumentType;
  support_document_id?: string;
  exit_reason?: string;
  transport_method?: AdvancedTransportMethod;
  driver_user_id?: number;
  driver_name?: string;
  vehicle_id?: number;
  vehicle?: { plate: string; type?: string };
  shipping_method_id?: number;
  carrier_name?: string;
  tracking_number?: string;
  shipping_cost?: number;
  items: Array<{
    product_id: number;
    product_variant_id?: number;
    batch_id?: number;
    quantity: number;
  }>;
}

export function emptyAdvancedForm(): AdvancedOrderForm {
  return {
    mode: 'with_dispatch_notes',
    from_location_id: null,
    to_location_id: null,
    is_external: false,
    external: {
      name: '',
      tax_id: '',
      address: '',
      support_document_type: '',
      support_document_id: '',
      exit_reason: '',
    },
    transport: {
      method: 'none',
      driver_user_id: null,
      driver_name: '',
      vehicle_id: null,
      new_vehicle_plate: '',
      new_vehicle_type: 'truck',
      shipping_method_id: null,
      carrier_name: '',
      tracking_number: '',
      shipping_cost: 0,
    },
    expected_date: '',
    notes: '',
    lines: [],
  };
}

// ---------------------------------------------------------------------------
// Modo y destino externo (D3 / D8)
// ---------------------------------------------------------------------------

/**
 * D8 — una salida a destino externo solo existe con remisión: el backend la
 * rechaza en `mass_only`. Al marcar el destino como externo el modo se fuerza.
 */
export function effectiveMode(form: {
  mode: AdvancedMovementMode;
  is_external: boolean;
}): AdvancedMovementMode {
  return form.is_external ? 'with_dispatch_notes' : form.mode;
}

/** D8 — sale de la organización sin documento soporte NI motivo. */
export function needsSupportAlert(form: {
  is_external: boolean;
  external: Pick<AdvancedExternalForm, 'support_document_type' | 'exit_reason'>;
}): boolean {
  if (!form.is_external) return false;
  return (
    !form.external.support_document_type && !form.external.exit_reason.trim()
  );
}

// ---------------------------------------------------------------------------
// Líneas y lotes (D5)
// ---------------------------------------------------------------------------

export function batchesForLine(
  batches: TransferBatchOption[],
  line: Pick<AdvancedLine, 'product_id' | 'product_variant_id'>,
): TransferBatchOption[] {
  return batches.filter(
    (b) =>
      b.product_id === line.product_id &&
      (b.product_variant_id ?? null) === (line.product_variant_id ?? null),
  );
}

/**
 * Lote por defecto: el primero con saldo en el orden del backend (FEFO, el
 * mismo que usa el despacho cuando la fila no elige lote). Sin lotes, `null`.
 */
export function defaultBatchId(
  batches: TransferBatchOption[],
  line: Pick<AdvancedLine, 'product_id' | 'product_variant_id'>,
): number | null {
  const first = batchesForLine(batches, line).find((b) => b.available > 0);
  return first?.id ?? null;
}

/**
 * Asigna el lote por defecto a las líneas que todavía no tienen uno, sin pisar
 * el que el usuario ya eligió.
 */
export function applyDefaultBatches(
  lines: AdvancedLine[],
  batches: TransferBatchOption[],
): AdvancedLine[] {
  return lines.map((line) =>
    line.batch_id != null
      ? line
      : { ...line, batch_id: defaultBatchId(batches, line) },
  );
}

export function toAdvancedLine(line: TransferDraftLine): AdvancedLine {
  return { ...line, batch_id: (line as AdvancedLine).batch_id ?? null };
}

/**
 * Agrega filas del picker a la orden sin repetir producto + variante. Las
 * filas sin disponible en origen se omiten. `quantity` permite cargar el
 * stock completo ("agregar todo el stock de la bodega").
 */
export function addRowsToLines(
  lines: AdvancedLine[],
  rows: TransferPickerRow[],
  options: { fullStock?: boolean } = {},
): { lines: AdvancedLine[]; added: number; skipped: number } {
  const keys = new Set(lines.map((l) => l.key));
  const next = [...lines];
  let added = 0;
  let skipped = 0;
  for (const row of rows) {
    const key = pickerRowKey(row);
    const available = Number(row.stock_at_origin?.quantity_available ?? 0);
    if (keys.has(key) || available <= 0) {
      skipped++;
      continue;
    }
    keys.add(key);
    const base = pickerRowToLine(row);
    next.push({
      ...base,
      quantity: options.fullStock ? Math.floor(available) : 1,
      batch_id: null,
    });
    added++;
  }
  return { lines: next, added, skipped };
}

/** Proyección de la línea: cómo quedan origen y destino tras mover. */
export function lineProjection(line: AdvancedLine): {
  origin_after: number;
  destination_after: number;
} {
  const qty = Number(line.quantity) || 0;
  return {
    origin_after: line.available_at_origin - qty,
    destination_after: line.available_at_destination + qty,
  };
}

// ---------------------------------------------------------------------------
// Escáner y "pegar lista"
// ---------------------------------------------------------------------------

/**
 * Fila que corresponde a un código leído: primero coincidencia exacta de SKU
 * (sin distinguir mayúsculas); si no hay y la búsqueda devolvió una sola
 * fila, esa. Si hay varias sin SKU exacto es ambiguo: `null`.
 */
export function findRowForCode(
  rows: TransferPickerRow[],
  code: string,
): TransferPickerRow | null {
  const wanted = code.trim().toLowerCase();
  if (!wanted) return null;
  const exact = rows.filter(
    (r) => (r.sku ?? '').trim().toLowerCase() === wanted,
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  return rows.length === 1 ? rows[0] : null;
}

export type ScanOutcome = 'added' | 'incremented' | 'no_stock' | 'max_reached';

/** Escáner: cada lectura suma 1 (o agrega la línea con 1). */
export function applyScan(
  lines: AdvancedLine[],
  row: TransferPickerRow,
): { lines: AdvancedLine[]; outcome: ScanOutcome } {
  const key = pickerRowKey(row);
  const existing = lines.find((l) => l.key === key);
  if (existing) {
    if (existing.quantity >= existing.available_at_origin) {
      return { lines, outcome: 'max_reached' };
    }
    return {
      lines: lines.map((l) =>
        l.key === key ? { ...l, quantity: l.quantity + 1 } : l,
      ),
      outcome: 'incremented',
    };
  }
  const result = addRowsToLines(lines, [row]);
  return result.added === 1
    ? { lines: result.lines, outcome: 'added' }
    : { lines, outcome: 'no_stock' };
}

export interface PastedEntry {
  /** Número de línea (1-based) en el texto pegado. */
  line: number;
  sku: string;
  quantity: number;
}

export interface PastedInvalid {
  line: number;
  raw: string;
  reason: string;
}

/**
 * "Pegar lista": una fila por línea con `SKU;cantidad` (también acepta coma o
 * tabulador, como al copiar de una hoja de cálculo). Sin cantidad cuenta 1.
 * Las filas inválidas se devuelven con el motivo para mostrarlas.
 * Un SKU repetido suma sus cantidades.
 */
export function parsePastedList(text: string): {
  entries: PastedEntry[];
  invalid: PastedInvalid[];
} {
  const entries: PastedEntry[] = [];
  const invalid: PastedInvalid[] = [];
  const bySku = new Map<string, PastedEntry>();

  (text ?? '').split(/\r?\n/).forEach((rawLine, index) => {
    const raw = rawLine.trim();
    if (!raw) return;
    const lineNo = index + 1;
    const parts = raw.split(/[;\t,]/).map((p) => p.trim());
    const sku = parts[0] ?? '';
    const qtyText = parts[1] ?? '';
    if (!sku) {
      invalid.push({ line: lineNo, raw, reason: 'Falta el SKU' });
      return;
    }
    if (parts.length > 2 && parts.slice(2).some((p) => p !== '')) {
      invalid.push({ line: lineNo, raw, reason: 'Usa solo SKU y cantidad' });
      return;
    }
    const quantity = qtyText === '' ? 1 : Number(qtyText);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      invalid.push({
        line: lineNo,
        raw,
        reason: 'La cantidad debe ser un número entero mayor que 0',
      });
      return;
    }
    const keySku = sku.toLowerCase();
    const prev = bySku.get(keySku);
    if (prev) {
      prev.quantity += quantity;
      return;
    }
    const entry = { line: lineNo, sku, quantity };
    bySku.set(keySku, entry);
    entries.push(entry);
  });

  return { entries, invalid };
}

/**
 * Aplica una fila de la lista pegada: suma la cantidad (sin pasar del
 * disponible). Devuelve el motivo si no se pudo.
 */
export function applyPastedEntry(
  lines: AdvancedLine[],
  row: TransferPickerRow,
  quantity: number,
): { lines: AdvancedLine[]; error: string | null } {
  const key = pickerRowKey(row);
  const available = Number(row.stock_at_origin?.quantity_available ?? 0);
  const existing = lines.find((l) => l.key === key);
  const current = existing?.quantity ?? 0;
  if (available <= 0) {
    return { lines, error: 'Sin disponible en la bodega de origen' };
  }
  if (current + quantity > available) {
    return {
      lines,
      error: `Pediste ${current + quantity} y solo hay ${available} disponible(s)`,
    };
  }
  if (existing) {
    return {
      lines: lines.map((l) =>
        l.key === key ? { ...l, quantity: current + quantity } : l,
      ),
      error: null,
    };
  }
  const added = addRowsToLines(lines, [row]).lines;
  return {
    lines: added.map((l) => (l.key === key ? { ...l, quantity } : l)),
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Validación y payload
// ---------------------------------------------------------------------------

export function validateAdvancedOrder(form: AdvancedOrderForm): string[] {
  const errors: string[] = [];
  if (!form.from_location_id) errors.push('Elige la bodega de origen.');

  if (form.is_external) {
    if (!form.external.name.trim()) {
      errors.push('Escribe el nombre del destino externo.');
    }
  } else if (!form.to_location_id) {
    errors.push('Elige la bodega de destino.');
  } else if (form.to_location_id === form.from_location_id) {
    errors.push('El origen y el destino deben ser bodegas diferentes.');
  }

  if (form.lines.length === 0) {
    errors.push('Agrega al menos un producto.');
  } else if (!form.lines.every(lineHasValidQuantity)) {
    errors.push(
      'Revisa las cantidades: deben ser enteros mayores que 0 y no superar el disponible.',
    );
  }

  const t = form.transport;
  switch (t.method) {
    case 'internal_carrier':
      if (!t.driver_user_id && !t.driver_name.trim()) {
        errors.push('Elige el transportador o escribe su nombre.');
      }
      break;
    case 'internal_vehicle':
      if (!t.vehicle_id && !t.new_vehicle_plate.trim()) {
        errors.push('Elige un vehículo o registra uno con su placa.');
      }
      if (t.new_vehicle_plate.trim().length > 20) {
        errors.push('La placa no puede tener más de 20 caracteres.');
      }
      break;
    case 'internal_shipping_method':
      if (!t.shipping_method_id) {
        errors.push('Elige la forma de envío.');
      }
      break;
    case 'external_shipping_method':
      if (!t.shipping_method_id && !t.carrier_name.trim()) {
        errors.push('Elige la transportadora o escribe su nombre.');
      }
      break;
  }
  if (
    t.shipping_cost != null &&
    (Number.isNaN(+t.shipping_cost) || +t.shipping_cost < 0)
  ) {
    errors.push('El costo de transporte no puede ser negativo.');
  }
  return errors;
}

function text(value: string | null | undefined): string | undefined {
  const v = (value ?? '').trim();
  return v ? v : undefined;
}

/** `null` si la orden no es válida (ver `validateAdvancedOrder`). */
export function buildAdvancedPayload(
  form: AdvancedOrderForm,
): AdvancedTransferPayload | null {
  if (validateAdvancedOrder(form).length > 0) return null;

  const payload: AdvancedTransferPayload = {
    from_location_id: form.from_location_id!,
    movement_mode: effectiveMode(form),
    items: form.lines.map((line) => ({
      product_id: line.product_id,
      ...(line.product_variant_id != null
        ? { product_variant_id: line.product_variant_id }
        : {}),
      ...(line.batch_id != null ? { batch_id: line.batch_id } : {}),
      quantity: line.quantity,
    })),
  };

  if (form.is_external) {
    payload.is_external_destination = true;
    payload.external_destination_name = text(form.external.name);
    const taxId = text(form.external.tax_id);
    if (taxId) payload.external_destination_tax_id = taxId;
    const address = text(form.external.address);
    if (address) payload.external_destination_address = address;
    if (form.external.support_document_type) {
      payload.support_document_type = form.external.support_document_type;
    }
    const docId = text(form.external.support_document_id);
    if (docId) payload.support_document_id = docId;
    const reason = text(form.external.exit_reason);
    if (reason) payload.exit_reason = reason;
  } else {
    payload.to_location_id = form.to_location_id!;
  }

  if (form.expected_date) payload.expected_date = form.expected_date;
  const notes = text(form.notes);
  if (notes) payload.notes = notes;

  const t = form.transport;
  const cost = t.shipping_cost != null ? Number(t.shipping_cost) || 0 : 0;
  if (cost > 0) payload.shipping_cost = Math.round(cost * 100) / 100;

  if (t.method !== 'none') {
    payload.transport_method = t.method;
    if (t.method === 'internal_carrier' || t.method === 'internal_vehicle') {
      if (t.driver_user_id) payload.driver_user_id = t.driver_user_id;
      const driverName = text(t.driver_name);
      if (driverName) payload.driver_name = driverName;
    }
    if (t.method === 'internal_vehicle') {
      if (t.vehicle_id) {
        payload.vehicle_id = t.vehicle_id;
      } else {
        payload.vehicle = {
          plate: t.new_vehicle_plate.trim().toUpperCase(),
          ...(t.new_vehicle_type ? { type: t.new_vehicle_type } : {}),
        };
      }
    }
    if (
      t.method === 'internal_shipping_method' ||
      t.method === 'external_shipping_method'
    ) {
      if (t.shipping_method_id)
        payload.shipping_method_id = t.shipping_method_id;
      const carrier = text(t.carrier_name);
      if (carrier && t.method === 'external_shipping_method') {
        payload.carrier_name = carrier;
      }
      const tracking = text(t.tracking_number);
      if (tracking) payload.tracking_number = tracking;
    }
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Borrador local ("Guardar borrador")
// ---------------------------------------------------------------------------

/**
 * El backend no tiene un estado "borrador" distinto de "pendiente de
 * aprobación": toda orden creada queda pendiente. "Guardar borrador" guarda el
 * formulario en este navegador para retomarlo después; "Enviar a aprobación"
 * es el que crea la transferencia.
 */
export const ADVANCED_DRAFT_VERSION = 1;

interface StoredDraft {
  v: number;
  saved_at: string;
  form: AdvancedOrderForm;
}

export function serializeAdvancedDraft(
  form: AdvancedOrderForm,
  now = new Date(),
): string {
  const stored: StoredDraft = {
    v: ADVANCED_DRAFT_VERSION,
    saved_at: now.toISOString(),
    form,
  };
  return JSON.stringify(stored);
}

export function parseAdvancedDraft(
  raw: string | null | undefined,
): { form: AdvancedOrderForm; saved_at: string } | null {
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredDraft;
    if (stored?.v !== ADVANCED_DRAFT_VERSION || !stored.form) return null;
    const base = emptyAdvancedForm();
    const form: AdvancedOrderForm = {
      ...base,
      ...stored.form,
      external: { ...base.external, ...(stored.form.external ?? {}) },
      transport: { ...base.transport, ...(stored.form.transport ?? {}) },
      lines: Array.isArray(stored.form.lines)
        ? stored.form.lines.map((l) => ({
            ...l,
            key: transferLineKey(l.product_id, l.product_variant_id),
            batch_id: l.batch_id ?? null,
          }))
        : [],
    };
    return { form, saved_at: stored.saved_at };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reglas del detalle: despacho, recepción, cierre con pérdida (D3/D4/D8)
// ---------------------------------------------------------------------------

/** Subconjunto común de la transferencia de tienda y de organización. */
export interface TransferFlowItem {
  id: number;
  quantity: number;
  quantity_received?: number | null;
  quantity_dispatched?: number | null;
  quantity_lost?: number | null;
  batch_id?: number | null;
  inventory_batches?: {
    id: number;
    batch_number: string;
    expiration_date?: string | null;
  } | null;
  products?: { id: number; name: string; sku?: string | null } | null;
  product_variants?: {
    id: number;
    name?: string | null;
    sku?: string | null;
  } | null;
}

export interface TransferFlowNote {
  id: number;
  dispatch_number: string;
  status?: string | null;
  store_id?: number | null;
  store?: { id: number; name: string } | null;
}

export interface TransferFlowView {
  id: number;
  status: string;
  movement_mode?: string | null;
  is_external_destination?: boolean | null;
  external_destination_name?: string | null;
  external_destination_tax_id?: string | null;
  external_destination_address?: string | null;
  support_document_type?: string | null;
  support_document_id?: string | null;
  exit_reason?: string | null;
  no_support_alert?: boolean | null;
  expected_date?: string | null;
  dispatched_at?: string | null;
  transport_method?: string | null;
  driver_name?: string | null;
  carrier_name?: string | null;
  tracking_number?: string | null;
  shipping_cost?: number | string | null;
  loss_reason?: string | null;
  dispatch_note?: TransferFlowNote | null;
  receipt_note?: TransferFlowNote | null;
  stock_transfer_items: TransferFlowItem[];
}

/** Lo que salió del origen. NULL = fila histórica: salió lo pedido. */
export function itemDispatched(item: TransferFlowItem): number {
  return item.quantity_dispatched ?? item.quantity;
}

/** Saldo por recibir: lo que salió menos lo recibido y lo perdido. */
export function itemPending(item: TransferFlowItem): number {
  return Math.max(
    0,
    itemDispatched(item) -
      Number(item.quantity_received ?? 0) -
      Number(item.quantity_lost ?? 0),
  );
}

export function totalPending(t: TransferFlowView): number {
  return (t.stock_transfer_items ?? []).reduce((s, i) => s + itemPending(i), 0);
}

export function isNeverDispatched(t: TransferFlowView): boolean {
  return (
    !t.dispatched_at &&
    (t.stock_transfer_items ?? []).every((i) => i.quantity_dispatched == null)
  );
}

/** Orden creada desde la vista avanzada (o salida externa). */
export function isAdvancedTransfer(
  t: TransferFlowView | null | undefined,
): boolean {
  return (
    !!t &&
    (t.movement_mode === 'mass_only' ||
      t.movement_mode === 'with_dispatch_notes' ||
      t.is_external_destination === true)
  );
}

/**
 * Despachar: aprobada (tienda escribe `in_transit` al aprobar; organización
 * `approved`) y nunca despachada. Las filas del flujo anterior (sin modo) no
 * pasan por el despacho en tienda.
 */
export function canDispatch(t: TransferFlowView | null | undefined): boolean {
  if (!t || !isAdvancedTransfer(t)) return false;
  if (t.status !== 'approved' && t.status !== 'in_transit') return false;
  return isNeverDispatched(t);
}

/**
 * D4 — misma regla que el backend (`hasDeliveryDeadlinePassed`): vence al
 * FIN del día UTC de la fecha límite; "vence hoy" todavía no deja cerrar.
 */
export function deliveryDeadlinePassed(
  expectedDate: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!expectedDate) return false;
  const d = new Date(expectedDate);
  if (Number.isNaN(d.getTime())) return false;
  const deadline = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    23,
    59,
    59,
    999,
  );
  return now.getTime() > deadline;
}

/**
 * Cerrar el saldo como pérdida: solo con saldo pendiente, ya despachada (si
 * tiene modo), no externa y con la fecha límite vencida.
 */
export function canCloseWithLoss(
  t: TransferFlowView | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!t) return false;
  if (t.status !== 'in_transit' && t.status !== 'partially_received')
    return false;
  if (t.is_external_destination) return false;
  if (t.movement_mode && isNeverDispatched(t)) return false;
  if (totalPending(t) <= 0) return false;
  return deliveryDeadlinePassed(t.expected_date, now);
}

/** D8 — alerta de salida sin documento ni motivo. */
export function hasExitAlert(
  t: { no_support_alert?: boolean | null } | null | undefined,
): boolean {
  return t?.no_support_alert === true;
}

/**
 * R3-2 — en la superficie de tienda la remisión de entrada vive en la tienda
 * donde se registró la primera entrega; las siguientes solo pueden registrarse
 * desde esa tienda. Devuelve el nombre de esa tienda cuando el usuario está en
 * otra (o `null` si puede seguir aquí).
 */
export function receiptStoreBlock(
  t: TransferFlowView | null | undefined,
  surface: 'store' | 'organization',
  currentStoreId: number | null,
): string | null {
  if (!t || surface !== 'store') return null;
  if (t.movement_mode !== 'with_dispatch_notes') return null;
  const note = t.receipt_note;
  if (!note || note.store_id == null || currentStoreId == null) return null;
  if (note.store_id === currentStoreId) return null;
  return note.store?.name || `la tienda #${note.store_id}`;
}

export interface DispatchLineInput {
  id: number;
  quantity_dispatched: number;
  batch_id: number | null;
}

/**
 * Conteo de salida: devuelve el cuerpo de `POST :id/dispatch` o el error.
 * No se puede despachar más de lo pedido ni todo en cero.
 */
export function buildDispatchBody(
  t: TransferFlowView,
  lines: DispatchLineInput[],
  notes?: string,
): {
  body: {
    items: Array<{
      id: number;
      quantity_dispatched: number;
      batch_id?: number;
    }>;
    notes?: string;
  } | null;
  error: string | null;
} {
  const byId = new Map(t.stock_transfer_items.map((i) => [i.id, i]));
  let total = 0;
  for (const line of lines) {
    const item = byId.get(line.id);
    if (!item)
      return {
        body: null,
        error: 'Hay una línea que no es de esta transferencia.',
      };
    const qty = Number(line.quantity_dispatched);
    if (!Number.isInteger(qty) || qty < 0) {
      return {
        body: null,
        error: 'Las cantidades a despachar deben ser enteros de 0 en adelante.',
      };
    }
    if (qty > item.quantity) {
      return {
        body: null,
        error: `No puedes despachar más de lo pedido (${item.products?.name ?? 'producto'}: ${item.quantity}).`,
      };
    }
    total += qty;
  }
  if (total === 0) {
    return { body: null, error: 'Despacha al menos una unidad.' };
  }
  const n = (notes ?? '').trim();
  return {
    body: {
      items: lines.map((l) => ({
        id: l.id,
        quantity_dispatched: Number(l.quantity_dispatched),
        ...(l.batch_id != null ? { batch_id: l.batch_id } : {}),
      })),
      ...(n ? { notes: n } : {}),
    },
    error: null,
  };
}

/** Cuerpo de la recepción: solo líneas con algo pendiente, sin pasar del saldo. */
export function buildReceiveBody(
  t: TransferFlowView,
  received: Record<number, number>,
): {
  items: Array<{ id: number; quantity_received: number }> | null;
  error: string | null;
} {
  const items: Array<{ id: number; quantity_received: number }> = [];
  let total = 0;
  for (const item of t.stock_transfer_items) {
    const pending = itemPending(item);
    if (pending <= 0) continue;
    const qty = Number(received[item.id] ?? 0);
    if (!Number.isInteger(qty) || qty < 0) {
      return {
        items: null,
        error: 'Las cantidades recibidas deben ser enteros de 0 en adelante.',
      };
    }
    if (qty > pending) {
      return {
        items: null,
        error: `Recibiste más de lo pendiente (${item.products?.name ?? 'producto'}: faltan ${pending}).`,
      };
    }
    total += qty;
    items.push({ id: item.id, quantity_received: qty });
  }
  if (total === 0)
    return { items: null, error: 'Registra al menos una unidad recibida.' };
  return { items, error: null };
}

export function transportSummary(t: TransferFlowView): string | null {
  switch (t.transport_method) {
    case 'internal_carrier':
      return `Transportador interno${t.driver_name ? `: ${t.driver_name}` : ''}`;
    case 'internal_vehicle':
      return `Vehículo propio${t.driver_name ? ` · ${t.driver_name}` : ''}`;
    case 'internal_shipping_method':
      return 'Forma de envío propia';
    case 'external_shipping_method':
      return `Transportadora${t.carrier_name ? `: ${t.carrier_name}` : ''}${
        t.tracking_number ? ` · guía ${t.tracking_number}` : ''
      }`;
    default:
      return null;
  }
}

export function supportDocumentLabel(
  type: string | null | undefined,
): string | null {
  return SUPPORT_DOCUMENT_OPTIONS.find((o) => o.value === type)?.label ?? null;
}
